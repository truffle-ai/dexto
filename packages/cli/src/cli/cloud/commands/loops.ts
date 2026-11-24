// `loops`: read your account's, an agent's or a Project's Loops and their runs, over Dexto's typed
// Loop tools. Creating, changing, running and deleting Loops stay with those tools.

import { z } from 'zod';
import {
    argument,
    flag,
    integerOption,
    PAGE_OPTIONS,
    pageQuery,
    stringOption,
    UsageError,
    type Command,
    type CommandInput,
} from '../command.js';
import type { Column } from '../output.js';
import { queryWorkspaceTool } from './workspace.js';

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
        const { automations, nextCursor, ...facts } = ListSchema.parse(
            await queryWorkspaceTool(context, 'dexto_automations_list', {
                ...listScope(input),
                ...enabledFilter(input),
                ...(limit === undefined ? {} : { limit }),
                ...(after === undefined ? {} : { cursor: after }),
            })
        );
        context.output.list(
            {
                ...facts,
                data: automations,
                has_more: nextCursor !== null,
                next_after: nextCursor,
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

export const loopCommands: readonly Command[] = [list, get];
