// `cloud agents`: define agents, chat with them, and read their sessions, messages and runs.

import chalk from 'chalk';
import { unwrap, type CloudClient, type V1Body, type V1Response } from '@dexto/cloud-client';

import {
    argument,
    BODY_OPTIONS,
    confirm,
    EXIT_CODES,
    flag,
    integerOption,
    isJsonObject,
    listOption,
    PAGE_OPTIONS,
    pageQuery,
    readJsonBody,
    requireConsent,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
    type OptionSpec,
} from '../command.js';
import { sessionEvents, type AgentEvent } from '../events.js';
import type { Column } from '../output.js';

type Agent = V1Response<'/v1/agents/{agent_id}', 'get'>;
type AgentDefinitionInput = V1Body<'/v1/agents', 'post'>;
type AgentTool = NonNullable<AgentDefinitionInput['tools']>[number];
type RunStep = V1Response<
    '/v1/agents/{agent_id}/sessions/{session_id}/runs/{run_id}/steps',
    'get'
>['data'][number];

function agentPath(agentId: string) {
    return { params: { path: { agent_id: agentId } } };
}

function sessionPath(agentId: string, sessionId: string) {
    return { params: { path: { agent_id: agentId, session_id: sessionId } } };
}

const AGENT_COLUMNS: readonly Column<Agent>[] = [
    { header: 'id', value: (agent) => agent.id },
    { header: 'name', value: (agent) => agent.name },
    { header: 'model', value: (agent) => agent.model ?? 'plan default' },
    { header: 'version', value: (agent) => agent.version },
    { header: 'tools', value: (agent) => agent.tools.map((tool) => tool.type).join(',') },
];

/** Tool kinds a flag can add with their defaults; richer tools come from --file. */
const SIMPLE_TOOLS: Readonly<Record<string, AgentTool>> = {
    automations: { type: 'automations' },
    files: { type: 'files' },
    media: { type: 'media' },
    sandbox: { sandbox: { size: 'large', type: 'session' }, type: 'sandbox' },
    web_fetch: { type: 'web_fetch' },
    web_search: { type: 'web_search' },
};

const DEFINITION_OPTIONS = {
    ...BODY_OPTIONS,
    description: { description: 'A description for your reference.', type: 'string' },
    instructions: { description: "The agent's system instructions.", type: 'string' },
    model: { description: 'A model id from dexto cloud models list.', type: 'string' },
    name: { description: 'Display name.', type: 'string' },
    tool: {
        description: `Add a tool: ${Object.keys(SIMPLE_TOOLS).join(', ')}. Others need --file.`,
        multiple: true,
        type: 'string',
        valueName: 'KIND',
    },
} as const satisfies Record<string, OptionSpec>;

const list: Command = {
    options: PAGE_OPTIONS,
    path: ['cloud', 'agents', 'list'],
    summary: "List the project's agents.",
    async run(context, input) {
        const page = await unwrap(
            await (
                await context.client()
            ).GET('/v1/agents', { params: { query: pageQuery(input) } })
        );
        context.output.list(page, AGENT_COLUMNS);
    },
};

const get: Command = {
    arguments: '<agent_id>',
    path: ['cloud', 'agents', 'get'],
    summary: "Show an agent's current version.",
    async run(context, input) {
        context.output.record(
            await unwrap(
                await (
                    await context.client()
                ).GET('/v1/agents/{agent_id}', agentPath(argument(input, 0, 'agent_id')))
            )
        );
    },
};

const create: Command = {
    options: DEFINITION_OPTIONS,
    path: ['cloud', 'agents', 'create'],
    summary: 'Create an agent from flags, or from a full definition with --file or --data.',
    async run(context, input) {
        const body = await readJsonBody(context, input);
        const definition = mergeDefinition(body === null ? null : asDefinition(body), input);
        const agent = await unwrap(
            await (await context.client()).POST('/v1/agents', { body: definition })
        );
        context.output.result(agent, `Created agent ${agent.id} (${agent.name}).`);
    },
};

const update: Command = {
    arguments: '<agent_id>',
    options: DEFINITION_OPTIONS,
    path: ['cloud', 'agents', 'update'],
    summary: 'Change an agent: flags change those fields, --file replaces the whole definition.',
    async run(context, input) {
        const client = await context.client();
        const agentId = argument(input, 0, 'agent_id');
        const body = await readJsonBody(context, input);
        // The API only replaces whole definitions, so a field change reads the current one first.
        const current = await unwrap(await client.GET('/v1/agents/{agent_id}', agentPath(agentId)));
        const base = body === null ? definitionOf(current) : asDefinition(body);
        const agent = await unwrap(
            await client.PUT('/v1/agents/{agent_id}', {
                ...agentPath(agentId),
                body: { ...mergeDefinition(base, input), expected_version: current.version },
            })
        );
        context.output.result(agent, `Updated agent ${agent.id} to version ${agent.version}.`);
    },
};

