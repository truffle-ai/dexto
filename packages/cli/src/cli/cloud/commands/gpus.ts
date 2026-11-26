// `gpus profiles|list|get|process|logs` read the account's Dexto-managed GPU sandboxes, and
// `gpus provision|start|stop|delete` and `gpus process start|stop` change them, each through the
// workspace MCP GPU tool of the same name. Every change asks first: `--yes` without a terminal.

import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import { requireConsent } from '../../interaction.js';
import {
    argument,
    boundedOption,
    choiceOption,
    flag,
    requiredOption,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
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
        context.output.result(result, processLine(result.process));
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

const SandboxActionSchema = z.object({ action: z.string(), sandbox: SandboxSchema }).passthrough();
const ProcessActionSchema = z.object({ action: z.string(), process: ProcessSchema }).passthrough();

const DRY_RUN_OPTION = {
    'dry-run': { description: 'Show the call without making it.', type: 'boolean' },
} as const;
const IDEMPOTENCY_KEY_OPTION = {
    'idempotency-key': {
        description:
            'A UUID naming this request; send the same one to retry it without acting twice (default: a new one).',
        type: 'string',
        valueName: 'UUID',
    },
} as const;
const MAX_MINUTES_OPTION = {
    'max-minutes': {
        description: "Stop the sandbox after this many minutes, at most the profile's limit.",
        type: 'string',
        valueName: 'N',
    },
} as const;

function idempotencyKey(input: CommandInput): string {
    const key = stringOption(input, 'idempotency-key');
    if (key === undefined) return randomUUID();
    if (!z.string().uuid().safeParse(key).success)
        throw new UsageError('--idempotency-key must be a UUID.');
    return key;
}

function maximumRuntimeMinutes(input: CommandInput): number {
    const minutes = boundedOption(input, 'max-minutes', 1, Number.MAX_SAFE_INTEGER);
    if (minutes === undefined) throw new UsageError('--max-minutes is required.');
    return minutes;
}

/**
 * Makes one GPU change: with `--dry-run`, only shows the call; otherwise checks `gpu:write`, asks
 * with `question` (or takes `--yes`), calls the tool and prints its result.
 */
async function changeGpu(
    context: CommandContext,
    input: CommandInput,
    call: {
        readonly arguments: Record<string, unknown>;
        readonly print: (context: CommandContext, value: unknown) => void;
        readonly question: string;
        readonly tool: string;
        readonly would: string;
    }
): Promise<void> {
    if (flag(input, 'dry-run'))
        return context.output.result(
            { arguments: call.arguments, dryRun: true, tool: call.tool },
            `Would ${call.would}.`
        );
    await requireLoginScopes(context, ['gpu:write']);
    await requireConsent(context, flag(input, 'yes'), call.question);
    call.print(context, await queryWorkspaceTool(context, call.tool, call.arguments));
}

function processLine(status: z.output<typeof ProcessSchema>): string {
    return `${status.id} ${status.state}${status.exitCode === null ? '' : ` (exit ${status.exitCode})`}`;
}

function printSandboxChange(context: CommandContext, value: unknown): void {
    const result = SandboxActionSchema.parse(value);
    const { sandbox } = result;
    context.output.result(
        result,
        `${sandbox.name} ${sandbox.status} (${sandbox.id})${
            sandbox.expiresAt === null ? '' : `, expires ${sandbox.expiresAt}`
        }`
    );
}

function printProcessChange(context: CommandContext, value: unknown): void {
    const result = ProcessActionSchema.parse(value);
    context.output.result(result, processLine(result.process));
}

const provision: Command = {
    arguments: '<name>',
    options: {
        image: { description: 'The image to run, one the profile supports.', type: 'string' },
        profile: {
            description: 'The GPU profile, from `dexto gpus profiles`.',
            type: 'string',
            valueName: 'ID',
        },
        ...MAX_MINUTES_OPTION,
        ...IDEMPOTENCY_KEY_OPTION,
        ...DRY_RUN_OPTION,
        ...YES_OPTION,
    },
    path: ['gpus', 'provision'],
    summary: 'Provision and start a GPU sandbox, billed to your account while it runs.',
    examples: [
        'dexto gpus provision train --profile "$PROFILE_ID" --image pytorch --max-minutes 60 --yes --json',
        'dexto gpus provision train --profile "$PROFILE_ID" --image pytorch --max-minutes 60 --idempotency-key "$KEY" --dry-run',
    ],
    async run(context, input) {
        const name = argument(input, 0, 'name');
        const profileId = requiredOption(input, 'profile');
        const imageId = requiredOption(input, 'image');
        const minutes = maximumRuntimeMinutes(input);
        await changeGpu(context, input, {
            arguments: {
                idempotencyKey: idempotencyKey(input),
                imageId,
                maximumRuntimeMinutes: minutes,
                name,
                profileId,
            },
            question: `Provision GPU sandbox ${name} (${profileId}) for up to ${minutes} minutes? Its compute and storage are billed to your account.`,
            print: printSandboxChange,
            tool: 'dexto_gpu_sandbox_provision',
            would: `provision GPU sandbox ${name} (${profileId}, ${imageId}) for up to ${minutes} minutes`,
        });
    },
};

const start: Command = {
    arguments: '<sandbox_id>',
    options: { ...MAX_MINUTES_OPTION, ...DRY_RUN_OPTION, ...YES_OPTION },
    path: ['gpus', 'start'],
    summary: 'Start a stopped GPU sandbox again, billed to your account while it runs.',
    examples: ['dexto gpus start "$SANDBOX_ID" --max-minutes 30 --yes --json'],
    async run(context, input) {
        const sandboxId = argument(input, 0, 'sandbox_id');
        const minutes = maximumRuntimeMinutes(input);
        await changeGpu(context, input, {
            arguments: { maximumRuntimeMinutes: minutes, sandboxId },
            question: `Start GPU sandbox ${sandboxId} for up to ${minutes} minutes? Its compute is billed to your account.`,
            print: printSandboxChange,
            tool: 'dexto_gpu_sandbox_start',
            would: `start GPU sandbox ${sandboxId} for up to ${minutes} minutes`,
        });
    },
};

const stop: Command = {
    arguments: '<sandbox_id>',
    options: { ...DRY_RUN_OPTION, ...YES_OPTION },
    path: ['gpus', 'stop'],
    summary: "Stop a GPU sandbox's compute, keeping its workspace files.",
    examples: ['dexto gpus stop "$SANDBOX_ID" --yes --json'],
    async run(context, input) {
        const sandboxId = argument(input, 0, 'sandbox_id');
        await changeGpu(context, input, {
            arguments: { sandboxId },
            question: `Stop GPU sandbox ${sandboxId}? Its running processes end; its workspace files stay.`,
            print: printSandboxChange,
            tool: 'dexto_gpu_sandbox_stop',
            would: `stop GPU sandbox ${sandboxId}`,
        });
    },
};

const remove: Command = {
    arguments: '<sandbox_id>',
    options: { ...DRY_RUN_OPTION, ...YES_OPTION },
    path: ['gpus', 'delete'],
    summary: 'Delete a GPU sandbox, its compute and its workspace files.',
    examples: ['dexto gpus delete "$SANDBOX_ID" --yes --json'],
    async run(context, input) {
        const sandboxId = argument(input, 0, 'sandbox_id');
        await changeGpu(context, input, {
            arguments: { sandboxId },
            question: `Deleting GPU sandbox ${sandboxId} and its workspace files can't be undone.`,
            print: printSandboxChange,
            tool: 'dexto_gpu_sandbox_delete',
            would: `delete GPU sandbox ${sandboxId} and its workspace files`,
        });
    },
};

const processStart: Command = {
    arguments: '<sandbox_id> <command>',
    options: {
        cwd: {
            description: 'Run it in this directory (default /workspace).',
            type: 'string',
            valueName: 'DIR',
        },
        ...IDEMPOTENCY_KEY_OPTION,
        ...DRY_RUN_OPTION,
        ...YES_OPTION,
    },
    path: ['gpus', 'process', 'start'],
    summary:
        'Start a command in a running GPU sandbox; it keeps running after this returns its process.',
    examples: [
        'dexto gpus process start "$SANDBOX_ID" "python train.py --epochs 3" --yes --json',
        'dexto gpus process start "$SANDBOX_ID" "nvidia-smi" --cwd /workspace --idempotency-key "$KEY" --yes',
    ],
    async run(context, input) {
        const sandboxId = argument(input, 0, 'sandbox_id');
        const command = argument(input, 1, 'command');
        const cwd = stringOption(input, 'cwd');
        await changeGpu(context, input, {
            arguments: {
                command,
                ...(cwd === undefined ? {} : { cwd }),
                idempotencyKey: idempotencyKey(input),
                sandboxId,
            },
            question: `Run \`${command}\` in GPU sandbox ${sandboxId}?`,
            print: printProcessChange,
            tool: 'dexto_gpu_process_start',
            would: `run \`${command}\` in GPU sandbox ${sandboxId}`,
        });
    },
};

const processStop: Command = {
    arguments: '<sandbox_id> <process_id>',
    options: { ...DRY_RUN_OPTION, ...YES_OPTION },
    path: ['gpus', 'process', 'stop'],
    summary: 'Stop one process in a running GPU sandbox.',
    examples: ['dexto gpus process stop "$SANDBOX_ID" "$PROCESS_ID" --yes --json'],
    async run(context, input) {
        const sandboxId = argument(input, 0, 'sandbox_id');
        const processId = argument(input, 1, 'process_id');
        await changeGpu(context, input, {
            arguments: { processId, sandboxId },
            question: `Stop process ${processId} in GPU sandbox ${sandboxId}?`,
            print: printProcessChange,
            tool: 'dexto_gpu_process_stop',
            would: `stop process ${processId} in GPU sandbox ${sandboxId}`,
        });
    },
};

export const gpuCommands: readonly Command[] = [
    profiles,
    list,
    get,
    processGet,
    logs,
    provision,
    start,
    stop,
    remove,
    processStart,
    processStop,
];
