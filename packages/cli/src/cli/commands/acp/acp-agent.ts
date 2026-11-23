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
    type DextoAgent,
    type StreamingEvent,
} from '@dexto/core';
import {
    findDextoProjectRoot,
    loadModelPickerState,
    recordRecentModel,
    type ModelPickerModel,
} from '@dexto/agent-management';
import { applyWorkspaceToAgent } from '../../../utils/workspace.js';

/**
 * `dexto acp`: the Dexto CLI agent over the Agent Client Protocol (v1) on stdio, so an ACP
 * client (T3 Code, Zed) drives the same agent loop `dexto run` uses. One agent per process;
 * every ACP session is a Dexto session in the CLI's own session store.
 *
 * The agent's workspace is process-wide, so each session remembers its directory and a prompt
 * switches the workspace to it. A prompt whose directory differs from a running turn's is
 * refused rather than moving that turn's tools to another folder.
 */

const MODEL_CONFIG_ID = 'model';

/** One running session/prompt: where its updates go and which tool calls are still open. */
type Turn = {
    readonly cx: acp.AgentContext;
    readonly sessionId: string;
    readonly cwd: string;
    readonly openToolCalls: Set<string>;
    cancelled: boolean;
};

export async function serveAcp(
    version: string,
    bootstrap: () => Promise<DextoAgent>
): Promise<void> {
    // One agent per process, started by the first session; concurrent first sessions share it.
    let started: Promise<DextoAgent> | null = null;
    let agent: DextoAgent | null = null;
    // The ACP connection that owns each session's running prompt, for approvals raised mid-turn.
    const turns = new Map<string, Turn>();
    // Each session's directory, from session/new or session/load.
    const sessionCwds = new Map<string, string>();
    // The directory the agent's workspace currently points at.
    let workspaceCwd: string | null = null;

    async function startAgent(cwd: string): Promise<DextoAgent> {
        // The CLI bootstrap reads the workspace from the process directory.
        process.chdir(cwd);
        workspaceCwd = cwd;
        const running = await bootstrap();
        running.setApprovalHandler((request) => askClient(request, turns));
        agent = running;
        return running;
    }

    async function agentFor(cwd: string): Promise<DextoAgent> {
        started ??= startAgent(cwd);
        return await started;
    }

    async function useWorkspace(running: DextoAgent, cwd: string): Promise<void> {
        if (workspaceCwd === cwd) return;
        process.chdir(cwd);
        workspaceCwd = cwd;
        // The same root the CLI bootstrap picks for the first session.
        await applyWorkspaceToAgent(running, findDextoProjectRoot(cwd) ?? cwd);
    }

    function startedAgent(): DextoAgent {
        if (agent === null) throw acp.RequestError.invalidRequest({}, 'No session yet');
        return agent;
    }

    const stream = acp.ndJsonStream(
        Writable.toWeb(process.stdout),
        Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
    );

    const connection = acp
        .agent({ name: 'dexto' })
        .onRequest('initialize', () => ({
            protocolVersion: acp.PROTOCOL_VERSION,
            agentCapabilities: {
                loadSession: true,
                promptCapabilities: { image: false, audio: false, embeddedContext: true },
            },
            agentInfo: { name: 'dexto', title: 'Dexto', version },
            authMethods: [],
        }))
        .onRequest('authenticate', () => ({}))
        .onRequest('session/new', async ({ params }) => {
            const running = await agentFor(params.cwd);
            const session = await running.createSession();
            sessionCwds.set(session.id, params.cwd);
            return {
                sessionId: session.id,
                configOptions: await modelOptions(running, session.id),
            };
        })
        .onRequest('session/load', async ({ params, client }) => {
            const running = await agentFor(params.cwd);
            if (!(await running.getSession(params.sessionId))) {
                throw acp.RequestError.resourceNotFound(params.sessionId);
            }
            sessionCwds.set(params.sessionId, params.cwd);
            await replayHistory(running, params.sessionId, client);
            return { configOptions: await modelOptions(running, params.sessionId) };
        })
        .onRequest('session/set_config_option', async ({ params }) => {
            const running = startedAgent();
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
            const running = startedAgent();
            const cwd = sessionCwds.get(params.sessionId);
            if (cwd === undefined) throw acp.RequestError.resourceNotFound(params.sessionId);
            if (turns.has(params.sessionId)) {
                throw acp.RequestError.invalidRequest(
                    { sessionId: params.sessionId },
                    'A prompt is already running in this session'
                );
            }
            if ([...turns.values()].some((turn) => turn.cwd !== cwd)) {
                throw acp.RequestError.invalidRequest(
                    { sessionId: params.sessionId },
                    'A prompt is running in another directory'
                );
            }
            const turn: Turn = {
                cx: client,
                sessionId: params.sessionId,
                cwd,
                openToolCalls: new Set(),
                cancelled: false,
            };
            turns.set(params.sessionId, turn);
            try {
                await useWorkspace(running, cwd);
                return await runPrompt(running, params, turn);
            } finally {
                turns.delete(params.sessionId);
            }
        })
        .onNotification('session/cancel', async ({ params }) => {
            const turn = turns.get(params.sessionId);
            if (turn) turn.cancelled = true;
            await agent?.cancel(params.sessionId);
        })
        .connect(stream);

    await connection.closed;
    await agent?.stop();
}