const archive: Command = {
    arguments: '<agent_id>',
    options: YES_OPTION,
    path: ['cloud', 'agents', 'archive'],
    summary: 'Archive an agent: it accepts no new runs and its session sandboxes end.',
    async run(context, input) {
        const id = argument(input, 0, 'agent_id');
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Archiving agent ${id} stops its new runs and ends its session sandboxes.`
        );
        const agent = await unwrap(
            await (await context.client()).DELETE('/v1/agents/{agent_id}', agentPath(id))
        );
        context.output.result(agent, `Archived agent ${agent.id}.`);
    },
};

const chat: Command = {
    arguments: '<agent_id> [message...]',
    options: {
        session: {
            description: 'Continue this session instead of starting one.',
            type: 'string',
            valueName: 'ID',
        },
        user: {
            description: 'The end-user label for a new session (default cli).',
            type: 'string',
        },
        yes: { description: 'Approve every tool call the agent asks to make.', type: 'boolean' },
    },
    path: ['cloud', 'agents', 'chat'],
    summary:
        'Send a message and stream the reply. Without a message at a terminal, keeps chatting until an empty line.',
    async run(context, input) {
        const client = await context.client();
        const agentId = argument(input, 0, 'agent_id');
        const sessionId =
            stringOption(input, 'session') ??
            (
                await unwrap(
                    await client.POST('/v1/agents/{agent_id}/sessions', {
                        ...agentPath(agentId),
                        body: { user: stringOption(input, 'user') ?? 'cli' },
                    })
                )
            ).id;
        context.output.note(`Session ${sessionId}`);
        const turn = (message: string) =>
            runTurn(
                context,
                client,
                { agentId, approveAll: flag(input, 'yes'), sessionId },
                message
            );

        const message = input.positionals.slice(1).join(' ');
        if (message.length > 0) return await turn(message);
        const prompt = context.runtime.prompt;
        if (prompt === null) return await turn((await context.runtime.readStdin()).trim());
        for (;;) {
            const next = (await prompt(chalk.bold('> '), { secret: false })).trim();
            if (next.length === 0) return 0;
            const code = await turn(next);
            if (code !== 0) return code;
        }
    },
};

interface TurnTarget {
    readonly agentId: string;
    readonly approveAll: boolean;
    readonly sessionId: string;
}

/**
 * Sends one message and renders its run from the session's events until the run ends. The
 * stream opens before the message is sent so the run's first events are not missed.
 */
async function runTurn(
    context: CommandContext,
    client: CloudClient,
    target: TurnTarget,
    content: string
): Promise<number> {
    if (content.length === 0) throw new UsageError('The message is empty.');
    const { runtime, output } = context;
    const stop = new AbortController();
    const onAbort = () => stop.abort();
    runtime.signal.addEventListener('abort', onAbort);
    const events = sessionEvents(context, target.agentId, target.sessionId, stop.signal)[
        Symbol.asyncIterator
    ]();
    let next = events.next();
    try {
        const run = await unwrap(
            await client.POST('/v1/agents/{agent_id}/sessions/{session_id}/messages', {
                ...sessionPath(target.agentId, target.sessionId),
                body: { content },
            })
        );
        let streamedText = false;
        for (;;) {
            const result = await next;
            if (result.done) break;
            next = events.next();
            const event = result.value;
            if (event.run_id !== run.id) continue;
            // A reply is content: only an explicit --json prints its events.
            if (output.jsonContent) runtime.writeOutput(`${JSON.stringify(event)}\n`);
            else streamedText = renderEvent(context, event, streamedText);
            if (event.type === 'approval.requested') {
                const decided = await decide(context, client, target, event);
                if (!decided) return EXIT_CODES.needs_confirmation;
            }
            if (event.type === 'run.completed') return 0;
            if (event.type === 'run.failed') return 1;
            if (event.type === 'run.cancelled') return 130;
        }
        // The stream closed before the run ended: report what the run says now.
        const latest = await unwrap(
            await client.GET('/v1/agents/{agent_id}/sessions/{session_id}/runs/{run_id}', {
                params: {
                    path: {
                        agent_id: target.agentId,
                        session_id: target.sessionId,
                        run_id: run.id,
                    },
                },
            })
        );
        output.note(`The event stream closed; run ${run.id} is ${latest.status}.`);
        return latest.status === 'failed' ? 1 : 0;
    } finally {
        runtime.signal.removeEventListener('abort', onAbort);
        stop.abort();
        await next.catch(() => undefined);
    }
}

/** Writes one event for people; returns whether the current message has streamed text. */
function renderEvent(context: CommandContext, event: AgentEvent, streamedText: boolean): boolean {
    const { runtime, output } = context;
    switch (event.type) {
        case 'message.delta':
            runtime.writeOutput(event.text);
            return true;
        case 'message.completed':
            runtime.writeOutput(streamedText ? '\n' : `${event.text}\n`);
            return false;
        case 'tool.started':
            output.note(`→ ${event.name} ${summarize(event.arguments)}`);
            return streamedText;
        case 'tool.completed':
            output.note(
                event.error === null
                    ? `✓ ${event.name}`
                    : `✗ ${event.name} ${event.status}: ${event.error.message}`
            );
            return streamedText;
        case 'run.completed':
            output.note(
                `Run ${event.run_id} ${event.stop_reason}: ${event.usage.input_tokens} in, ${event.usage.output_tokens} out, ${event.usage.credits} credits.`
            );
            return false;
        case 'run.failed':
            runtime.writeError(`Run failed (${event.error.code}): ${event.error.message}\n`);
            return false;
        case 'run.cancelled':
            output.note(`Run ${event.run_id} was cancelled.`);
            return false;
        case 'approval.requested':
        case 'approval.resolved':
        case 'run.started':
            return streamedText;
    }
}

/** Decides a requested approval at the terminal; false when nobody here can. */
async function decide(
    context: CommandContext,
    client: CloudClient,
    target: TurnTarget,
    event: Extract<AgentEvent, { type: 'approval.requested' }>
): Promise<boolean> {
    const tool = event.tool_name ?? 'a tool';
    const approve =
        target.approveAll ||
        (context.runtime.prompt !== null &&
            (await confirm(context, `Allow ${tool} ${summarize(event.input)}?`)));
    if (!approve && context.runtime.prompt === null) {
        context.output.note(
            `The run waits for approval ${event.approval_id}. Decide it with: dexto cloud agents approve ${target.agentId} ${target.sessionId} ${event.approval_id} (or reject)`
        );
        return false;
    }
    await unwrap(
        await client.POST('/v1/agents/{agent_id}/sessions/{session_id}/approvals/{approval_id}', {
            params: {
                path: {
                    agent_id: target.agentId,
                    session_id: target.sessionId,
                    approval_id: event.approval_id,
                },
            },
            body: { decision: approve ? 'approve' : 'reject' },
        })
    );
    return true;
}

function decisionCommand(decision: 'approve' | 'reject'): Command {
    return {
        arguments: '<agent_id> <session_id> <approval_id>',
        options:
            decision === 'reject'
                ? { message: { description: 'Why, for the agent.', type: 'string' } }
                : {},
        path: ['cloud', 'agents', decision],
        summary: `${decision === 'approve' ? 'Approve' : 'Reject'} a tool call a run is waiting on.`,
        async run(context, input) {
            const message = stringOption(input, 'message');
            const result = await unwrap(
                await (
                    await context.client()
                ).POST('/v1/agents/{agent_id}/sessions/{session_id}/approvals/{approval_id}', {
                    params: {
                        path: {
                            agent_id: argument(input, 0, 'agent_id'),
                            session_id: argument(input, 1, 'session_id'),
                            approval_id: argument(input, 2, 'approval_id'),
                        },
                    },
                    body: { decision, ...(message === undefined ? {} : { message }) },
                })
            );
            context.output.result(result, `${result.decision} ${result.approval_id}.`);
        },
    };
}

const sessionsList: Command = {
    arguments: '<agent_id>',
    options: {
        ...PAGE_OPTIONS,
        user: { description: "Only this end user's sessions.", type: 'string' },
    },
    path: ['cloud', 'agents', 'sessions', 'list'],
    summary: "List an agent's sessions.",
    async run(context, input) {
        const user = stringOption(input, 'user');
        const page = await unwrap(
            await (
                await context.client()
            ).GET('/v1/agents/{agent_id}/sessions', {
                params: {
                    path: { agent_id: argument(input, 0, 'agent_id') },
                    query: { ...pageQuery(input), ...(user === undefined ? {} : { user }) },
                },
            })
        );
        context.output.list(page, [
            { header: 'id', value: (session) => session.id },
            { header: 'user', value: (session) => session.user },
            { header: 'version', value: (session) => session.version },
            { header: 'active run', value: (session) => session.active_run?.status ?? null },
            { header: 'created', value: (session) => session.created_at },
        ]);
    },
};

const sessionsGet: Command = {
    arguments: '<agent_id> <session_id>',
    path: ['cloud', 'agents', 'sessions', 'get'],
    summary: 'Show a session and its active run.',
    async run(context, input) {
        context.output.record(
            await unwrap(
                await (
                    await context.client()
                ).GET(
                    '/v1/agents/{agent_id}/sessions/{session_id}',
                    sessionPath(argument(input, 0, 'agent_id'), argument(input, 1, 'session_id'))
                )
            )
        );
    },
};

const sessionsDelete: Command = {
    arguments: '<agent_id> <session_id>',
    options: YES_OPTION,
    path: ['cloud', 'agents', 'sessions', 'delete'],
    summary: 'Delete a session with its messages, runs and stored tool output.',
    async run(context, input) {
        const sessionId = argument(input, 1, 'session_id');
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Deleting session ${sessionId} removes its messages, runs and stored tool output for good.`
        );
        const result = await unwrap(
            await (
                await context.client()
            ).DELETE(
                '/v1/agents/{agent_id}/sessions/{session_id}',
                sessionPath(argument(input, 0, 'agent_id'), sessionId)
            )
        );
        context.output.result(result, `Deleted session ${result.id}.`);
    },
};

