import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCPManager } from './manager.js';
import { McpServerConfigSchema } from './schemas.js';
import { AgentEventBus } from '../events/index.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { DextoMcpClient } from './mcp-client.js';

function recordedLogs(logger: ReturnType<typeof createMockLogger>): string {
    return JSON.stringify([
        vi.mocked(logger.info).mock.calls,
        vi.mocked(logger.debug).mock.calls,
        vi.mocked(logger.silly).mock.calls,
        vi.mocked(logger.warn).mock.calls,
        vi.mocked(logger.error).mock.calls,
    ]);
}

describe('MCP transport diagnostics', () => {
    it.each([false, true])(
        'keeps stdio diagnostics private with notification registration failure=%s',
        async (registrationFails) => {
            const directory = await mkdtemp(join(tmpdir(), 'dexto-mcp-diagnostics-'));
            const logger = createMockLogger();
            const client = new DextoMcpClient(logger);
            const secret = 'private-stdio-argument-sentinel';
            const resourceUpdated = vi.fn();
            client.on('resourceUpdated', resourceUpdated);
            if (registrationFails) {
                const original = Client.prototype.setNotificationHandler;
                vi.spyOn(Client.prototype, 'setNotificationHandler').mockImplementation(function (
                    this: Client,
                    schema,
                    handler
                ) {
                    if (schema === ResourceUpdatedNotificationSchema) throw new Error(secret);
                    return original.call(this, schema, handler);
                });
            }
            try {
                await client.connectViaStdio(
                    process.execPath,
                    [
                        fileURLToPath(new URL('./fixtures/lifecycle-server.mjs', import.meta.url)),
                        join(directory, 'server.pid'),
                        'notify-resource',
                        secret,
                    ],
                    { HOME: directory, USERPROFILE: directory, FIXTURE_TOKEN: secret },
                    'fixture'
                );
                expect(client.getConnectionStatus()).toBe(true);
                expect(client.getServerInfo()).toMatchObject({
                    command: process.execPath,
                    env: { FIXTURE_TOKEN: secret },
                    originalArgs: expect.arrayContaining([secret]),
                    resolvedArgs: expect.arrayContaining([secret]),
                });
                await expect(client.callTool('ping', {})).resolves.toMatchObject({
                    content: [{ type: 'text', text: 'pong' }],
                });
                if (!registrationFails)
                    expect(resourceUpdated).toHaveBeenCalledWith({ uri: secret });
                expect(recordedLogs(logger)).toContain('fixture');
                expect(recordedLogs(logger)).not.toContain(secret);
                expect(recordedLogs(logger)).not.toContain(process.execPath);
                expect(recordedLogs(logger)).not.toContain('FIXTURE_TOKEN');
            } finally {
                await client.disconnect();
                await rm(directory, { recursive: true, force: true });
                vi.restoreAllMocks();
            }
        },
        15000
    );
    it.each(['http', 'sse'])(
        'keeps %s URL and response failures private while retaining caller diagnostics',
        async (type) => {
            const logger = createMockLogger();
            const manager = new MCPManager(logger, new AgentEventBus());
            const secret = 'private-http-diagnostics-sentinel';
            const requests: string[] = [];
            const server = createServer((request, response) => {
                requests.push(request.url ?? '');
                response.writeHead(500, { 'Content-Type': 'text/plain' });
                response.end(secret);
            });
            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
            const address = server.address();
            if (!address || typeof address === 'string')
                throw new Error('Expected a loopback TCP address');
            try {
                const config = McpServerConfigSchema.parse({
                    type,
                    url: `http://127.0.0.1:${address.port}/mcp?token=${secret}`,
                    headers: { Authorization: `Bearer ${secret}` },
                });
                await expect(manager.connectServer('fixture', config)).rejects.toThrow(
                    'Failed to connect'
                );
                expect(requests).toContain(`/mcp?token=${secret}`);
                expect(manager.getFailedConnectionError('fixture')).toContain(
                    type === 'http' ? secret : 'Non-200 status code (500)'
                );
                expect(recordedLogs(logger)).toContain('fixture');
                expect(recordedLogs(logger)).not.toContain(secret);
                expect(recordedLogs(logger)).toContain('mcp_connection_failed');
            } finally {
                await manager.disconnectAll();
                server.closeAllConnections();
                await new Promise<void>((resolve, reject) =>
                    server.close((error) => (error ? reject(error) : resolve()))
                );
            }
        },
        15000
    );
});
