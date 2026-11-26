// `loops`: read your account's, an agent's or a Project's Loops and their runs, create and change
// them, run one now or delete it, over Dexto's typed Loop tools.

import { z } from 'zod';
import { CommandFailure } from '../../failure.js';
import {
    argument,
    BODY_OPTIONS,
    flag,
    integerOption,
    isJsonObject,
    PAGE_OPTIONS,
    pageQuery,
    readJsonBody,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import type { Column } from '../output.js';
import { requireLoginScopes } from './deploys.js';
import { agreeToCall, listWorkspaceTools, queryWorkspaceTool, toolCallLevel } from './workspace.js';

const LoopSchema = z
    .object({
        enabled: z.boolean(),
        id: z.string(),
        name: z.string(),
        nextRunAt: z.string().nullable(),
        scheduleType: z.string(),
    })
    .passthrough();
const RunSchema = z
    .object({ id: z.string(), status: z.string(), triggeredAt: z.string().nullable() })
    .passthrough();
const ListSchema = z
    .object({ automations: z.array(LoopSchema), nextCursor: z.string().nullable() })
    .passthrough();
const GetSchema = z
    .object({ automation: LoopSchema, executions: z.array(RunSchema).optional() })
    .passthrough();

type Loop = z.output<typeof LoopSchema>;
type Run = z.output<typeof RunSchema>;

const LOOP_COLUMNS: readonly Column<Loop>[] = [
    { header: 'id', value: (loop) => loop.id },
    { header: 'name', value: (loop) => loop.name },
    { header: 'starts', value: (loop) => loop.scheduleType },
    { header: 'enabled', value: (loop) => loop.enabled },
    { header: 'next run', value: (loop) => loop.nextRunAt },
];
const RUN_COLUMNS: readonly Column<Run>[] = [
    { header: 'run', value: (run) => run.id },
    { header: 'status', value: (run) => run.status },
    { header: 'triggered', value: (run) => run.triggeredAt },
];

/** Whose Loops to list, as the tool takes it: an agent's, the account's or a Project's. */
function listScope(input: CommandInput): Record<string, unknown> {
    const agentId = stringOption(input, 'agent');
    const chatProjectId = stringOption(input, 'in-project');
    const agent = agentId === undefined ? {} : { agentId };
    if (flag(input, 'account') && chatProjectId !== undefined)
        throw new UsageError('Pass --account or --in-project, not both.');
    if (flag(input, 'account')) return { scope: { type: 'account', ...agent } };
    if (chatProjectId !== undefined) return { scope: { type: 'project', chatProjectId, ...agent } };
    return agent;
}

function enabledFilter(input: CommandInput): { enabled?: boolean } {
    if (flag(input, 'enabled') && flag(input, 'paused'))
        throw new UsageError('Pass --enabled or --paused, not both.');
    if (flag(input, 'enabled')) return { enabled: true };
    if (flag(input, 'paused')) return { enabled: false };
    return {};
}

const list: Command = {
    path: ['loops', 'list'],
    summary:
        "List Loops and what starts each: by default your account's, or an agent's or a Project's.",
    examples: [
        'dexto loops list --json',
        'dexto loops list --agent "$AGENT_ID" --json',
        'dexto loops list --in-project "$PROJECT_ID" --paused --json',
    ],
    options: {
        account: {
            description: "The account's Loops, with --agent for that agent's there.",
            type: 'boolean',
        },
        agent: {
            description:
                "This agent's Loops; with --account or --in-project, only its Loops there.",
            type: 'string',
            valueName: 'AGENT_ID',
        },
        enabled: { description: 'Only Loops that are on.', type: 'boolean' },
        'in-project': {
            description: "This Dexto Project's Loops.",
            type: 'string',
            valueName: 'PROJECT_ID',
        },
        paused: { description: 'Only Loops that are paused.', type: 'boolean' },
        ...PAGE_OPTIONS,
    },
    async run(context, input) {
        const { after, limit } = pageQuery(input);
        const result = ListSchema.parse(
            await queryWorkspaceTool(context, 'dexto_automations_list', {
                ...listScope(input),
                ...enabledFilter(input),
                ...(limit === undefined ? {} : { limit }),
                ...(after === undefined ? {} : { cursor: after }),
            })
        );
        // JSON keeps the tool's own response, nextCursor included.
        if (context.output.json) return context.output.record(result);
        context.output.list(
            {
                data: result.automations,
                has_more: result.nextCursor !== null,
                next_after: result.nextCursor,
            },
            LOOP_COLUMNS
        );
    },
};

const get: Command = {
    arguments: '<loop_id>',
    path: ['loops', 'get'],
    summary: 'Show one Loop, with its recent runs (--history) or one run in full (--execution).',
    examples: [
        'dexto loops get "$LOOP_ID" --json',
        'dexto loops get "$LOOP_ID" --history --history-limit 50 --json',
        'dexto loops get "$LOOP_ID" --execution "$RUN_ID" --json',
    ],
    options: {
        execution: {
            description:
                'Read this one run as it ran: its instruction, its full result and what started it.',
            type: 'string',
            valueName: 'RUN_ID',
        },
        history: { description: 'Include its recent runs.', type: 'boolean' },
        'history-limit': {
            description: 'How many recent runs to include (at most 100).',
            type: 'string',
            valueName: 'N',
        },
        'payload-offset': {
            description: "Continue the run's starting content from here (with --execution).",
            type: 'string',
            valueName: 'N',
        },
        'text-offset': {
            description: "Continue the run's result text from here (with --execution).",
            type: 'string',
            valueName: 'N',
        },
    },
    async run(context, input) {
        const automationId = argument(input, 0, 'loop_id');
        const executionId = stringOption(input, 'execution');
        const historyLimit = integerOption(input, 'history-limit');
        const textOffset = integerOption(input, 'text-offset');
        const payloadOffset = integerOption(input, 'payload-offset');
        const includeHistory = flag(input, 'history') || historyLimit !== undefined;
        const result = GetSchema.parse(
            await queryWorkspaceTool(context, 'dexto_automation_get', {
                automationId,
                ...(includeHistory ? { includeHistory } : {}),
                ...(historyLimit === undefined ? {} : { historyLimit }),
                ...(executionId === undefined ? {} : { executionId }),
                ...(textOffset === undefined ? {} : { textOffset }),
                ...(payloadOffset === undefined ? {} : { payloadOffset }),
            })
        );
        // JSON keeps the tool's own response; people get the Loop, then a table of its runs.
        if (context.output.json) return context.output.record(result);
        context.output.record(result.automation);
        if (result.executions !== undefined)
            context.output.list({ data: result.executions }, RUN_COLUMNS);
    },
};

const SavedSchema = z.object({ automation: LoopSchema }).passthrough();
const TriggeredSchema = z.object({ execution: RunSchema }).passthrough();
const DeletedSchema = z.object({ ok: z.literal(true) }).passthrough();

/**
 * Calls a Loop tool that changes a Loop, once the person agreed as the tool's own level asks:
 * creating, changing and running are `work` and go ahead, deleting is `act` and asks first (or
 * needs --yes). The call goes as given; the server keeps its own refusals.
 */
async function changeLoop(
    context: CommandContext,
    name:
        | 'dexto_automation_create'
        | 'dexto_automation_delete'
        | 'dexto_automation_trigger'
        | 'dexto_automation_update',
    call: Record<string, unknown>,
    title: string,
    yes: boolean
): Promise<unknown> {
    await requireLoginScopes(context, ['automations:write']);
    const tool = (await listWorkspaceTools(context)).find((each) => each.name === name);
    if (tool === undefined)
        throw new CommandFailure('failed', "This Dexto can't change Loops this way yet.", null);
    const agreed = await agreeToCall(
        context,
        { level: toolCallLevel(tool, call), schema: tool.inputSchema, title },
        yes
    );
    return await queryWorkspaceTool(context, name, { ...call, ...agreed });
}

const run: Command = {
    arguments: '<loop_id>',
    options: { ...YES_OPTION },
    path: ['loops', 'run'],
    summary: 'Run a Loop now, outside its schedule. Prints the run it started.',
    examples: ['dexto loops run "$LOOP_ID" --json'],
    async run(context, input) {
        const automationId = argument(input, 0, 'loop_id');
        const value = await changeLoop(
            context,
            'dexto_automation_trigger',
            { automationId },
            `Run Loop ${automationId} now`,
            flag(input, 'yes')
        );
        const { execution } = TriggeredSchema.parse(value);
        context.output.result(
            value,
            `Loop ${automationId} started run ${execution.id} (${execution.status}).`
        );
    },
};

const remove: Command = {
    arguments: '<loop_id>',
    options: { ...YES_OPTION },
    path: ['loops', 'delete'],
    summary: "Delete a Loop and stop its future runs. Can't be undone; asks first.",
    examples: ['dexto loops delete "$LOOP_ID" --yes --json'],
    async run(context, input) {
        const automationId = argument(input, 0, 'loop_id');
        const value = DeletedSchema.parse(
            await changeLoop(
                context,
                'dexto_automation_delete',
                { automationId },
                `Delete Loop ${automationId}`,
                flag(input, 'yes')
            )
        );
        context.output.result(value, `Deleted Loop ${automationId}.`);
    },
};

/** The Loop as the tool takes it, from --data or --file: a JSON object, passed on whole. */
async function readLoopBody(
    context: CommandContext,
    input: CommandInput
): Promise<Record<string, unknown>> {
    const body = await readJsonBody(context, input);
    if (!isJsonObject(body))
        throw new UsageError(
            'Pass the Loop as a JSON object with --data or --file, as dexto workspace describe shows its input.'
        );
    return body;
}

const create: Command = {
    options: { ...BODY_OPTIONS, ...YES_OPTION },
    path: ['loops', 'create'],
    summary:
        'Create a Loop from its input as JSON: name, instruction, schedule or trigger, scope, execution, reporting.',
    examples: [
        'dexto loops create --data \'{"name":"Morning triage","instruction":"Summarize new issues.","schedule":{"type":"cron","expression":"0 9 * * *","timezone":"UTC"}}\' --json',
        'dexto loops create --file loop.json --json',
    ],
    async run(context, input) {
        const call = await readLoopBody(context, input);
        const value = await changeLoop(
            context,
            'dexto_automation_create',
            call,
            'Create a Loop',
            flag(input, 'yes')
        );
        const { automation } = SavedSchema.parse(value);
        context.output.result(value, `Created Loop ${automation.id} (${automation.name}).`);
    },
};

const update: Command = {
    arguments: '<loop_id>',
    options: { ...BODY_OPTIONS, ...YES_OPTION },
    path: ['loops', 'update'],
    summary:
        'Change a Loop by id with the fields to change as JSON. A new trigger replaces what starts it.',
    examples: [
        'dexto loops update "$LOOP_ID" --data \'{"enabled":false}\' --json',
        'dexto loops update "$LOOP_ID" --file changes.json --json',
    ],
    async run(context, input) {
        const automationId = argument(input, 0, 'loop_id');
        const changes = await readLoopBody(context, input);
        if (changes.automationId !== undefined && changes.automationId !== automationId)
            throw new UsageError('The JSON names another Loop than <loop_id>; pass one Loop.');
        const value = await changeLoop(
            context,
            'dexto_automation_update',
            { ...changes, automationId },
            `Update Loop ${automationId}`,
            flag(input, 'yes')
        );
        const { automation } = SavedSchema.parse(value);
        context.output.result(value, `Updated Loop ${automation.id} (${automation.name}).`);
    },
};

export const loopCommands: readonly Command[] = [list, get, create, update, run, remove];