const sessionsCancel: Command = {
    arguments: '<agent_id> <session_id>',
    path: ['cloud', 'agents', 'sessions', 'cancel'],
    summary: "Cancel the session's active run.",
    async run(context, input) {
        const run = await unwrap(
            await (
                await context.client()
            ).POST(
                '/v1/agents/{agent_id}/sessions/{session_id}/cancel',
                sessionPath(argument(input, 0, 'agent_id'), argument(input, 1, 'session_id'))
            )
        );
        context.output.result(run, `Run ${run.id} is ${run.status}.`);
    },
};

const messages: Command = {
    arguments: '<agent_id> <session_id>',
    options: PAGE_OPTIONS,
    path: ['cloud', 'agents', 'messages'],
    summary: "Read a session's messages, oldest first.",
    async run(context, input) {
        // Messages page by sequence number, not by an opaque cursor like every other list.
        const after = integerOption(input, 'after');
        const limit = integerOption(input, 'limit');
        const page = await unwrap(
            await (
                await context.client()
            ).GET('/v1/agents/{agent_id}/sessions/{session_id}/messages', {
                params: {
                    path: {
                        agent_id: argument(input, 0, 'agent_id'),
                        session_id: argument(input, 1, 'session_id'),
                    },
                    query: {
                        ...(after === undefined ? {} : { after }),
                        ...(limit === undefined ? {} : { limit }),
                    },
                },
            })
        );
        if (context.output.json) return context.output.list(page, []);
        for (const message of page.data)
            context.runtime.writeOutput(`${chalk.bold(message.role)}: ${message.text}\n\n`);
        if (page.has_more && page.next_after !== null)
            context.output.note(`More messages: add --after ${page.next_after}`);
    },
};

