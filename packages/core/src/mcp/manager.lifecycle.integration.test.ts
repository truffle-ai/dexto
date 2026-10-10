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
