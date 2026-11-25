import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingScopeFailure, type CommandContext } from '../command.js';
import { CommandFailure } from '../../failure.js';
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
        output,
        overrides: { profile: null },
        runtime,
    } as unknown as CommandContext;
    return { context, output, runtime };
}

beforeEach(() => query.mockReset());

describe('dexto gpus', () => {
    it('registers the five read commands', () => {
        expect(gpuCommands.map((command) => command.path.join(' '))).toEqual([
            'gpus profiles',
            'gpus list',
            'gpus get',
            'gpus process',
            'gpus logs',
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
