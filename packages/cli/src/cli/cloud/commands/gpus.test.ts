import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingScopeFailure, type CommandContext } from '../command.js';
import { CommandFailure } from '../../failure.js';
import { GLOBAL_OPTIONS } from '../run.js';
import { gpuCommands } from './gpus.js';

const query = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', () => ({ queryWorkspaceTool: query }));

const [profiles, list, get, processGet, logs] = gpuCommands;
const sandboxId = '3f1c2a4e-8b7d-4c6e-9a1f-2b3c4d5e6f70';
const processId = `proc_${'a'.repeat(32)}`;
const sandbox = {
    expiresAt: '2026-11-25T12:00:00.000Z',
    id: sandboxId,
    imageId: 'pytorch',
    name: 'train',
    profileId: 'a100-1x',
    status: 'running',
    workspaceTarget: { id: sandboxId, kind: 'managed_gpu_sandbox' },
};

function contextWith(scopes: readonly string[], jsonContent = true) {
    const output = { jsonContent, list: vi.fn(), note: vi.fn(), record: vi.fn(), result: vi.fn() };
    const runtime = { environment: {}, prompt: null, writeOutput: vi.fn() };
    const context = {
        connection: async () => ({ kind: 'oauth', login: { scopes } }),
        invocation: ['gpus'],
        output,
        overrides: { profile: null },
        runtime,
    } as unknown as CommandContext;
    return { context, output, runtime };
}

beforeEach(() => query.mockReset());

