// `cloud sites logs` and `cloud functions logs`: the last hour of requests to a Site's backend or a
// Function, as Dexto recorded them, redacted, over Dexto's typed log tools. Read-only.

import { z } from 'zod';
import { argument, type Command, type CommandContext } from '../command.js';
import type { Column } from '../output.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const EntrySchema = z.discriminatedUnion('outcome', [
    z
        .object({
            deploymentId: z.string(),
            durationMs: z.number(),
            method: z.string(),
            outcome: z.literal('response'),
            path: z.string(),
            status: z.number(),
            time: z.string(),
        })
        .passthrough(),
    z
        .object({
            deploymentId: z.string(),
            durationMs: z.number(),
            errorMessage: z.string(),
            errorType: z.string(),
            method: z.string(),
            outcome: z.literal('error'),
            path: z.string(),
            time: z.string(),
        })
        .passthrough(),
]);
const LogsSchema = z.discriminatedUnion('status', [
    z.object({ message: z.string(), status: z.literal('not-configured') }).passthrough(),
    z
        .object({
            entries: z.array(EntrySchema),
            from: z.string(),
            limitation: z.string(),
            status: z.literal('ok'),
            to: z.string(),
        })
        .passthrough(),
]);

type Entry = z.output<typeof EntrySchema>;

const ENTRY_COLUMNS: readonly Column<Entry>[] = [
    { header: 'time', value: (entry) => entry.time },
    { header: 'method', value: (entry) => entry.method },
    { header: 'path', value: (entry) => entry.path },
    {
        header: 'result',
        value: (entry) =>
            entry.outcome === 'response'
                ? entry.status
                : `${entry.errorType}: ${entry.errorMessage}`,
    },
    { header: 'ms', value: (entry) => entry.durationMs },
    { header: 'deployment', value: (entry) => entry.deploymentId },
];

const siteLogs: Command = {
    arguments: '<site_id>',
    path: ['cloud', 'sites', 'logs'],
    summary:
        "Read the last hour of requests to a Site's backend, newest first: each one's status or error, redacted.",
    examples: ['dexto cloud sites logs "$SITE_ID" --json'],
    async run(context, input) {
        const siteId = argument(input, 0, 'site_id');
        await requireLoginScopes(context, ['sites:read']);
        printLogs(context, await queryWorkspaceTool(context, 'dexto_site_logs', { siteId }));
    },
};

const functionLogs: Command = {
    arguments: '<function_id>',
    path: ['cloud', 'functions', 'logs'],
    summary:
        "Read the last hour of a Function's requests, newest first: each one's status or error, redacted.",
    examples: ['dexto cloud functions logs "$FUNCTION_ID" --json'],
    async run(context, input) {
        const projectId = argument(input, 0, 'function_id');
        await requireLoginScopes(context, ['functions:read']);
        printLogs(context, await queryWorkspaceTool(context, 'dexto_function_logs', { projectId }));
    },
};

/** JSON keeps the tool's own response; people get the requests as a table and its limits. */
function printLogs(context: CommandContext, value: unknown): void {
    const logs = LogsSchema.parse(value);
    if (context.output.json) return context.output.record(logs);
    if (logs.status === 'not-configured') return context.output.result(logs, logs.message);
    context.output.list({ data: logs.entries }, ENTRY_COLUMNS);
    context.output.note(`Requests from ${logs.from} to ${logs.to}. ${logs.limitation}`);
}

export const backendLogCommands: readonly Command[] = [siteLogs, functionLogs];
