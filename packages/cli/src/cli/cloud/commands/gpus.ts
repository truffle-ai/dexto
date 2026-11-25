// `gpus profiles|list|get|process|logs`: read the account's Dexto-managed GPU sandboxes through the
// workspace MCP's GPU read tools. Nothing here provisions, starts, stops or runs anything.

import { z } from 'zod';
import {
    argument,
    boundedOption,
    choiceOption,
    type Command,
    type CommandContext,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

/** The server's own bounds, checked before anything is sent. */
const MAX_SANDBOX_CURSOR = 10_000;
const MAX_LOG_BYTES = 64 * 1024;
const LOG_STREAMS = ['stdout', 'stderr'] as const;

const ProfileSchema = z
    .object({
        id: z.string(),
        title: z.string(),
        estimatedUsdPerHour: z.number(),
        maximumRuntimeMinutes: z.number(),
        resources: z
            .object({
                gpu: z.object({ count: z.number(), model: z.string() }).passthrough(),
            })
            .passthrough(),
    })
    .passthrough();
const SandboxSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        status: z.string(),
        profileId: z.string(),
        expiresAt: z.string().nullable(),
    })
    .passthrough();
const ProcessSchema = z
    .object({ id: z.string(), state: z.string(), exitCode: z.number().nullable() })
    .passthrough();

const ProfilesSchema = z.object({ profiles: z.array(ProfileSchema) }).passthrough();
const SandboxPageSchema = z
    .object({
        sandboxes: z.array(SandboxSchema),
        pagination: z.object({ nextCursor: z.number().nullable() }),
    })
    .passthrough();
const SandboxResultSchema = z.object({ sandbox: SandboxSchema }).passthrough();
const ProcessResultSchema = z.object({ process: ProcessSchema }).passthrough();
const LogsSchema = z
    .object({
        text: z.string(),
        eof: z.boolean(),
        nextCursor: z.number(),
    })
    .passthrough();

async function readGpuTool(
    context: CommandContext,
    name: string,
    input: Record<string, unknown>
): Promise<unknown> {
    await requireLoginScopes(context, ['gpu:read']);
    return await queryWorkspaceTool(context, name, input);
}

const profiles: Command = {
    path: ['gpus', 'profiles'],
    summary: 'List the GPU profiles your account can use, with their limits and hourly rates.',
    examples: ['dexto gpus profiles --json'],
    async run(context) {
        const result = ProfilesSchema.parse(
            await readGpuTool(context, 'dexto_gpu_profiles_list', {})
        );
        context.output.list({ data: result.profiles }, [
            { header: 'id', value: (profile) => profile.id },
            { header: 'title', value: (profile) => profile.title },
            {
                header: 'gpu',
                value: (profile) =>
                    `${profile.resources.gpu.count}x ${profile.resources.gpu.model}`,
            },
            { header: 'usd/hour', value: (profile) => profile.estimatedUsdPerHour },
            { header: 'max minutes', value: (profile) => profile.maximumRuntimeMinutes },
        ]);
    },
};

const list: Command = {
    options: {
        after: {
            description: 'Start after this cursor, from the previous page.',
            type: 'string',
            valueName: 'CURSOR',
        },
        limit: {
            description: 'How many to return, 1 to 100 (default 50).',
            type: 'string',
            valueName: 'N',
        },
    },
    path: ['gpus', 'list'],
    summary: 'List the GPU sandboxes your account keeps.',
    examples: ['dexto gpus list --json', 'dexto gpus list --after "$CURSOR" --json'],
    async run(context, input) {
        const limit = boundedOption(input, 'limit', 1, 100);
        const cursor = boundedOption(input, 'after', 0, MAX_SANDBOX_CURSOR);
        const page = SandboxPageSchema.parse(
            await readGpuTool(context, 'dexto_gpu_sandboxes_list', {
                ...(limit === undefined ? {} : { limit }),
                ...(cursor === undefined ? {} : { cursor }),
            })
        );
        context.output.list(
            {
                data: page.sandboxes,
                has_more: page.pagination.nextCursor !== null,
                next_after: page.pagination.nextCursor,
            },
            [
                { header: 'id', value: (sandbox) => sandbox.id },
                { header: 'name', value: (sandbox) => sandbox.name },
                { header: 'status', value: (sandbox) => sandbox.status },
                { header: 'profile', value: (sandbox) => sandbox.profileId },
                { header: 'expires', value: (sandbox) => sandbox.expiresAt },
            ]
        );
    },
};