describe('dexto gpus', () => {
    it('registers the read commands, then the lifecycle and process commands', () => {
        expect(gpuCommands.map((command) => command.path.join(' '))).toEqual([
            'gpus profiles',
            'gpus list',
            'gpus get',
            'gpus process',
            'gpus logs',
            'gpus provision',
            'gpus start',
            'gpus stop',
            'gpus delete',
            'gpus process start',
            'gpus process stop',
        ]);
    });

    it('lists profiles with dexto_gpu_profiles_list and no input', async () => {
        const { context, output } = contextWith(['gpu:read']);
        const profile = {
            estimatedUsdPerHour: 2.5,
            id: 'a100-1x',
            maximumRuntimeMinutes: 240,
            resources: {
                cpuCores: 8,
                gpu: { count: 1, memoryMibPerDevice: 81920, model: 'A100', vendor: 'nvidia' },
                memoryMib: 65536,
            },
            supportedImageIds: ['pytorch'],
            title: 'One A100',
        };
        query.mockResolvedValueOnce({ action: 'list_profiles', profiles: [profile] });
        await profiles?.run(context, { positionals: [], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_gpu_profiles_list', {});
        expect(output.list).toHaveBeenCalledWith({ data: [profile] }, expect.any(Array));
    });

    it('pages sandboxes by the numeric cursor and passes the next one back', async () => {
        const { context, output } = contextWith(['gpu:read']);
        query.mockResolvedValueOnce({
            action: 'list',
            pagination: { nextCursor: 20 },
            sandboxes: [sandbox],
        });
        await list?.run(context, { positionals: [], values: { after: '10', limit: '10' } });
        expect(query).toHaveBeenCalledWith(context, 'dexto_gpu_sandboxes_list', {
            cursor: 10,
            limit: 10,
        });
        expect(output.list).toHaveBeenCalledWith(
            { data: [sandbox], has_more: true, next_after: 20 },
            expect.any(Array)
        );
    });

    it("sends no paging by default and refuses values outside the server's bounds", async () => {
        const { context, output } = contextWith(['gpu:read']);
        query.mockResolvedValueOnce({
            action: 'list',
            pagination: { nextCursor: null },
            sandboxes: [],
        });
        await list?.run(context, { positionals: [], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_gpu_sandboxes_list', {});
        expect(output.list).toHaveBeenCalledWith(
            { data: [], has_more: false, next_after: null },
            expect.any(Array)
        );
        await expect(
            list?.run(context, { positionals: [], values: { limit: '101' } })
        ).rejects.toThrow('--limit must be between 1 and 100');
        await expect(
            list?.run(context, { positionals: [], values: { after: 'next' } })
        ).rejects.toThrow('--after must be a whole number');
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('inspects one sandbox and prints the tool result as is', async () => {
        const { context, output } = contextWith(['gpu:read']);
        const value = { action: 'inspect', sandbox };
        query.mockResolvedValueOnce(value);
        await get?.run(context, { positionals: [sandboxId], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_gpu_sandbox_get', { sandboxId });
        expect(output.result).toHaveBeenCalledWith(
            value,
            'train running (a100-1x), expires 2026-11-25T12:00:00.000Z'
        );
    });

    it('inspects one process by sandbox and process id', async () => {
        const { context, output } = contextWith(['gpu:read']);
        const value = {
            action: 'inspect',
            process: {
                exitCode: 0,
                finishedAt: '2026-11-25T11:00:00.000Z',
                id: processId,
                startedAt: '2026-11-25T10:00:00.000Z',
                state: 'exited',
            },
        };
        query.mockResolvedValueOnce(value);
        await processGet?.run(context, { positionals: [sandboxId, processId], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_gpu_process_get', {
            processId,
            sandboxId,
        });
        expect(output.result).toHaveBeenCalledWith(value, `${processId} exited (exit 0)`);
    });

    it('reads one log page with the stream, cursor and byte limit asked for', async () => {
        const { context, output } = contextWith(['gpu:read']);
        const value = {
            action: 'logs',
            cursor: 100,
            eof: false,
            nextCursor: 612,
            processId,
            stream: 'stderr',
            text: 'epoch 1\n',
        };
        query.mockResolvedValueOnce(value);
        await logs?.run(context, {
            positionals: [sandboxId, processId],
            values: { after: '100', 'limit-bytes': '512', stream: 'stderr' },
        });
        expect(query).toHaveBeenCalledWith(context, 'dexto_gpu_process_logs', {
            cursor: 100,
            limitBytes: 512,
            processId,
            sandboxId,
            stream: 'stderr',
        });
        expect(output.record).toHaveBeenCalledWith(value);
    });

    it('prints log text for people with the next cursor while more remains', async () => {
        const { context, output, runtime } = contextWith(['gpu:read'], false);
        query.mockResolvedValueOnce({
            action: 'logs',
            cursor: 0,
            eof: false,
            nextCursor: 8,
            processId,
            stream: 'stdout',
            text: 'epoch 1\n',
        });
        await logs?.run(context, { positionals: [sandboxId, processId], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_gpu_process_logs', {
            processId,
            sandboxId,
        });
        expect(runtime.writeOutput).toHaveBeenCalledWith('epoch 1\n');
        expect(output.note).toHaveBeenCalledWith('More output: add --after 8');
    });

    it('refuses a bad stream or byte limit before calling', async () => {
        const { context } = contextWith(['gpu:read']);
        const positionals = [sandboxId, processId];
        await expect(
            logs?.run(context, { positionals, values: { stream: 'both' } })
        ).rejects.toThrow('--stream must be one of: stdout, stderr');
        await expect(
            logs?.run(context, { positionals, values: { 'limit-bytes': '65537' } })
        ).rejects.toThrow('--limit-bytes must be between 1 and 65536');
        await expect(logs?.run(context, { positionals: [sandboxId], values: {} })).rejects.toThrow(
            'process_id'
        );
        expect(query).not.toHaveBeenCalled();
    });

    it('asks for gpu:read before any GPU read', async () => {
        const { context } = contextWith(['cloud:read']);
        const inputs = [
            [profiles, []],
            [list, []],
            [get, [sandboxId]],
            [processGet, [sandboxId, processId]],
            [logs, [sandboxId, processId]],
        ] as const;
        for (const [command, positionals] of inputs) {
            const run = command?.run(context, { positionals: [...positionals], values: {} });
            await expect(run).rejects.toBeInstanceOf(MissingScopeFailure);
            await expect(run).rejects.toMatchObject({ scopes: ['gpu:read'] });
        }
        expect(query).not.toHaveBeenCalled();
    });

    it("passes the server's refusal through when the account has no managed GPUs", async () => {
        const { context, output } = contextWith(['gpu:read']);
        const refusal = new CommandFailure(
            'failed',
            'Managed GPU sandboxes are unavailable for this account.',
            null
        );
        query.mockRejectedValueOnce(refusal);
        await expect(profiles?.run(context, { positionals: [], values: {} })).rejects.toBe(refusal);
        expect(output.list).not.toHaveBeenCalled();
    });
});

describe('dexto gpus lifecycle and processes', () => {
    const [, , , , , provision, start, stop, remove, processStart, processStop] = gpuCommands;
    const idempotencyKey = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const provisionValues = {
        'idempotency-key': idempotencyKey,
        image: 'pytorch',
        'max-minutes': '60',
        'gpu-profile': 'a100-1x',
        yes: true,
    };
    const runningProcess = { exitCode: null, id: processId, state: 'running' };

    it('names no option the way a global one is named, which the CLI takes first', () => {
        const globals = Object.keys(GLOBAL_OPTIONS);
        for (const command of gpuCommands)
            expect(
                Object.keys(command.options ?? {}).filter((name) => globals.includes(name))
            ).toEqual([]);
    });

    it('provisions with the given profile, image, name, runtime and idempotency key', async () => {
        const { context, output } = contextWith(['gpu:write']);
        const result = { action: 'provision', sandbox };
        query.mockResolvedValueOnce(result);
        await provision?.run(context, { positionals: ['train'], values: provisionValues });
        expect(query).toHaveBeenCalledWith(context, 'dexto_gpu_sandbox_provision', {
            idempotencyKey,
            imageId: 'pytorch',
            maximumRuntimeMinutes: 60,
            name: 'train',
            profileId: 'a100-1x',
        });
        expect(output.result).toHaveBeenCalledWith(
            result,
            `train running (${sandboxId}), expires 2026-11-25T12:00:00.000Z`
        );
    });

    it('makes up a fresh idempotency key when none is given', async () => {
        const { context } = contextWith(['gpu:write']);
        query.mockResolvedValue({ action: 'provision', sandbox });
        const values = { ...provisionValues, 'idempotency-key': undefined };
        await provision?.run(context, { positionals: ['train'], values });
        await provision?.run(context, { positionals: ['train'], values });
        const keys = query.mock.calls.map((call) => call[2].idempotencyKey);
        expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/u);
        expect(keys[1]).not.toBe(keys[0]);
    });

    it('shows a dry run without signing in for gpu:write or calling', async () => {
        const { context, output } = contextWith([]);
        await provision?.run(context, {
            positionals: ['train'],
            values: { ...provisionValues, 'dry-run': true, yes: undefined },
        });
        expect(query).not.toHaveBeenCalled();
        expect(output.result).toHaveBeenCalledWith(
            {
                arguments: {
                    idempotencyKey,
                    imageId: 'pytorch',
                    maximumRuntimeMinutes: 60,
                    name: 'train',
                    profileId: 'a100-1x',
                },
                dryRun: true,
                tool: 'dexto_gpu_sandbox_provision',
            },
            expect.stringContaining('Would provision')
        );
    });

    it('refuses bad provisioning input before calling', async () => {
        const { context } = contextWith(['gpu:write']);
        const run = (values: Record<string, string | boolean | undefined>) =>
            provision?.run(context, {
                positionals: ['train'],
                values: { ...provisionValues, ...values },
            });
        await expect(run({ 'gpu-profile': undefined })).rejects.toThrow(
            '--gpu-profile is required'
        );
        await expect(run({ image: undefined })).rejects.toThrow('--image is required');
        await expect(run({ 'max-minutes': undefined })).rejects.toThrow(
            '--max-minutes is required'
        );
        await expect(run({ 'max-minutes': '0' })).rejects.toThrow('--max-minutes must be');
        await expect(run({ 'idempotency-key': 'retry-1' })).rejects.toThrow(
            '--idempotency-key must be a UUID'
        );
        await expect(
            provision?.run(context, { positionals: [], values: provisionValues })
        ).rejects.toThrow('Missing name');
        expect(query).not.toHaveBeenCalled();
    });

    it('starts a sandbox for the given runtime', async () => {
        const { context, output } = contextWith(['gpu:write']);
        const result = { action: 'start', sandbox };
        query.mockResolvedValueOnce(result);
        await start?.run(context, {
            positionals: [sandboxId],
            values: { 'max-minutes': '30', yes: true },
        });
        expect(query).toHaveBeenCalledWith(context, 'dexto_gpu_sandbox_start', {
            maximumRuntimeMinutes: 30,
            sandboxId,
        });
        expect(output.result).toHaveBeenCalledWith(result, expect.stringContaining('running'));
    });

    it('stops and deletes a sandbox by its id', async () => {
        const { context, output } = contextWith(['gpu:write']);
        const stopped = { action: 'stop', sandbox: { ...sandbox, status: 'stopped' } };
        const deleted = { action: 'delete', sandbox: { ...sandbox, status: 'deleted' } };
        query.mockResolvedValueOnce(stopped).mockResolvedValueOnce(deleted);
        await stop?.run(context, { positionals: [sandboxId], values: { yes: true } });
        await remove?.run(context, { positionals: [sandboxId], values: { yes: true } });
        expect(query.mock.calls).toEqual([
            [context, 'dexto_gpu_sandbox_stop', { sandboxId }],
            [context, 'dexto_gpu_sandbox_delete', { sandboxId }],
        ]);
        expect(output.result).toHaveBeenNthCalledWith(
            1,
            stopped,
            expect.stringContaining('stopped')
        );
        expect(output.result).toHaveBeenNthCalledWith(
            2,
            deleted,
            expect.stringContaining('deleted')
        );
    });

    it('starts a process with its command, working directory and idempotency key', async () => {
        const { context, output } = contextWith(['gpu:write']);
        const result = { action: 'start', process: runningProcess };
        query.mockResolvedValueOnce(result);
        await processStart?.run(context, {
            positionals: [sandboxId, 'python train.py --epochs 3'],
            values: { cwd: '/workspace/run', 'idempotency-key': idempotencyKey, yes: true },
        });
        expect(query).toHaveBeenCalledWith(context, 'dexto_gpu_process_start', {
            command: 'python train.py --epochs 3',
            cwd: '/workspace/run',
            idempotencyKey,
            sandboxId,
        });
        expect(output.result).toHaveBeenCalledWith(result, `${processId} running`);
    });

    it("leaves the working directory to the server's default", async () => {
        const { context } = contextWith(['gpu:write']);
        query.mockResolvedValueOnce({ action: 'start', process: runningProcess });
        await processStart?.run(context, {
            positionals: [sandboxId, 'nvidia-smi'],
            values: { yes: true },
        });
        expect(query.mock.calls[0]?.[2]).not.toHaveProperty('cwd');
        expect(query.mock.calls[0]?.[2]).toHaveProperty('idempotencyKey');
    });

    it('stops a process by its sandbox and process ids', async () => {
        const { context, output } = contextWith(['gpu:write']);
        const result = {
            action: 'stop',
            process: { exitCode: 143, id: processId, state: 'exited' },
        };
        query.mockResolvedValueOnce(result);
        await processStop?.run(context, {
            positionals: [sandboxId, processId],
            values: { yes: true },
        });
        expect(query).toHaveBeenCalledWith(context, 'dexto_gpu_process_stop', {
            processId,
            sandboxId,
        });
        expect(output.result).toHaveBeenCalledWith(result, `${processId} exited (exit 143)`);
    });

    const writes = [
        [() => provision, ['train'], provisionValues],
        [() => start, [sandboxId], { 'max-minutes': '30', yes: true }],
        [() => stop, [sandboxId], { yes: true }],
        [() => remove, [sandboxId], { yes: true }],
        [() => processStart, [sandboxId, 'nvidia-smi'], { yes: true }],
        [() => processStop, [sandboxId, processId], { yes: true }],
    ] as const;

    it('asks for gpu:write before any GPU change', async () => {
        const { context } = contextWith(['gpu:read']);
        for (const [command, positionals, values] of writes) {
            const run = command()?.run(context, { positionals: [...positionals], values });
            await expect(run).rejects.toBeInstanceOf(MissingScopeFailure);
            await expect(run).rejects.toMatchObject({ scopes: ['gpu:write'] });
        }
        expect(query).not.toHaveBeenCalled();
    });

    it('needs --yes for every GPU change when no one is at the terminal', async () => {
        const { context } = contextWith(['gpu:write']);
        for (const [command, positionals, values] of writes) {
            const run = command()?.run(context, {
                positionals: [...positionals],
                values: { ...values, yes: undefined },
            });
            await expect(run).rejects.toMatchObject({
                kind: 'needs_confirmation',
                fix: 'dexto gpus --yes',
            });
        }
        expect(query).not.toHaveBeenCalled();
    });

    it('says deleting removes the workspace bytes for good', async () => {
        const { context } = contextWith(['gpu:write']);
        await expect(
            remove?.run(context, { positionals: [sandboxId], values: {} })
        ).rejects.toThrow("can't be undone");
    });

    it("passes the server's billing refusal through without printing a result", async () => {
        const { context, output } = contextWith(['gpu:write']);
        const refusal = new CommandFailure(
            'failed',
            'Dexto account has insufficient credits for this GPU operation.',
            null
        );
        query.mockRejectedValueOnce(refusal);
        await expect(
            provision?.run(context, { positionals: ['train'], values: provisionValues })
        ).rejects.toBe(refusal);
        expect(output.result).not.toHaveBeenCalled();
    });
});
