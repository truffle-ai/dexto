import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DextoMcpClient } from './mcp-client.js';
import { MCPManager } from './manager.js';
import { McpServerConfigSchema } from './schemas.js';
import { AgentEventBus } from '../events/index.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

const serverPath = fileURLToPath(new URL('./fixtures/lifecycle-server.mjs', import.meta.url));

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

describe('MCP failed connection lifecycle', () => {
    let manager: MCPManager;
    let directory: string;
    const pidFiles: string[] = [];
    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'dexto-mcp-lifecycle-'));
        manager = new MCPManager(createMockLogger(), new AgentEventBus());
    });
    afterEach(async () => {
        await manager.disconnectAll();
        for (const pidFile of pidFiles.splice(0)) {
            const contents = await readFile(pidFile, 'utf8').catch(() => null);
            if (contents === null) continue;
            const pid = Number(contents);
            if (isProcessRunning(pid)) process.kill(pid, 'SIGKILL');
        }
        await rm(directory, { recursive: true, force: true });
    });
    function serverConfig(label: string, mode = 'normal') {
        const pidFile = join(directory, `${label}.pid`);
        pidFiles.push(pidFile);
        return {
            pidFile,
            config: McpServerConfigSchema.parse({
                type: 'stdio',
                command: process.execPath,
                args: [serverPath, pidFile, mode],
                env: { HOME: directory, USERPROFILE: directory },
            }),
        };
    }
    it('closes both real children after overlapping same-name connection replacement', async () => {
        const first = serverConfig('displaced', 'wait-for-file');
        const second = serverConfig('replacement', 'wait-for-file');
        const firstRelease = join(directory, 'displaced.release');
        const secondRelease = join(directory, 'replacement.release');
        const attempts = [
            manager.connectServer(
                'shared',
                McpServerConfigSchema.parse({
                    ...first.config,
                    args: [serverPath, first.pidFile, 'wait-for-file', '', firstRelease],
                })
            ),
            manager.connectServer(
                'shared',
                McpServerConfigSchema.parse({
                    ...second.config,
                    args: [serverPath, second.pidFile, 'wait-for-file', '', secondRelease],
                })
            ),
        ];
        try {
            await vi.waitFor(async () => {
                await readFile(first.pidFile);
                await readFile(second.pidFile);
            });
            await writeFile(firstRelease, 'ready');
            await attempts[0];
            await writeFile(secondRelease, 'ready');
            await attempts[1];
            const firstPid = Number(await readFile(first.pidFile, 'utf8'));
            const secondPid = Number(await readFile(second.pidFile, 'utf8'));
            expect(firstPid).not.toBe(secondPid);
            expect(isProcessRunning(firstPid)).toBe(true);
            expect(isProcessRunning(secondPid)).toBe(true);
            expect(await manager.executeTool('ping', {})).toMatchObject({
                content: [{ type: 'text', text: 'pong' }],
            });
            await manager.disconnectAll();
            await vi.waitFor(
                () => {
                    expect(isProcessRunning(firstPid)).toBe(false);
                    expect(isProcessRunning(secondPid)).toBe(false);
                },
                { timeout: 2000 }
            );
        } finally {
            await Promise.all([
                writeFile(firstRelease, 'ready'),
                writeFile(secondRelease, 'ready'),
            ]);
            await Promise.allSettled(attempts);
        }
    }, 15000);
    it('drains pending startup before closing its client and remains reusable', async () => {
        const server = serverConfig('pending-startup');
        const modeFile = join(directory, 'pending-mode');
        const releaseFile = join(directory, 'pending-release');
        await writeFile(modeFile, 'wait-for-file');
        const config = McpServerConfigSchema.parse({
            ...server.config,
            args: [serverPath, server.pidFile, 'from-file', modeFile, releaseFile],
        });
        manager.configureServer('pending', config);
        const startup = manager.connectServer('pending', config);
        // Attach a rejection handler before any teardown assertion can fail.
        const startupResult = startup.then(
            () => 'connected',
            (error: unknown) => error
        );
        let cleanup: Promise<void> | undefined;
        try {
            await vi.waitFor(async () =>
                expect(await readFile(server.pidFile, 'utf8')).toBeTruthy()
            );
            expect(manager.getClients().size).toBe(0);
            let cleanupFinished = false;
            cleanup = manager.disconnectAll().then(() => {
                cleanupFinished = true;
            });
            await new Promise<void>((resolve) => setTimeout(resolve, 25));
            expect(cleanupFinished).toBe(false);
            await writeFile(releaseFile, 'ready');
            expect(await startupResult).toBe('connected');
            await cleanup;
            const pid = Number(await readFile(server.pidFile, 'utf8'));
            await vi.waitFor(() => expect(isProcessRunning(pid)).toBe(false), { timeout: 2000 });
            expect(manager.getClients().size).toBe(0);
            expect(await manager.getAllTools()).toEqual({});
            expect(manager.getServerConfig('pending')).toBeUndefined();
            expect(manager.getConfiguredServerStatuses()).toMatchObject([
                { name: 'pending', status: 'configured' },
            ]);
            await writeFile(modeFile, 'normal');
            await manager.connectServer('pending', config);
            expect(await manager.executeTool('ping', {})).toMatchObject({
                content: [{ type: 'text', text: 'pong' }],
            });
        } finally {
            await writeFile(releaseFile, 'ready');
            await Promise.allSettled([startupResult, ...(cleanup ? [cleanup] : [])]);
        }
    }, 15000);
    it('drains a pending restart and closes its replacement without changing the restart result', async () => {
        const server = serverConfig('pending-restart');
        const modeFile = join(directory, 'restart-mode');
        const releaseFile = join(directory, 'restart-release');
        await writeFile(modeFile, 'normal');
        const config = McpServerConfigSchema.parse({
            ...server.config,
            args: [serverPath, server.pidFile, 'from-file', modeFile, releaseFile],
        });
        await manager.connectServer('restart', config);
        const originalPid = Number(await readFile(server.pidFile, 'utf8'));
        await writeFile(modeFile, 'wait-for-file');
        const restart = manager.restartServer('restart');
        const restartResult = restart.then(
            () => 'restarted',
            (error: unknown) => error
        );
        let cleanup: Promise<void> | undefined;
        try {
            await vi.waitFor(async () => {
                expect(Number(await readFile(server.pidFile, 'utf8'))).not.toBe(originalPid);
            });
            let cleanupFinished = false;
            cleanup = manager.disconnectAll().then(() => {
                cleanupFinished = true;
            });
            await new Promise<void>((resolve) => setTimeout(resolve, 25));
            expect(cleanupFinished).toBe(false);
            await writeFile(releaseFile, 'ready');
            expect(await restartResult).toBe('restarted');
            await cleanup;
            const replacementPid = Number(await readFile(server.pidFile, 'utf8'));
            await vi.waitFor(
                () => {
                    expect(isProcessRunning(originalPid)).toBe(false);
                    expect(isProcessRunning(replacementPid)).toBe(false);
                },
                { timeout: 2000 }
            );
            expect(manager.getClients().size).toBe(0);
            expect(await manager.getAllTools()).toEqual({});
            expect(manager.getServerConfig('restart')).toBeUndefined();
        } finally {
            await writeFile(releaseFile, 'ready');
            await Promise.allSettled([restartResult, ...(cleanup ? [cleanup] : [])]);
        }
    }, 15000);
    it('drains discovery after registration before clearing all connection caches', async () => {
        const server = serverConfig('pending-discovery');
        const discoveryFile = join(directory, 'discovery-started');
        const releaseFile = join(directory, 'discovery-release');
        const config = McpServerConfigSchema.parse({
            ...server.config,
            args: [serverPath, server.pidFile, 'wait-for-discovery', discoveryFile, releaseFile],
        });
        const startup = manager.connectServer('discovery', config);
        const startupResult = startup.then(
            () => 'connected',
            (error: unknown) => error
        );
        let cleanup: Promise<void> | undefined;
        try {
            await vi.waitFor(async () =>
                expect(await readFile(discoveryFile, 'utf8')).toBe('discovery-started')
            );
            expect(manager.getClients().has('discovery')).toBe(true);
            let cleanupFinished = false;
            cleanup = manager.disconnectAll().then(() => {
                cleanupFinished = true;
            });
            await new Promise<void>((resolve) => setTimeout(resolve, 25));
            expect(cleanupFinished).toBe(false);
            await writeFile(releaseFile, 'ready');
            expect(await startupResult).toBe('connected');
            await cleanup;
            const pid = Number(await readFile(server.pidFile, 'utf8'));
            await vi.waitFor(() => expect(isProcessRunning(pid)).toBe(false), { timeout: 2000 });
            expect(manager.getClients().size).toBe(0);
            expect(await manager.getAllTools()).toEqual({});
            expect(await manager.listAllPrompts()).toEqual([]);
            expect(await manager.listAllResources()).toEqual([]);
            expect(manager.getServerConfig('discovery')).toBeUndefined();
        } finally {
            await writeFile(releaseFile, 'ready');
            await Promise.allSettled([startupResult, ...(cleanup ? [cleanup] : [])]);
        }
    }, 15000);
    it('settles cleanup after a pending startup failure without replacing the original error', async () => {
        const server = serverConfig('pending-failure');
        const releaseFile = join(directory, 'failure-release');
        const config = McpServerConfigSchema.parse({
            ...server.config,
            args: [serverPath, server.pidFile, 'wait-for-reject', '', releaseFile],
        });
        manager.configureServer('failure', config);
        const startupResult = manager
            .connectServer('failure', config)
            .catch((error: unknown) => error);
        let cleanup: Promise<void> | undefined;
        try {
            await vi.waitFor(async () =>
                expect(await readFile(server.pidFile, 'utf8')).toBeTruthy()
            );
            let cleanupFinished = false;
            cleanup = manager.disconnectAll().then(() => {
                cleanupFinished = true;
            });
            await new Promise<void>((resolve) => setTimeout(resolve, 25));
            expect(cleanupFinished).toBe(false);
            await writeFile(releaseFile, 'ready');
            expect(await startupResult).toMatchObject({
                message: expect.stringContaining('fixture handshake rejected'),
            });
            await cleanup;
            const pid = Number(await readFile(server.pidFile, 'utf8'));
            await vi.waitFor(() => expect(isProcessRunning(pid)).toBe(false), { timeout: 2000 });
            expect(manager.getClients().size).toBe(0);
            expect(manager.getFailedConnections()).toEqual({});
            expect(manager.getConfiguredServerStatuses()).toMatchObject([
                { name: 'failure', status: 'configured' },
            ]);
        } finally {
            await writeFile(releaseFile, 'ready');
            await Promise.allSettled([startupResult, ...(cleanup ? [cleanup] : [])]);
        }
    }, 15000);
    it('closes a rejected name-collision candidate and leaves the connected server usable', async () => {
        const existing = serverConfig('existing');
        const candidate = serverConfig('candidate');
        await manager.connectServer('my_server', existing.config);
        await expect(manager.connectServer('my@server', candidate.config)).rejects.toThrow(
            'Failed to connect'
        );
        const rejectedPid = Number(await readFile(candidate.pidFile, 'utf8'));
        await vi.waitFor(() => expect(isProcessRunning(rejectedPid)).toBe(false), {
            timeout: 2000,
        });
        expect([...manager.getClients().keys()]).toEqual(['my_server']);
        expect(await manager.executeTool('ping', {})).toMatchObject({
            content: [{ type: 'text', text: 'pong' }],
        });
        expect(manager.getFailedConnections()['my@server']?.message).toContain('my_server');
    }, 15000);
    it('closes a failed restart candidate and retains the configuration for a successful retry', async () => {
        const server = serverConfig('restart');
        const modeFile = join(directory, 'restart-mode');
        await writeFile(modeFile, 'normal');
        const config = McpServerConfigSchema.parse({
            ...server.config,
            args: [serverPath, server.pidFile, 'from-file', modeFile],
        });
        await manager.connectServer('restart', config);
        const originalPid = Number(await readFile(server.pidFile, 'utf8'));
        await writeFile(modeFile, 'reject-handshake');
        await expect(manager.restartServer('restart')).rejects.toThrow(
            'fixture handshake rejected'
        );
        const rejectedPid = Number(await readFile(server.pidFile, 'utf8'));
        expect(rejectedPid).not.toBe(originalPid);
        await vi.waitFor(
            () => {
                expect(isProcessRunning(originalPid)).toBe(false);
                expect(isProcessRunning(rejectedPid)).toBe(false);
            },
            { timeout: 2000 }
        );
        expect(manager.getClients().has('restart')).toBe(false);
        expect(manager.getServerConfig('restart')).toEqual(config);
        expect(manager.getFailedConnections().restart?.message).toContain(
            'fixture handshake rejected'
        );
        await writeFile(modeFile, 'normal');
        await manager.restartServer('restart');
        expect(manager.getFailedConnections().restart).toBeUndefined();
        expect(await manager.executeTool('ping', {})).toMatchObject({
            content: [{ type: 'text', text: 'pong' }],
        });
    }, 15000);
    it('closes a restarted candidate rejected during registration without disturbing its name competitor', async () => {
        const server = serverConfig('delayed-restart');
        const competitor = serverConfig('competitor');
        const modeFile = join(directory, 'delayed-mode');
        const releaseFile = join(directory, 'release');
        await writeFile(modeFile, 'normal');
        const config = McpServerConfigSchema.parse({
            ...server.config,
            args: [serverPath, server.pidFile, 'from-file', modeFile, releaseFile],
        });
        await manager.connectServer('my@server', config);
        const originalPid = Number(await readFile(server.pidFile, 'utf8'));
        await writeFile(modeFile, 'wait-for-file');
        const restart = manager.restartServer('my@server').catch((error: unknown) => error);
        await vi.waitFor(async () => {
            expect(Number(await readFile(server.pidFile, 'utf8'))).not.toBe(originalPid);
        });
        await manager.connectServer('my_server', competitor.config);
        await writeFile(releaseFile, 'ready');
        expect(await restart).toMatchObject({
            message: expect.stringContaining('Failed to connect'),
        });
        const rejectedPid = Number(await readFile(server.pidFile, 'utf8'));
        await vi.waitFor(() => expect(isProcessRunning(rejectedPid)).toBe(false), {
            timeout: 2000,
        });
        expect([...manager.getClients().keys()]).toEqual(['my_server']);
        expect(await manager.executeTool('ping', {})).toMatchObject({
            content: [{ type: 'text', text: 'pong' }],
        });
        expect(manager.getServerConfig('my@server')).toEqual(config);
        await manager.removeClient('my_server');
        await writeFile(modeFile, 'normal');
        await manager.restartServer('my@server');
        expect(await manager.executeTool('ping', {})).toMatchObject({
            content: [{ type: 'text', text: 'pong' }],
        });
    }, 15000);
    it('closes a handshake-rejected candidate and reports the original failure', async () => {
        const candidate = serverConfig('failed-connect', 'reject-handshake');
        await expect(manager.connectServer('failed-connect', candidate.config)).rejects.toThrow(
            'fixture handshake rejected'
        );
        const rejectedPid = Number(await readFile(candidate.pidFile, 'utf8'));
        await vi.waitFor(() => expect(isProcessRunning(rejectedPid)).toBe(false), {
            timeout: 2000,
        });
        expect(manager.getClients().size).toBe(0);
        expect(manager.getServerConfig('failed-connect')).toBeUndefined();
        expect(manager.getFailedConnectionError('failed-connect')).toContain(
            'fixture handshake rejected'
        );
    }, 15000);
    it('retains the connection error when rejected-candidate cleanup also fails', async () => {
        const existing = serverConfig('cleanup-existing');
        const candidate = serverConfig('cleanup-candidate');
        await manager.connectServer('my_server', existing.config);
        const disconnect = vi
            .spyOn(DextoMcpClient.prototype, 'disconnect')
            .mockRejectedValueOnce(new Error('fixture cleanup failed'));
        try {
            await expect(manager.connectServer('my@server', candidate.config)).rejects.toThrow(
                'my_server'
            );
            expect(disconnect).toHaveBeenCalledOnce();
            expect(manager.getFailedConnectionError('my@server')).toContain('my_server');
            expect(manager.getFailedConnectionError('my@server')).not.toContain(
                'fixture cleanup failed'
            );
            expect(await manager.executeTool('ping', {})).toMatchObject({
                content: [{ type: 'text', text: 'pong' }],
            });
        } finally {
            disconnect.mockRestore();
        }
    }, 15000);
});