const runsList: Command = {
    arguments: '<agent_id> <session_id>',
    options: PAGE_OPTIONS,
    path: ['cloud', 'agents', 'runs', 'list'],
    summary: "List a session's runs, newest first.",
    async run(context, input) {
        const page = await unwrap(
            await (
                await context.client()
            ).GET('/v1/agents/{agent_id}/sessions/{session_id}/runs', {
                params: {
                    path: {
                        agent_id: argument(input, 0, 'agent_id'),
                        session_id: argument(input, 1, 'session_id'),
                    },
                    query: pageQuery(input),
                },
            })
        );
        context.output.list(page, [
            { header: 'id', value: (run) => run.id },
            { header: 'status', value: (run) => run.status },
            { header: 'stop reason', value: (run) => run.stop_reason },
            { header: 'credits', value: (run) => run.usage.credits },
            { header: 'created', value: (run) => run.created_at },
        ]);
    },
};

const runsGet: Command = {
    arguments: '<agent_id> <session_id> <run_id>',
    path: ['cloud', 'agents', 'runs', 'get'],
    summary: 'Show a run: its status, why it stopped and what it used.',
    async run(context, input) {
        context.output.record(
            await unwrap(
                await (
                    await context.client()
                ).GET('/v1/agents/{agent_id}/sessions/{session_id}/runs/{run_id}', {
                    params: {
                        path: {
                            agent_id: argument(input, 0, 'agent_id'),
                            session_id: argument(input, 1, 'session_id'),
                            run_id: argument(input, 2, 'run_id'),
                        },
                    },
                })
            )
        );
    },
};

