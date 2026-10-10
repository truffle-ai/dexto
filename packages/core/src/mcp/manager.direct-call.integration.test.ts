import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DextoMcpClient } from './mcp-client.js';
import { MCPManager } from './manager.js';
import { McpServerConfigSchema } from './schemas.js';
import { AgentEventBus } from '../events/index.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

const fixture = fileURLToPath(new URL('./fixtures/direct-call-server.mjs', import.meta.url));

describe('MCP direct protocol calls', () => {
    let manager: MCPManager;
    let directory: string;
    const pidFiles: string[] = [];
    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'dexto-mcp-call-'));
        manager = new MCPManager(createMockLogger(), new AgentEventBus());
    });
    afterEach(async () => {
        await manager.disconnectAll();
        for (const file of pidFiles.splice(0)) {
            const pid = await readFile(file, 'utf8').catch(() => null);
            if (pid === null) continue;
            try {
                process.kill(Number(pid), 'SIGKILL');
            } catch {
                /* Already closed. */
            }
        }
        await rm(directory, { recursive: true, force: true });
    });
    function config(label: string, timeout = 3000) {
        const pid = join(directory, `${label}.pid`);
        pidFiles.push(pid);
        return McpServerConfigSchema.parse({
            type: 'stdio',
            command: process.execPath,
            args: [fixture, pid, label],
            env: { HOME: directory, USERPROFILE: directory },
            timeout,
        });
    }
    it('calls a discovered literal identity and retains the full protocol result', async () => {
        await manager.connectServer('first', config('first'));
        const descriptor = manager.getToolDescriptors()[0];
        assert(descriptor, 'fixture tool missing');
        const result = await manager.callToolDirect({
            identity: descriptor.identity,
            arguments: { count: 2 },
        });
        expect(result).toEqual({
            content: [{ type: 'text', text: 'first' }],
            structuredContent: { name: 'literal--tool', arguments: { count: 2 } },
            _meta: { fixture: 'first' },
            extension: { preserved: true },
        });
    });
    it('returns tool errors while preserving legacy agent error conversion', async () => {
        await manager.connectServer('first', config('first'));
        const identity = { type: 'mcp', connectionId: 'first', toolName: 'literal--tool' } as const;
        const result = await manager.callToolDirect({ identity, arguments: { error: true } });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toEqual({
            name: 'literal--tool',
            arguments: { error: true },
        });
        await expect(manager.executeTool('literal--tool', { error: true })).rejects.toThrow(
            'first'
        );
    });
    it('routes literal identities independently of colliding and disappearing aliases', async () => {
        await manager.connectServer('first', config('first'));
        const original = manager.getToolDescriptors()[0];
        assert(original, 'fixture tool missing');
        await manager.connectServer('second', config('second'));
        expect(manager.getToolDescriptors().map((tool) => tool.name)).not.toContain(
            'literal--tool'
        );
        expect(
            (await manager.callToolDirect({ identity: original.identity, arguments: {} })).content
        ).toEqual([{ type: 'text', text: 'first' }]);
        expect(
            (
                await manager.callToolDirect({
                    identity: { type: 'mcp', connectionId: 'second', toolName: 'literal--tool' },
                    arguments: {},
                })
            ).content
        ).toEqual([{ type: 'text', text: 'second' }]);
        await manager.removeClient('second');
        expect(
            (await manager.callToolDirect({ identity: original.identity, arguments: {} })).content
        ).toEqual([{ type: 'text', text: 'first' }]);
        await manager.removeClient('first');
        await expect(
            manager.callToolDirect({ identity: original.identity, arguments: {} })
        ).rejects.toMatchObject({ code: 'mcp_server_not_found' });
    });
    it('cancels an active protocol request without disconnecting the owned client', async () => {
        await manager.connectServer('first', config('first'));
        const controller = new AbortController();
        const startedFile = join(directory, 'started');
        const cancelledFile = join(directory, 'cancelled');
        const identity = { type: 'mcp', connectionId: 'first', toolName: 'literal--tool' } as const;
        const call = manager.callToolDirect({
            identity,
            arguments: { delay: 10000, startedFile, cancelledFile },
            signal: controller.signal,
        });
        const rejected = expect(call).rejects.toThrow('caller cancelled');
        await expect.poll(() => readFile(startedFile, 'utf8').catch(() => null)).toBe('started');
        controller.abort(new Error('caller cancelled'));
        await rejected;
        await expect
            .poll(() => readFile(cancelledFile, 'utf8').catch(() => null))
            .toBe('cancelled');
        expect((await manager.callToolDirect({ identity, arguments: {} })).content).toEqual([
            { type: 'text', text: 'first' },
        ]);
        const pid = Number(await readFile(join(directory, 'first.pid'), 'utf8'));
        await manager.disconnectAll();
        await expect
            .poll(() => {
                try {
                    process.kill(pid, 0);
                    return false;
                } catch {
                    return true;
                }
            })
            .toBe(true);
    });

    it('does not send a pre-aborted request to the upstream tool', async () => {
        await manager.connectServer('first', config('first'));
        const controller = new AbortController();
        controller.abort(new Error('already cancelled'));
        const startedFile = join(directory, 'never-started');
        await expect(
            manager.callToolDirect({
                identity: { type: 'mcp', connectionId: 'first', toolName: 'literal--tool' },
                arguments: { startedFile },
                signal: controller.signal,
            })
        ).rejects.toThrow('already cancelled');
        await expect(readFile(startedFile)).rejects.toMatchObject({ code: 'ENOENT' });
    });
    it('uses the actual connection timeout rather than the desired configuration', async () => {
        manager.configureServer(
            'first',
            McpServerConfigSchema.parse({
                type: 'http',
                url: 'https://example.invalid/mcp',
                timeout: 3000,
            })
        );
        await manager.connectServer('first', config('first', 40));
        await expect(
            manager.callToolDirect({
                identity: { type: 'mcp', connectionId: 'first', toolName: 'literal--tool' },
                arguments: { delay: 250 },
            })
        ).rejects.toMatchObject({ code: -32001 });
        expect(manager.getConfiguredServerStatuses()[0]?.configuredTransport).toBe('http');
        const original = manager.getClients().get('first');
        assert(original, 'fixture client missing');
        const replacement = new DextoMcpClient(createMockLogger());
        await replacement.connect(config('replacement'), 'first');
        try {
            manager.registerClient('first', replacement);
            await expect(
                manager.callToolDirect({
                    identity: { type: 'mcp', connectionId: 'first', toolName: 'literal--tool' },
                    arguments: { delay: 250 },
                })
            ).rejects.toMatchObject({ code: -32001 });
        } finally {
            await original.disconnect();
        }
    });

    it('retains SDK defaults for externally registered clients without saved runtime config', async () => {
        const client = new DextoMcpClient(createMockLogger());
        await client.connect(config('external', 30), 'external');
        manager.registerClient('external', client);
        expect(manager.getServerConfig('external')).toBeUndefined();
        const result = await manager.callToolDirect({
            identity: { type: 'mcp', connectionId: 'external', toolName: 'literal--tool' },
            arguments: { delay: 120 },
        });
        expect(result.content).toEqual([{ type: 'text', text: 'external' }]);
    });
    it('rejects observed initialization and restart before invoking the upstream client', async () => {
        const lifecycle = fileURLToPath(
            new URL('./fixtures/lifecycle-server.mjs', import.meta.url)
        );
        const releaseFile = join(directory, 'release');
        const pid = join(directory, 'guard.pid');
        const settings = McpServerConfigSchema.parse({
            ...config('guard'),
            args: [lifecycle, pid, 'wait-for-file', '', releaseFile],
        });
        const identity = { type: 'mcp', connectionId: 'guard', toolName: 'ping' } as const;
        const initializing = manager.connectServer('guard', settings);
        await expect.poll(() => readFile(pid, 'utf8').catch(() => null)).not.toBeNull();
        try {
            await expect(manager.callToolDirect({ identity, arguments: {} })).rejects.toMatchObject(
                { code: 'mcp_connection_failed' }
            );
        } finally {
            await writeFile(releaseFile, 'ready');
            await initializing;
        }
        await unlink(releaseFile);
        const restarting = manager.restartServer('guard');
        try {
            await expect(manager.callToolDirect({ identity, arguments: {} })).rejects.toMatchObject(
                { code: 'mcp_connection_failed' }
            );
        } finally {
            await writeFile(releaseFile, 'ready');
            await restarting;
        }
        expect((await manager.callToolDirect({ identity, arguments: {} })).content).toEqual([
            { type: 'text', text: 'pong' },
        ]);
    });

    it('keeps an in-flight call bound to its captured client after replacement', async () => {
        const first = new DextoMcpClient(createMockLogger());
        const second = new DextoMcpClient(createMockLogger());
        const sdk = await first.connect(config('first'), 'shared');
        await second.connect(config('second'), 'shared');
        manager.registerClient('shared', first);
        let release: (() => void) | undefined;
        const waiting = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.spyOn(first, 'getConnectedClient').mockImplementation(async () => {
            await waiting;
            return sdk;
        });
        const call = manager.callToolDirect({
            identity: { type: 'mcp', connectionId: 'shared', toolName: 'literal--tool' },
            arguments: {},
        });
        try {
            manager.registerClient('shared', second);
            assert(release, 'missing fixture release');
            release();
            expect((await call).content).toEqual([{ type: 'text', text: 'first' }]);
            expect(
                (
                    await manager.callToolDirect({
                        identity: {
                            type: 'mcp',
                            connectionId: 'shared',
                            toolName: 'literal--tool',
                        },
                        arguments: {},
                    })
                ).content
            ).toEqual([{ type: 'text', text: 'second' }]);
        } finally {
            release?.();
            await first.disconnect();
            await second.disconnect();
        }
    });
    it('preserves the SDK output-schema validation for direct calls', async () => {
        await manager.connectServer('first', config('first'));
        await expect(
            manager.callToolDirect({
                identity: { type: 'mcp', connectionId: 'first', toolName: 'invalid-output' },
                arguments: {},
            })
        ).rejects.toMatchObject({ code: -32602 });
    });
});
