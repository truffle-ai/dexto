import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPManager } from './manager.js';
import { MCPErrorCode } from './error-codes.js';
import { McpServerConfigSchema } from './schemas.js';
import { AgentEventBus } from '../events/index.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

const serverPath = fileURLToPath(new URL('./fixtures/lifecycle-server.mjs', import.meta.url));

describe('MCP configured server ownership', () => {
    let manager: MCPManager;
    let directory: string;
    const pidFiles: string[] = [];
    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'dexto-mcp-status-'));
        manager = new MCPManager(createMockLogger(), new AgentEventBus());
    });
    afterEach(async () => {
        await manager.disconnectAll();
        for (const pidFile of pidFiles.splice(0)) {
            const pid = await readFile(pidFile, 'utf8').catch(() => null);
            if (pid === null) continue;
            try {
                process.kill(Number(pid), 'SIGKILL');
            } catch {
                /* Already closed. */
            }
        }
        await rm(directory, { recursive: true, force: true });
    });
    function config(label: string, mode = 'normal') {
        const pidFile = join(directory, `${label}.pid`);
        pidFiles.push(pidFile);
        return McpServerConfigSchema.parse({
            type: 'stdio',
            command: process.execPath,
            args: [serverPath, pidFile, mode],
            env: { HOME: directory, USERPROFILE: directory },
            timeout: 3000,
        });
    }
    it('owns disabled desired configuration without exposing legacy restart configuration', async () => {
        const desired = McpServerConfigSchema.parse({ ...config('disabled'), enabled: false });
        manager.configureServer('disabled', desired);
        expect(manager.getConfiguredServerStatuses()).toEqual([
            { name: 'disabled', configuredTransport: 'stdio', status: 'disabled' },
        ]);
        expect(manager.getServerConfig('disabled')).toBeUndefined();
        await expect(manager.connectConfiguredServer('disabled')).rejects.toThrow('disabled');
        expect(manager.getClients().size).toBe(0);
        await expect(readFile(join(directory, 'disabled.pid'))).rejects.toMatchObject({
            code: 'ENOENT',
        });
        manager.forgetServerConfiguration('disabled');
        expect(manager.getConfiguredServerStatuses()).toEqual([]);
    });
    it('reports safe failed and successful retry state without changing legacy getters', async () => {
        const modeFile = join(directory, 'mode');
        await writeFile(modeFile, 'reject-handshake');
        const desired = McpServerConfigSchema.parse({
            ...config('retry'),
            args: [serverPath, join(directory, 'retry.pid'), 'from-file', modeFile],
            env: { TOKEN: 'private-credential' },
        });
        manager.configureServer('retry', desired);
        await expect(manager.connectConfiguredServer('retry')).rejects.toThrow(
            'fixture handshake rejected'
        );
        expect(manager.getServerConfig('retry')).toBeUndefined();
        manager.getFailedConnections()['retry'] = {
            message: 'private-credential https://user:secret@example.com',
            code: 'private-credential',
        };
        const failed = manager.getConfiguredServerStatuses();
        expect(failed).toEqual([
            {
                name: 'retry',
                configuredTransport: 'stdio',
                status: 'failed',
                errorCode: MCPErrorCode.CONNECTION_FAILED,
            },
        ]);
        expect(JSON.stringify(failed)).not.toContain('private-credential');
        await writeFile(modeFile, 'normal');
        await manager.connectConfiguredServer('retry');
        expect(manager.getConfiguredServerStatuses()).toEqual([
            { name: 'retry', configuredTransport: 'stdio', status: 'connected' },
        ]);
        expect(manager.getServerConfig('retry')).toEqual(desired);
        expect(manager.getFailedConnectionError('retry')).toBeUndefined();
        expect(failed[0]?.status).toBe('failed');
    });
    it('keeps connecting precedence until overlapping legacy attempts settle and guards desired mutation', async () => {
        const firstRelease = join(directory, 'first.release');
        const secondRelease = join(directory, 'second.release');
        const first = McpServerConfigSchema.parse({
            ...config('first', 'wait-for-file'),
            args: [serverPath, join(directory, 'first.pid'), 'wait-for-file', '', firstRelease],
        });
        const second = McpServerConfigSchema.parse({
            ...config('second', 'wait-for-file'),
            args: [serverPath, join(directory, 'second.pid'), 'wait-for-file', '', secondRelease],
        });
        manager.configureServer('shared', first);
        const attempts = [
            manager.connectServer('shared', first),
            manager.connectServer('shared', second),
        ];
        try {
            await vi.waitFor(async () => {
                await readFile(join(directory, 'first.pid'));
                await readFile(join(directory, 'second.pid'));
            });
            expect(manager.getConfiguredServerStatuses()[0]?.status).toBe('connecting');
            expect(() => manager.configureServer('shared', second)).toThrow('active');
            expect(() => manager.forgetServerConfiguration('shared')).toThrow('active');
            await writeFile(firstRelease, 'release');
            await attempts[0];
            expect(manager.getConfiguredServerStatuses()[0]?.status).toBe('connecting');
            await writeFile(secondRelease, 'release');
            await attempts[1];
            expect(manager.getConfiguredServerStatuses()[0]?.status).toBe('connected');
            expect(() => manager.configureServer('shared', second)).toThrow('active');
            expect(() => manager.forgetServerConfiguration('shared')).toThrow('active');
        } finally {
            await Promise.all([
                writeFile(firstRelease, 'release'),
                writeFile(secondRelease, 'release'),
            ]);
            await Promise.allSettled(attempts);
        }
    });
    it('observes failed restart and retains desired ownership through reusable disconnection', async () => {
        const modeFile = join(directory, 'restart.mode');
        const releaseFile = join(directory, 'restart.release');
        await writeFile(modeFile, 'normal');
        const desired = McpServerConfigSchema.parse({
            ...config('restart'),
            args: [serverPath, join(directory, 'restart.pid'), 'from-file', modeFile, releaseFile],
        });
        manager.configureServer('restart', desired);
        await manager.connectConfiguredServer('restart');
        await writeFile(modeFile, 'wait-for-file');
        const restart = manager.restartServer('restart');
        try {
            expect(manager.getConfiguredServerStatuses()[0]?.status).toBe('connecting');
            await writeFile(releaseFile, 'release');
            await restart;
        } finally {
            await writeFile(releaseFile, 'release');
            await Promise.allSettled([restart]);
        }
        await writeFile(modeFile, 'reject-handshake');
        await expect(manager.restartServer('restart')).rejects.toThrow(
            'fixture handshake rejected'
        );
        expect(manager.getConfiguredServerStatuses()[0]?.status).toBe('failed');
        expect(manager.getServerConfig('restart')).toEqual(desired);
        await manager.removeClient('restart');
        expect(manager.getConfiguredServerStatuses()[0]?.status).toBe('configured');
        await writeFile(modeFile, 'normal');
        await manager.connectConfiguredServer('restart');
        await manager.disconnectAll();
        expect(manager.getServerConfig('restart')).toBeUndefined();
        expect(manager.getFailedConnections()).toEqual({});
        expect(manager.getConfiguredServerStatuses()[0]?.status).toBe('configured');
        manager.forgetServerConfiguration('restart');
        expect(manager.getConfiguredServerStatuses()).toEqual([]);
    });
    it('keeps desired transport distinct from legacy connections and returns isolated metadata', async () => {
        manager.configureServer(
            'desired',
            McpServerConfigSchema.parse({
                type: 'http',
                url: 'https://example.com/private',
                headers: { Authorization: 'secret' },
            })
        );
        const actual = config('actual');
        await manager.connectServer('desired', actual);
        await manager.connectServer('legacy-only', config('legacy-only'));
        const statuses = manager.getConfiguredServerStatuses();
        expect(statuses).toEqual([
            { name: 'desired', configuredTransport: 'http', status: 'connected' },
        ]);
        expect(manager.getServerConfig('desired')).toEqual(actual);
        const row = statuses[0];
        if (row === undefined) throw new Error('Missing fixture status');
        Reflect.set(row, 'configuredTransport', 'sse');
        expect(manager.getConfiguredServerStatuses()[0]?.configuredTransport).toBe('http');
        await manager.removeClient('desired');
        expect(manager.getConfiguredServerStatuses()[0]?.status).toBe('configured');
        manager.forgetServerConfiguration('desired');
        expect(manager.getConfiguredServerStatuses()).toEqual([]);
        expect(manager.getClients().has('legacy-only')).toBe(true);
    });
    it('copies caller configuration and rejects configured connection reuse of an active name', async () => {
        const desired = config('copy');
        manager.configureServer('copy', desired);
        if (desired.type !== 'stdio') throw new Error('Missing fixture stdio config');
        desired.command = 'invalid-mutated-command';
        await manager.connectConfiguredServer('copy');
        expect(manager.getServerConfig('copy')?.type).toBe('stdio');
        await expect(manager.connectConfiguredServer('copy')).rejects.toThrow('active');
        const restartConfig = manager.getServerConfig('copy');
        if (restartConfig?.type !== 'stdio') throw new Error('Missing fixture restart config');
        restartConfig.command = 'invalid-legacy-command';
        await manager.removeClient('copy');
        await manager.connectConfiguredServer('copy');
        expect(manager.getConfiguredServerStatuses()[0]?.status).toBe('connected');
    });
    it.each(['constructor', 'toString'])(
        'does not inherit a failure for configured name %s',
        (name) => {
            manager.configureServer(name, config('prototype-name'));
            expect(manager.getConfiguredServerStatuses()).toEqual([
                { name, configuredTransport: 'stdio', status: 'configured' },
            ]);
        }
    );
    it('rejects the legacy reserved prototype name without storing desired configuration', () => {
        expect(() => manager.configureServer('__proto__', config('reserved'))).toThrow('reserved');
        expect(() => manager.configureServer('__proto__', config('reserved'))).toThrowError(
            expect.objectContaining({ code: MCPErrorCode.CONNECTION_FAILED })
        );
        expect(manager.getConfiguredServerStatuses()).toEqual([]);
    });
});