async function runPrompt(
    agent: DextoAgent,
    params: acp.PromptRequest,
    turn: Turn
): Promise<acp.PromptResponse> {
    let stopReason: acp.StopReason = 'end_turn';
    const events = await agent.stream(promptText(params.prompt), turn.sessionId);
    // A cancel that arrived before the run started found nothing to stop.
    if (turn.cancelled) await agent.cancel(turn.sessionId);
    for await (const event of events) {
        const finished = await forwardEvent(event, turn);
        if (finished !== null) stopReason = finished;
    }
    // v1 has no cancelled tool status: anything left open ends as failed.
    for (const toolCallId of turn.openToolCalls) {
        await sendUpdate(turn, { sessionUpdate: 'tool_call_update', toolCallId, status: 'failed' });
    }
    // A cancelled run's stream just ends; ACP requires the cancelled stop reason.
    return { stopReason: turn.cancelled ? 'cancelled' : stopReason };
}

function sendUpdate(turn: Turn, update: acp.SessionUpdate): Promise<void> {
    return turn.cx.notify(acp.methods.client.session.update, {
        sessionId: turn.sessionId,
        update,
    });
}

/**
 * Reports a tool call once. Dexto raises an approval before its tool-call event reaches the
 * stream, so whichever comes first opens the call.
 */
async function openToolCall(
    turn: Turn,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>
): Promise<void> {
    if (turn.openToolCalls.has(toolCallId)) return;
    turn.openToolCalls.add(toolCallId);
    await sendUpdate(turn, {
        sessionUpdate: 'tool_call',
        toolCallId,
        title: toolTitle(toolName, args),
        kind: toolKind(toolName),
        status: 'pending',
        rawInput: args,
        locations: toolLocations(turn.cwd, args),
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
            await openToolCall(turn, event.callId, event.toolName, event.args);
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
            const text = event.success ? resultText(event) : (event.error ?? 'Tool failed');
            await update({
                sessionUpdate: 'tool_call_update',
                toolCallId: event.callId,
                status: event.success ? 'completed' : 'failed',
                content: [{ type: 'content', content: { type: 'text', text } }],
            });
            return null;
        }
        case 'service:event': {
            if (event.service !== 'todo' || event.event !== 'updated') return null;
            const todos = (event.data as { todos?: Array<{ content: string; status: string }> })
                .todos;
            if (!todos) return null;
            await update({
                sessionUpdate: 'plan',
                entries: todos.map((todo) => ({
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
    turns: Map<string, Turn>
): Promise<ApprovalResponse> {
    const base = {
        approvalId: request.approvalId,
        ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
    };
    const turn = request.sessionId === undefined ? undefined : turns.get(request.sessionId);
    if (turn === undefined || request.sessionId === undefined) {
        return { ...base, status: ApprovalStatus.DENIED, reason: DenialReason.SYSTEM_DENIED };
    }
    let toolCall: acp.ToolCallUpdate;
    if (request.type === ApprovalType.TOOL_APPROVAL) {
        const { toolCallId, toolName, args } = request.metadata;
        await openToolCall(turn, toolCallId, toolName, args);
        toolCall = {
            toolCallId,
            title: toolTitle(toolName, args),
            kind: toolKind(toolName),
            rawInput: args,
        };
    } else {
        toolCall = {
            toolCallId: request.approvalId,
            title: safeStringify(request.metadata),
            kind: 'other',
        };
    }
    const response = await turn.cx.request(acp.methods.client.session.requestPermission, {
        sessionId: request.sessionId,
        toolCall,
        options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'allow_session', name: 'Allow for this session', kind: 'allow_always' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
    });
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
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
        throw acp.RequestError.invalidParams({ value });
    }
    const [provider, model, baseURL] = parsed;
    return {
        provider: provider as ModelPickerModel['provider'],
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

function toolKind(toolName: string): acp.ToolKind {
    const name = toolName.toLowerCase();
    if (/read|glob|list|view/.test(name)) return 'read';
    if (/grep|search|find/.test(name)) return 'search';
    if (/write|edit|patch|replace|create_file/.test(name)) return 'edit';
    if (/delete|remove/.test(name)) return 'delete';
    if (/bash|shell|exec|command|process/.test(name)) return 'execute';
    if (/fetch|http|web/.test(name)) return 'fetch';
    return 'other';
}

function toolTitle(toolName: string, args: Record<string, unknown>): string {
    const path = pathArg(args);
    const command = typeof args.command === 'string' ? args.command : undefined;
    const detail = path ?? command;
    return detail === undefined ? toolName : `${toolName} ${detail}`;
}

function toolLocations(cwd: string, args: Record<string, unknown>): acp.ToolCallLocation[] {
    const path = pathArg(args);
    // ACP locations are absolute; Dexto tools take paths relative to the session directory.
    return path === undefined ? [] : [{ path: resolve(cwd, path) }];
}

function pathArg(args: Record<string, unknown>): string | undefined {
    for (const key of ['file_path', 'path', 'filePath']) {
        const value = args[key];
        if (typeof value === 'string') return value;
    }
    return undefined;
}

function resultText(event: Extract<StreamingEvent, { name: 'llm:tool-result' }>): string {
    const display = event.sanitized?.meta.display;
    if (display?.type === 'diff') return display.unified;
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