const get: Command = {
    arguments: '<sandbox_id>',
    path: ['gpus', 'get'],
    summary: 'Show one GPU sandbox your account keeps.',
    examples: ['dexto gpus get "$SANDBOX_ID" --json'],
    async run(context, input) {
        const sandboxId = argument(input, 0, 'sandbox_id');
        const result = SandboxResultSchema.parse(
            await readGpuTool(context, 'dexto_gpu_sandbox_get', { sandboxId })
        );
        const { sandbox } = result;
        context.output.result(
            result,
            `${sandbox.name} ${sandbox.status} (${sandbox.profileId})${
                sandbox.expiresAt === null ? '' : `, expires ${sandbox.expiresAt}`
            }`
        );
    },
};

const processGet: Command = {
    arguments: '<sandbox_id> <process_id>',
    path: ['gpus', 'process'],
    summary: 'Show one process in a running GPU sandbox: its state and exit code.',
    examples: ['dexto gpus process "$SANDBOX_ID" "$PROCESS_ID" --json'],
    async run(context, input) {
        const sandboxId = argument(input, 0, 'sandbox_id');
        const processId = argument(input, 1, 'process_id');
        const result = ProcessResultSchema.parse(
            await readGpuTool(context, 'dexto_gpu_process_get', { processId, sandboxId })
        );
        const { process: status } = result;
        context.output.result(
            result,
            `${status.id} ${status.state}${status.exitCode === null ? '' : ` (exit ${status.exitCode})`}`
        );
    },
};

const logs: Command = {
    arguments: '<sandbox_id> <process_id>',
    options: {
        after: {
            description: 'Start at this byte cursor, from the previous page (default 0).',
            type: 'string',
            valueName: 'CURSOR',
        },
        'limit-bytes': {
            description: `Most bytes to read, 1 to ${MAX_LOG_BYTES}.`,
            type: 'string',
            valueName: 'N',
        },
        stream: {
            description: 'Which output to read: stdout (default) or stderr.',
            type: 'string',
        },
    },
    path: ['gpus', 'logs'],
    summary: "Read one page of a GPU process's stdout or stderr.",
    examples: [
        'dexto gpus logs "$SANDBOX_ID" "$PROCESS_ID" --stream stderr --json',
        'dexto gpus logs "$SANDBOX_ID" "$PROCESS_ID" --after "$CURSOR"',
    ],
    async run(context, input) {
        const sandboxId = argument(input, 0, 'sandbox_id');
        const processId = argument(input, 1, 'process_id');
        const cursor = boundedOption(input, 'after', 0, Number.MAX_SAFE_INTEGER);
        const limitBytes = boundedOption(input, 'limit-bytes', 1, MAX_LOG_BYTES);
        const stream = choiceOption(input, 'stream', LOG_STREAMS);
        const result = LogsSchema.parse(
            await readGpuTool(context, 'dexto_gpu_process_logs', {
                processId,
                sandboxId,
                ...(cursor === undefined ? {} : { cursor }),
                ...(limitBytes === undefined ? {} : { limitBytes }),
                ...(stream === undefined ? {} : { stream }),
            })
        );
        if (context.output.jsonContent) return context.output.record(result);
        context.runtime.writeOutput(result.text);
        if (!result.eof) context.output.note(`More output: add --after ${result.nextCursor}`);
    },
};

export const gpuCommands: readonly Command[] = [profiles, list, get, processGet, logs];
