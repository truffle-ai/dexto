/* global ReadableStream */
import { resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import {
    ApprovalStatus,
    ApprovalType,
    DenialReason,
    isTextPart,
    safeStringify,
    type ApprovalRequest,
    type ApprovalResponse,
    type ElicitationMetadata,
    type DextoAgent,
    type StreamingEvent,
    type ToolPresentationSnapshotV1,
} from '@dexto/core';
import { LLM_PROVIDERS } from '@dexto/llm';
import { z } from 'zod';
import {
    findDextoProjectRoot,
    loadModelPickerState,
    recordRecentModel,
    type ModelPickerModel,
} from '@dexto/agent-management';
import { formSchema } from './acp-elicitation.js';
import { displayContent, toolKind } from './acp-tool-content.js';

/**
 * `dexto acp`: the Dexto CLI agent over the Agent Client Protocol (v1) on stdio, so an ACP
 * client (T3 Code, Zed) drives the same agent loop `dexto run` uses. One agent per process;
 * every ACP session is a Dexto session in the CLI's own session store.
 *
 * The bootstrap sets the agent up for one Dexto project (its instructions, prompts, plugins and
 * storage), so a process serves one project: sessions in another project are refused.
 */

const MODEL_CONFIG_ID = 'model';

const FormDataSchema = z.record(z.string(), z.unknown()).nullish();

const TodoUpdateSchema = z.object({
    todos: z.array(z.object({ content: z.string(), status: z.string() })),
});

/** The running agent and the Dexto project root it was set up for. */
type Runtime = { readonly agent: DextoAgent; readonly root: string };

/** One running session/prompt: where its updates go and which tool calls are still open. */
type Turn = {
    readonly cx: acp.AgentContext;
    readonly sessionId: string;
    /** The project root tool paths resolve against. */
    readonly root: string;
    readonly openToolCalls: Set<string>;
    /** Aborted by session/cancel; stops the Dexto run even before it has started. */
    readonly abort: AbortController;
};

export async function serveAcp(
    version: string,
    bootstrap: () => Promise<DextoAgent>
): Promise<void> {
    // The agent and project root, started by the first session; concurrent first sessions share
    // the start. Held in an object: closures assign it after the connection is set up.
    const state: {
        started: Promise<Runtime> | null;
        runtime: Runtime | null;
        /** Whether the client renders ACP forms (`elicitation.form` in its capabilities). */
        forms: boolean;
    } = {
        started: null,
        runtime: null,
        forms: false,
    };
    // The ACP connection that owns each session's running prompt, for approvals raised mid-turn.
    const turns = new Map<string, Turn>();
    // Each session's running prompt and title generation, so closing it can wait for both.
    const runs = new Map<string, Promise<acp.PromptResponse>>();
    const titles = new Map<string, Promise<void>>();
    // The last load, resume or close of each session; the next one waits for it.
    const lifecycle = new Map<string, Promise<unknown>>();

    /** Runs loads, resumes and closes of one session one at a time, in arrival order. */
    function inOrder<T>(sessionId: string, op: () => Promise<T>): Promise<T> {
        const result = Promise.allSettled([lifecycle.get(sessionId)]).then(op);
        const settled = Promise.allSettled([result]);
        lifecycle.set(sessionId, settled);
        void settled.then(() => {
            if (lifecycle.get(sessionId) === settled) lifecycle.delete(sessionId);
        });
        return result;
    }
    // Sessions opened or loaded on this connection.
    const sessions = new Set<string>();

    async function startAgent(cwd: string): Promise<Runtime> {
        // The CLI bootstrap reads the project from the process directory and sets up that
        // project's instructions, prompts, plugins and storage.
        process.chdir(cwd);
        const agent = await bootstrap();
        agent.setApprovalHandler((request) => askClient(request, turns, state.forms));
        state.runtime = { agent, root: projectRoot(cwd) };
        return state.runtime;
    }

    /** The agent for a session in `cwd`; a session in another project is refused. */
    async function agentFor(cwd: string): Promise<DextoAgent> {
        if (state.started === null) {
            const starting = startAgent(cwd);
            state.started = starting;
            // A failed start (bad directory, missing sign-in) is retried by the next session.
            starting.catch(() => {
                if (state.started === starting) state.started = null;
            });
        }
        const { agent, root } = await state.started;
        if (projectRoot(cwd) !== root) {
            throw acp.RequestError.invalidParams(
                { cwd },
                `This dexto acp process serves the project at ${root}; start another for ${cwd}`
            );
        }
        return agent;
    }

    function knownSession(sessionId: string): void {
        if (!sessions.has(sessionId)) throw acp.RequestError.sessionNotFound(sessionId);
    }

    /** Opens a stored session of this project on this connection, then runs `reopen` (load and resume) before the next load, resume or close of it. */
    function restoreSession<T>(
        sessionId: string,
        cwd: string,
        reopen: (agent: DextoAgent) => Promise<T>
    ): Promise<T> {
        return inOrder(sessionId, async () => {
            const running = await agentFor(cwd);
            const metadata = await running.getSessionMetadata(sessionId);
            if (metadata?.workspaceId !== (await workspaceId(running))) {
                throw acp.RequestError.sessionNotFound(sessionId);
            }
            if (!(await running.getSession(sessionId))) {
                throw acp.RequestError.sessionNotFound(sessionId);
            }
            sessions.add(sessionId);
            return await reopen(running);
        });
    }

    /** Ends a session once its run and title are done; its history stays stored. */
    async function endWhenIdle(agent: DextoAgent, sessionId: string): Promise<void> {
        // No new title starts once the session is gone from `sessions`.
        await Promise.allSettled([runs.get(sessionId), titles.get(sessionId)]);
        await agent.endSession(sessionId);
    }

    /** Titles an open session after a prompt, unless a title is already being made. */
    function startTitle(agent: DextoAgent, turn: Turn): void {
        const { sessionId } = turn;
        if (!sessions.has(sessionId) || titles.has(sessionId)) return;
        const titling = titleSession(agent, turn, () => sessions.has(sessionId))
            .catch((error: unknown) =>
                console.error('dexto acp: could not title the session', error)
            )
            .finally(() => titles.delete(sessionId));
        titles.set(sessionId, titling);
    }

    function startedRuntime(): Runtime {
        if (state.runtime === null) throw acp.RequestError.invalidRequest({}, 'No session yet');
        return state.runtime;
    }

    const stream = acp.ndJsonStream(
        Writable.toWeb(process.stdout),
        Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
    );

    const connection = acp
        .agent({ name: 'dexto' })
        .onRequest('initialize', ({ params }) => {
            state.forms = Boolean(params.clientCapabilities?.elicitation?.form);
            return {
                protocolVersion: acp.PROTOCOL_VERSION,
                agentCapabilities: {
                    loadSession: true,
                    sessionCapabilities: { list: {}, resume: {}, close: {} },
                    promptCapabilities: { image: false, audio: false, embeddedContext: true },
                },
                agentInfo: { name: 'dexto', title: 'Dexto', version },
                authMethods: [],
            };
        })
        .onRequest('authenticate', () => ({}))
        .onRequest('session/new', async ({ params }) => {
            const running = await agentFor(params.cwd);
            const session = await running.createSession();
            sessions.add(session.id);
            return {
                sessionId: session.id,
                configOptions: await modelOptions(running, session.id),
            };
        })
        .onRequest('session/load', ({ params, client }) =>
            restoreSession(params.sessionId, params.cwd, async (running) => {
                await replayHistory(running, params.sessionId, client);
                return { configOptions: await modelOptions(running, params.sessionId) };
            })
        )
        .onRequest('session/resume', ({ params }) =>
            restoreSession(params.sessionId, params.cwd, async (running) => ({
                configOptions: await modelOptions(running, params.sessionId),
            }))
        )
        .onRequest('session/list', async ({ params }) => {
            // Without a cwd, the project this process serves (or the one it starts in).
            const running = await agentFor(params.cwd ?? state.runtime?.root ?? process.cwd());
            return { sessions: await projectSessions(running, startedRuntime().root) };
        })
        .onRequest('session/close', async ({ params }) => {
            await inOrder(params.sessionId, async () => {
                // Read inside the queue: a load queued ahead may be what starts the agent.
                const { agent } = startedRuntime();
                knownSession(params.sessionId);
                sessions.delete(params.sessionId);
                turns.get(params.sessionId)?.abort.abort();
                await endWhenIdle(agent, params.sessionId);
            });
            return {};
        })
        .onRequest('session/set_config_option', async ({ params }) => {
            const running = startedRuntime().agent;
            knownSession(params.sessionId);
            if (params.configId !== MODEL_CONFIG_ID || typeof params.value !== 'string') {
                throw acp.RequestError.invalidParams({ configId: params.configId });
            }
            const model = parseModelValue(params.value);
            await running.switchLLM(
                {
                    provider: model.provider,
                    model: model.model,
                    ...(model.baseURL ? { baseURL: model.baseURL } : {}),
                },
                params.sessionId
            );
            await recordRecentModel(model);
            return { configOptions: await modelOptions(running, params.sessionId) };
        })
        .onRequest('session/prompt', async ({ params, client }) => {
            const { agent, root } = startedRuntime();
            knownSession(params.sessionId);
            if (turns.has(params.sessionId)) {
                throw acp.RequestError.invalidRequest(
                    { sessionId: params.sessionId },
                    'A prompt is already running in this session'
                );
            }
            const turn: Turn = {
                cx: client,
                sessionId: params.sessionId,
                root,
                openToolCalls: new Set(),
                abort: new AbortController(),
            };
            turns.set(params.sessionId, turn);
            const run = runPrompt(agent, params, turn);
            runs.set(params.sessionId, run);
            try {
                const response = await run;
                startTitle(agent, turn);
                return response;
            } finally {
                turns.delete(params.sessionId);
                runs.delete(params.sessionId);
            }
        })
        .onNotification('session/cancel', async ({ params }) => {
            turns.get(params.sessionId)?.abort.abort();
        })
        .connect(stream);

    await connection.closed;
    await state.runtime?.agent.stop();
}

/** The workspace the CLI set at start: the project root. Sessions record it. */
async function workspaceId(agent: DextoAgent): Promise<string> {
    const workspace = await agent.getWorkspace();
    if (workspace === undefined) throw new Error('dexto acp started without a workspace');
    return workspace.id;
}

/** This project's stored sessions as ACP session info, most recently active first. */
async function projectSessions(agent: DextoAgent, root: string): Promise<acp.SessionInfo[]> {
    const workspace = await workspaceId(agent);
    const found: Array<{ info: acp.SessionInfo; lastActivity: number }> = [];
    for (const sessionId of await agent.listSessions()) {
        const metadata = await agent.getSessionMetadata(sessionId);
        // The session store is shared by every project this agent runs in.
        if (metadata?.workspaceId !== workspace) continue;
        found.push({
            lastActivity: metadata.lastActivity,
            info: {
                sessionId,
                cwd: root,
                updatedAt: new Date(metadata.lastActivity).toISOString(),
                ...(metadata.title !== undefined ? { title: metadata.title } : {}),
            },
        });
    }
    return found.sort((a, b) => b.lastActivity - a.lastActivity).map(({ info }) => info);
}

/** Titles a session after its first prompt, the way the Dexto TUI does, and tells the client. */
async function titleSession(agent: DextoAgent, turn: Turn, open: () => boolean): Promise<void> {
    const details = await agent.generateSessionTitleDetails(turn.sessionId);
    if (details === null || details.source === 'existing' || !open()) return;
    await sendUpdate(turn, {
        sessionUpdate: 'session_info_update',
        title: details.title,
        updatedAt: new Date().toISOString(),
    });
}

async function runPrompt(
    agent: DextoAgent,
    params: acp.PromptRequest,
    turn: Turn
): Promise<acp.PromptResponse> {
    const signal = turn.abort.signal;
    if (signal.aborted) return { stopReason: 'cancelled' };
    let stopReason: acp.StopReason = 'end_turn';
    // Cancel stops the run, but the turn keeps reading until the run has ended, so the session
    // is free again when the prompt answers (without a disconnect signal, abort ends the
    // stream at once while the run is still winding down).
    const events = await agent.stream(promptText(params.prompt), turn.sessionId, {
        signal,
        disconnectSignal: new AbortController().signal,
    });
    try {
        for await (const event of events) {
            const finished = await forwardEvent(event, turn);
            if (finished !== null) stopReason = finished;
        }
    } catch (error) {
        // An abort error escaping the run still ends a cancelled turn as `cancelled`.
        if (!signal.aborted) throw error;
    } finally {
        // v1 has no cancelled tool status: anything left open ends as failed.
        for (const toolCallId of turn.openToolCalls) {
            await sendUpdate(turn, {
                sessionUpdate: 'tool_call_update',
                toolCallId,
                status: 'failed',
            });
        }
    }
    // A cancelled run's stream just ends; ACP requires the cancelled stop reason.
    return { stopReason: signal.aborted ? 'cancelled' : stopReason };
}

function sendUpdate(turn: Turn, update: acp.SessionUpdate): Promise<void> {
    return turn.cx.notify(acp.methods.client.session.update, {
        sessionId: turn.sessionId,
        update,
    });
}

/** A Dexto tool call as both the tool-call event and a tool approval describe it. */
type DextoToolCall = {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly presentationSnapshot?: ToolPresentationSnapshotV1 | undefined;
};

function toolCallFields(turn: Turn, call: DextoToolCall) {
    return {
        toolCallId: call.toolCallId,
        title: toolTitle(call.toolName, call.args),
        kind: toolKind(call.presentationSnapshot),
        rawInput: call.args,
        locations: toolLocations(turn.root, call.args),
    };
}

/**
 * Reports a tool call once. Dexto raises an approval before its tool-call event reaches the
 * stream, so whichever comes first opens the call.
 */
async function openToolCall(turn: Turn, call: DextoToolCall): Promise<void> {
    if (turn.openToolCalls.has(call.toolCallId)) return;
    turn.openToolCalls.add(call.toolCallId);
    await sendUpdate(turn, {
        sessionUpdate: 'tool_call',
        ...toolCallFields(turn, call),
        status: 'pending',
    });
}

/** Sends one Dexto event as ACP updates; returns the stop reason when the run ends. */
async function forwardEvent(event: StreamingEvent, turn: Turn): Promise<acp.StopReason | null> {
    const update = (u: acp.SessionUpdate) => sendUpdate(turn, u);
    switch (event.name) {
        case 'llm:chunk':
            await update({
                sessionUpdate:
                    event.chunkType === 'reasoning' ? 'agent_thought_chunk' : 'agent_message_chunk',
                content: { type: 'text', text: event.content },
            });
            return null;
        case 'llm:tool-call':
            await openToolCall(turn, {
                toolCallId: event.callId,
                toolName: event.toolName,
                args: event.args,
                presentationSnapshot: event.presentationSnapshot,
            });
            return null;
        case 'tool:running':
            await update({
                sessionUpdate: 'tool_call_update',
                toolCallId: event.toolCallId,
                status: 'in_progress',
            });
            return null;
        case 'llm:tool-result': {
            turn.openToolCalls.delete(event.callId);
            const display = event.success ? event.sanitized?.meta.display : undefined;
            const text = event.success ? resultText(event) : (event.error ?? 'Tool failed');
            await update({
                sessionUpdate: 'tool_call_update',
                toolCallId: event.callId,
                status: event.success ? 'completed' : 'failed',
                content: (display && displayContent(display, turn.root)) ?? [
                    { type: 'content', content: { type: 'text', text } },
                ],
            });
            return null;
        }
        case 'service:event': {
            if (event.service !== 'todo' || event.event !== 'updated') return null;
            const parsed = TodoUpdateSchema.safeParse(event.data);
            if (!parsed.success) return null;
            await update({
                sessionUpdate: 'plan',
                entries: parsed.data.todos.map((todo) => ({
                    content: todo.content,
                    priority: 'medium',
                    status: planStatus(todo.status),
                })),
            });
            return null;
        }
        case 'run:complete':
            if (event.finishReason === 'error' && event.error) throw event.error;
            return stopReasonFor(event.finishReason);
        case 'llm:error':
            if (!event.recoverable) throw event.error;
            return null;
        default:
            return null;
    }
}

/**
 * Dexto approval → ACP session/request_permission on the connection running that session's
 * prompt. Approvals with no running ACP prompt (none should exist) are refused.
 */
async function askClient(
    request: ApprovalRequest,
    turns: Map<string, Turn>,
    forms: boolean
): Promise<ApprovalResponse> {
    const { approvalId, sessionId } = request;
    const turn = sessionId === undefined ? undefined : turns.get(sessionId);
    if (sessionId === undefined || turn === undefined) {
        return {
            approvalId,
            ...(sessionId !== undefined ? { sessionId } : {}),
            status: ApprovalStatus.DENIED,
            reason: DenialReason.SYSTEM_DENIED,
        };
    }
    const base: ApprovalBase = { approvalId, sessionId };
    if (request.type === ApprovalType.ELICITATION) {
        return await askForm(request.metadata, request.timeout, turn, forms, base);
    }
    let toolCall: acp.ToolCallUpdate;
    if (request.type === ApprovalType.TOOL_APPROVAL) {
        const call = request.metadata;
        // A sub-agent's tool runs in its own session; its result never reaches this stream.
        if (!('delegatedFromSessionId' in call)) await openToolCall(turn, call);
        // The approval carries a preview of the change, such as the diff an edit would make.
        const preview = call.displayPreview && displayContent(call.displayPreview, turn.root);
        toolCall = { ...toolCallFields(turn, call), ...(preview ? { content: preview } : {}) };
    } else {
        toolCall = {
            toolCallId: request.approvalId,
            title: safeStringify(request.metadata),
            kind: 'other',
        };
    }
    const asked = await askWithin(turn, request.timeout, base, (options) =>
        turn.cx.request(
            acp.methods.client.session.requestPermission,
            {
                sessionId,
                toolCall,
                options: [
                    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
                    {
                        optionId: 'allow_session',
                        name: 'Allow for this session',
                        kind: 'allow_always',
                    },
                    { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
                ],
            },
            options
        )
    );
    if (asked.kind === 'withdrawn') return asked.response;
    const response = asked.answer;
    if (response.outcome.outcome === 'cancelled') {
        return { ...base, status: ApprovalStatus.CANCELLED, reason: DenialReason.USER_CANCELLED };
    }
    switch (response.outcome.optionId) {
        case 'allow':
            return { ...base, status: ApprovalStatus.APPROVED };
        case 'allow_session':
            return { ...base, status: ApprovalStatus.APPROVED, data: { rememberChoice: true } };
        default:
            return { ...base, status: ApprovalStatus.DENIED, reason: DenialReason.USER_DENIED };
    }
}

type ApprovalBase = { readonly approvalId: string; readonly sessionId: string };

type RequestOptions = { cancellationSignal: AbortSignal; stopWaitingOnCancel: true };

/** The client's answer, or Dexto's response for a question withdrawn unanswered. */
type Asked<T> = { kind: 'answered'; answer: T } | { kind: 'withdrawn'; response: ApprovalResponse };

/**
 * Asks the client a question (a permission or a form) and withdraws it when the turn is
 * cancelled or the configured timeout (`permissions.timeout` or `elicitation.timeout`) passes,
 * as the CLI's own approval prompt does. A turn already cancelled sends nothing.
 */
async function askWithin<T>(
    turn: Turn,
    timeout: number | undefined,
    base: ApprovalBase,
    send: (options: RequestOptions) => Promise<T>
): Promise<Asked<T>> {
    const cancelled: Asked<T> = {
        kind: 'withdrawn',
        response: {
            ...base,
            status: ApprovalStatus.CANCELLED,
            reason: DenialReason.USER_CANCELLED,
        },
    };
    if (turn.abort.signal.aborted) return cancelled;
    const timedOut = timeout === undefined ? undefined : AbortSignal.timeout(timeout);
    try {
        const answer = await send({
            cancellationSignal: timedOut
                ? AbortSignal.any([turn.abort.signal, timedOut])
                : turn.abort.signal,
            stopWaitingOnCancel: true,
        });
        return { kind: 'answered', answer };
    } catch (error) {
        if (timeout !== undefined && timedOut?.aborted && !turn.abort.signal.aborted) {
            return {
                kind: 'withdrawn',
                response: {
                    ...base,
                    status: ApprovalStatus.CANCELLED,
                    reason: DenialReason.TIMEOUT,
                    message: `The question timed out after ${timeout}ms.`,
                    timeoutMs: timeout,
                },
            };
        }
        if (!turn.abort.signal.aborted) throw error;
        return cancelled;
    }
}

/**
 * A Dexto form (ask_user, or an MCP server's elicitation) → ACP `elicitation/create`. A client
 * without form support, or a form ACP cannot show, is denied with an ask-in-chat message.
 */
async function askForm(
    metadata: ElicitationMetadata,
    timeout: number | undefined,
    turn: Turn,
    forms: boolean,
    base: ApprovalBase
): Promise<ApprovalResponse> {
    const requestedSchema = forms ? formSchema(metadata.schema) : null;
    if (requestedSchema === null) {
        const why = forms
            ? 'This form has fields the client cannot show.'
            : 'This client cannot show forms.';
        return {
            ...base,
            status: ApprovalStatus.DENIED,
            reason: DenialReason.ELICITATION_DISABLED,
            message: `${why} Ask the person in your reply instead.`,
        };
    }
    const asked = await askWithin(turn, timeout, base, (options) =>
        turn.cx.request(
            acp.methods.client.elicitation.create,
            { mode: 'form', sessionId: turn.sessionId, message: metadata.prompt, requestedSchema },
            options
        )
    );
    if (asked.kind === 'withdrawn') return asked.response;
    const response = asked.answer;
    switch (response.action) {
        case 'accept':
            return {
                ...base,
                status: ApprovalStatus.APPROVED,
                data: { formData: FormDataSchema.parse(response.content) ?? {} },
            };
        case 'decline':
            return { ...base, status: ApprovalStatus.DENIED, reason: DenialReason.USER_DENIED };
        default:
            // `cancel`, and any action this version does not know.
            return {
                ...base,
                status: ApprovalStatus.CANCELLED,
                reason: DenialReason.USER_CANCELLED,
            };
    }
}

/** Replays a stored session's user and assistant text as ACP updates (session/load). */
async function replayHistory(
    agent: DextoAgent,
    sessionId: string,
    cx: acp.AgentContext
): Promise<void> {
    for (const message of await agent.getSessionHistory(sessionId)) {
        if (message.role !== 'user' && message.role !== 'assistant') continue;
        const text = (message.content ?? [])
            .filter(isTextPart)
            .map((part) => part.text)
            .join('');
        if (text.length === 0) continue;
        await cx.notify(acp.methods.client.session.update, {
            sessionId,
            update: {
                sessionUpdate:
                    message.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
                content: { type: 'text', text },
            },
        });
    }
}

/** The model picker: the session's model plus the person's Dexto favorites and recents. */
async function modelOptions(
    agent: DextoAgent,
    sessionId: string
): Promise<acp.SessionConfigOption[]> {
    const current = agent.getCurrentLLMConfig(sessionId);
    const currentModel: ModelPickerModel = {
        provider: current.provider,
        model: current.model,
        ...(current.baseURL ? { baseURL: current.baseURL } : {}),
    };
    const state = await loadModelPickerState();
    const seen = new Set<string>();
    const options: acp.SessionConfigSelectOption[] = [];
    for (const model of [currentModel, ...state.favorites, ...state.recents]) {
        const value = modelValue(model);
        if (seen.has(value)) continue;
        seen.add(value);
        options.push({ value, name: model.model, description: model.provider });
    }
    return [
        {
            id: MODEL_CONFIG_ID,
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: modelValue(currentModel),
            options,
        },
    ];
}

function modelValue(model: ModelPickerModel): string {
    return JSON.stringify([model.provider, model.model, model.baseURL ?? null]);
}

function parseModelValue(value: string): ModelPickerModel {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw acp.RequestError.invalidParams({ value });
    }
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
        throw acp.RequestError.invalidParams({ value });
    }
    const [name, model, baseURL] = parsed;
    const provider = LLM_PROVIDERS.find((known) => known === name);
    if (provider === undefined) throw acp.RequestError.invalidParams({ value });
    return {
        provider,
        model,
        ...(typeof baseURL === 'string' ? { baseURL } : {}),
    };
}