const runsSteps: Command = {
    arguments: '<agent_id> <session_id> <run_id>',
    path: ['cloud', 'agents', 'runs', 'steps'],
    summary: 'List what a run did: each model turn and tool call.',
    async run(context, input) {
        const client = await context.client();
        const path = {
            agent_id: argument(input, 0, 'agent_id'),
            session_id: argument(input, 1, 'session_id'),
            run_id: argument(input, 2, 'run_id'),
        };
        // Every page, so the whole run reads as one list.
        const steps: RunStep[] = [];
        let after: string | undefined;
        for (;;) {
            const page = await unwrap(
                await client.GET(
                    '/v1/agents/{agent_id}/sessions/{session_id}/runs/{run_id}/steps',
                    {
                        params: { path, query: after === undefined ? {} : { after } },
                    }
                )
            );
            steps.push(...page.data);
            if (!page.has_more || page.next_after === null) break;
            after = page.next_after;
        }
        context.output.list({ data: steps }, [
            { header: 'type', value: (step) => step.type },
            { header: 'status', value: (step) => step.status },
            {
                header: 'detail',
                value: (step) =>
                    step.error !== null
                        ? `${step.error.code}: ${step.error.message}`
                        : step.type === 'model_turn'
                          ? step.text
                          : `${step.name} ${summarize(step.arguments)}`,
            },
            { header: 'started', value: (step) => step.started_at },
        ]);
    },
};

function mergeDefinition(
    base: AgentDefinitionInput | null,
    input: CommandInput
): AgentDefinitionInput {
    const name = stringOption(input, 'name') ?? base?.name;
    const instructions = stringOption(input, 'instructions') ?? base?.instructions;
    if (name === undefined || instructions === undefined)
        throw new UsageError(
            'An agent needs --name and --instructions, or a definition in --file.'
        );
    const description = stringOption(input, 'description') ?? base?.description;
    const model = stringOption(input, 'model') ?? base?.model;
    const added = listOption(input, 'tool').map((kind) => {
        const tool = SIMPLE_TOOLS[kind];
        if (tool === undefined)
            throw new UsageError(
                `Unknown tool ${kind}. Flags add ${Object.keys(SIMPLE_TOOLS).join(', ')}; put others in --file.`
            );
        return tool;
    });
    return {
        instructions,
        name,
        ...(description === undefined ? {} : { description }),
        ...(model === undefined ? {} : { model }),
        tools: [...(base?.tools ?? []), ...added],
    };
}

/**
 * The definition to replace an agent with, from what reading it returned. A read tool's fields
 * are a superset of what a definition accepts (a session sandbox reads as small or large but is
 * created only large), so the read shape is passed back as is and the API judges it.
 */
function definitionOf(agent: Agent): AgentDefinitionInput {
    return {
        description: agent.description,
        instructions: agent.instructions,
        model: agent.model,
        name: agent.name,
        tools: agent.tools.map(definitionTool),
    };
}

function definitionTool(tool: Agent['tools'][number]): AgentTool {
    if (tool.type !== 'sandbox') return tool;
    if (tool.sandbox.type === 'project') return { ...tool, sandbox: tool.sandbox };
    if (tool.sandbox.size !== 'large')
        throw new UsageError(
            `This agent's session sandbox is ${tool.sandbox.size}, which a definition cannot set. Replace the whole definition with --file.`
        );
    return { ...tool, sandbox: { size: 'large', type: 'session' } };
}

/** The API validates the whole definition; the CLI checks only what it reads itself. */
function isDefinition(value: unknown): value is AgentDefinitionInput {
    return (
        isJsonObject(value) &&
        typeof value.name === 'string' &&
        typeof value.instructions === 'string' &&
        (value.tools === undefined || Array.isArray(value.tools))
    );
}

function asDefinition(value: unknown): AgentDefinitionInput {
    if (!isDefinition(value))
        throw new UsageError('The agent definition needs name and instructions strings.');
    return value;
}

function summarize(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

export const agentCommands: readonly Command[] = [
    list,
    get,
    create,
    update,
    archive,
    chat,
    decisionCommand('approve'),
    decisionCommand('reject'),
    sessionsList,
    sessionsGet,
    sessionsDelete,
    sessionsCancel,
    messages,
    runsList,
    runsGet,
    runsSteps,
];