function promptText(blocks: acp.ContentBlock[]): string {
    return blocks
        .map((block) => {
            switch (block.type) {
                case 'text':
                    return block.text;
                case 'resource_link':
                    return `@${block.uri}`;
                case 'resource':
                    return 'text' in block.resource
                        ? `<context uri="${block.resource.uri}">\n${block.resource.text}\n</context>`
                        : `@${block.resource.uri}`;
                default:
                    return '';
            }
        })
        .filter((text) => text.length > 0)
        .join('\n');
}

function toolTitle(toolName: string, args: Record<string, unknown>): string {
    const path = pathArg(args);
    const command = typeof args.command === 'string' ? args.command : undefined;
    const detail = path ?? command;
    return detail === undefined ? toolName : `${toolName} ${detail}`;
}

function toolLocations(root: string, args: Record<string, unknown>): acp.ToolCallLocation[] {
    const path = pathArg(args);
    // ACP locations are absolute; Dexto tools take paths relative to the workspace root.
    return path === undefined ? [] : [{ path: resolve(root, path) }];
}

/** The same project root the CLI bootstrap picks for a directory. */
function projectRoot(cwd: string): string {
    return findDextoProjectRoot(cwd) ?? resolve(cwd);
}

function pathArg(args: Record<string, unknown>): string | undefined {
    for (const key of ['file_path', 'path', 'filePath']) {
        const value = args[key];
        if (typeof value === 'string') return value;
    }
    return undefined;
}

function resultText(event: Extract<StreamingEvent, { name: 'llm:tool-result' }>): string {
    const text = event.sanitized?.content.filter(isTextPart).map((part) => part.text);
    if (text && text.length > 0) return text.join('\n');
    return safeStringify(event.rawResult ?? '');
}

function planStatus(status: string): acp.PlanEntryStatus {
    return status === 'in_progress' || status === 'completed' ? status : 'pending';
}

function stopReasonFor(finishReason: string): acp.StopReason {
    switch (finishReason) {
        case 'cancelled':
            return 'cancelled';
        case 'length':
            return 'max_tokens';
        case 'max-steps':
            return 'max_turn_requests';
        case 'content-filter':
            return 'refusal';
        default:
            return 'end_turn';
    }
}
