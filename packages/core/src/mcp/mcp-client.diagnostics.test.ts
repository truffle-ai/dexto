import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { DextoMcpClient } from './mcp-client.js';
import { MCPManager } from './manager.js';
import { AgentEventBus } from '../events/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServerConfigSchema, ServersConfigSchema } from './schemas.js';
import type { ToolSet } from '../tools/types.js';
import { ApprovalManager } from '../approval/manager.js';
import { ApprovalStatus } from '../approval/types.js';
import { createInMemorySessionApprovalStore } from '../test-utils/session-state-stores.js';

afterEach(() => vi.restoreAllMocks());

const sentinel = 'private-mcp-payload-sentinel';

function recordedLogs(logger: ReturnType<typeof createMockLogger>): string {
    return JSON.stringify([
        vi.mocked(logger.info).mock.calls,
        vi.mocked(logger.debug).mock.calls,
        vi.mocked(logger.silly).mock.calls,
        vi.mocked(logger.warn).mock.calls,
        vi.mocked(logger.error).mock.calls,
    ]);
}

describe('MCP client diagnostics', () => {
    it('keeps prompt and resource payloads private while returning them unchanged', async () => {
        const logger = createMockLogger();
        const prompt = { messages: [{ role: 'user', content: { type: 'text', text: sentinel } }] };
        const resource = { contents: [{ uri: `secret://${sentinel}`, text: sentinel }] };
        const sdk = {
            listPrompts: vi
                .fn()
                .mockResolvedValue({ prompts: [{ name: 'lookup', description: sentinel }] }),
            getPrompt: vi.fn().mockResolvedValue(prompt),
            listResources: vi.fn().mockResolvedValue({
                resources: [
                    { name: 'record', uri: resource.contents[0]!.uri, description: sentinel },
                ],
            }),
            readResource: vi.fn().mockResolvedValue(resource),
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    {
                        name: 'lookup',
                        description: sentinel,
                        inputSchema: { type: 'object', description: sentinel },
                    },
                ],
            }),
        };
        const client = new DextoMcpClient(logger);
        Reflect.set(client, 'client', sdk);
        Reflect.set(client, 'isConnected', true);
        await expect(client.listPrompts()).resolves.toEqual([
            { name: 'lookup', description: sentinel },
        ]);
        await expect(client.getPrompt('lookup', { token: sentinel })).resolves.toBe(prompt);
        await expect(client.listResources()).resolves.toEqual([
            { name: 'record', uri: resource.contents[0]!.uri, description: sentinel },
        ]);
        await expect(client.readResource(resource.contents[0]!.uri)).resolves.toBe(resource);
        expect(await client.getTools()).toMatchObject({ lookup: { description: sentinel } });
        expect(sdk.getPrompt).toHaveBeenCalledWith(
            { name: 'lookup', arguments: { token: sentinel } },
            { timeout: 60000 }
        );
        expect(recordedLogs(logger)).not.toContain(sentinel);
    });
    it('keeps raw provider failures out of diagnostics without changing error results', async () => {
        const logger = createMockLogger();
        const failure = new Error(sentinel);
        Reflect.set(failure, 'details', { token: sentinel });
        const sdk = {
            listTools: vi.fn().mockRejectedValue(failure),
            listPrompts: vi.fn().mockRejectedValue(failure),
            getPrompt: vi.fn().mockRejectedValue(failure),
            listResources: vi.fn().mockRejectedValue(failure),
            readResource: vi.fn().mockRejectedValue(failure),
        };
        const client = new DextoMcpClient(logger);
        Reflect.set(client, 'client', sdk);
        Reflect.set(client, 'isConnected', true);
        await expect(client.getTools()).resolves.toEqual({});
        await expect(client.listPrompts()).resolves.toEqual([]);
        await expect(client.listResources()).resolves.toEqual([]);
        await expect(client.getPrompt('lookup')).rejects.toThrow(sentinel);
        await expect(client.readResource(`secret://${sentinel}`)).rejects.toThrow(sentinel);
        expect(recordedLogs(logger)).not.toContain(sentinel);
        expect(recordedLogs(logger)).toContain('mcp_protocol_error');
    });

    it('keeps manager cache payloads and resource notification URIs private', async () => {
        const logger = createMockLogger();
        const eventBus = new AgentEventBus();
        const resourceUpdated = vi.fn();
        eventBus.on('mcp:resource-updated', resourceUpdated);
        const manager = new MCPManager(logger, eventBus);
        const client = new DextoMcpClient(logger);
        const tools: ToolSet = {
            lookup: {
                description: sentinel,
                parameters: { type: 'object', description: sentinel },
            },
        };
        vi.spyOn(client, 'getTools').mockResolvedValue(tools);
        vi.spyOn(client, 'listPrompts').mockResolvedValue([]);
        vi.spyOn(client, 'listResources').mockResolvedValue([
            { name: 'record', uri: `secret://${sentinel}` },
        ]);
        manager.registerClient('fixture', client);
        await manager.refresh();
        expect(await manager.getAllTools()).toEqual(tools);
        client.emit('resourceUpdated', { uri: `secret://${sentinel}` });
        await vi.waitFor(() =>
            expect(resourceUpdated).toHaveBeenCalledWith({
                serverName: 'fixture',
                resourceUri: `secret://${sentinel}`,
            })
        );
        expect(recordedLogs(logger)).not.toContain(sentinel);
    });

    it('keeps manager discovery, notification and disconnect failures private', async () => {
        const logger = createMockLogger();
        const eventBus = new AgentEventBus();
        const manager = new MCPManager(logger, eventBus);
        const client = new DextoMcpClient(logger);
        const failure = new Error(sentinel);
        const tools = vi.spyOn(client, 'getTools').mockRejectedValue(failure);
        vi.spyOn(client, 'listPrompts').mockRejectedValue(failure);
        vi.spyOn(client, 'listResources').mockRejectedValue(failure);
        vi.spyOn(client, 'disconnect').mockRejectedValue(failure);
        manager.registerClient('fixture', client);
        await manager.refresh();
        tools.mockResolvedValue({});
        await manager.refresh();
        client.emit('promptsListChanged');
        client.emit('toolsListChanged');
        client.emit('resourceUpdated', { uri: `secret://${sentinel}` });
        await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled());
        await manager.removeClient('fixture');
        manager.registerClient('fixture', client);
        await manager.disconnectAll();
        expect(manager.getClients().size).toBe(0);
        expect(recordedLogs(logger)).not.toContain(sentinel);
    });

    it('keeps initialization and restart failures private without hiding stored errors', async () => {
        const logger = createMockLogger();
        const manager = new MCPManager(logger, new AgentEventBus());
        const failure = new Error(sentinel);
        Reflect.set(failure, 'code', sentinel);
        Reflect.set(failure, 'cause', { token: sentinel });
        const connect = vi
            .spyOn(DextoMcpClient.prototype, 'connect')
            .mockResolvedValue(
                new Client({ name: 'fixture', version: '1.0.0' }, { capabilities: {} })
            );
        vi.spyOn(DextoMcpClient.prototype, 'getTools').mockResolvedValue({});
        vi.spyOn(DextoMcpClient.prototype, 'listPrompts').mockResolvedValue([]);
        vi.spyOn(DextoMcpClient.prototype, 'listResources').mockResolvedValue([]);
        const disconnect = vi.spyOn(DextoMcpClient.prototype, 'disconnect').mockResolvedValue();
        const config = McpServerConfigSchema.parse({ type: 'stdio', command: 'unused-fixture' });
        await manager.connectServer('fixture', config);
        connect.mockRejectedValue(failure);
        disconnect.mockRejectedValue(failure);
        await expect(manager.restartServer('fixture')).rejects.toThrow(sentinel);
        expect(manager.getServerConfig('fixture')).toEqual(config);
        expect(manager.getFailedConnectionError('fixture')).toBe(sentinel);
        expect(manager.getFailedConnectionErrorCode('fixture')).toBe(sentinel);
        expect(logger.error).toHaveBeenCalledWith("Failed to restart server 'fixture'", {
            code: 'mcp_connection_failed',
        });
        await manager.initializeFromConfig(ServersConfigSchema.parse({ other: config }));
        expect(manager.getFailedConnectionError('other')).toBe(sentinel);
        expect(recordedLogs(logger)).not.toContain(sentinel);
    });

    it('keeps elicitation content and transport-close errors private without changing results', async () => {
        const logger = createMockLogger();
        const client = new DextoMcpClient(logger);
        let handler:
            | ((request: {
                  params: { message: string; requestedSchema: Record<string, unknown> };
              }) => Promise<unknown>)
            | undefined;
        const sdk = {
            setRequestHandler: vi.fn((_schema, callback) => {
                handler = callback;
            }),
        };
        Reflect.set(client, 'client', sdk);
        Reflect.set(client, 'serverAlias', 'fixture');
        Reflect.set(client, 'transport', { close: vi.fn().mockRejectedValue(new Error(sentinel)) });
        const approval = new ApprovalManager(
            { permissions: { mode: 'manual' }, elicitation: { enabled: true } },
            logger,
            createInMemorySessionApprovalStore(logger)
        );
        const request = vi
            .spyOn(approval, 'requestElicitation')
            .mockResolvedValueOnce({
                approvalId: 'fixture-approval',
                status: ApprovalStatus.APPROVED,
                data: { formData: { token: sentinel } },
            })
            .mockRejectedValueOnce(new Error(sentinel));
        client.setApprovalManager(approval);
        if (!handler) throw new Error('Expected elicitation request handler');
        const elicitation = {
            params: {
                message: sentinel,
                requestedSchema: { type: 'object', description: sentinel },
            },
        };
        await expect(handler(elicitation)).resolves.toEqual({
            action: 'accept',
            content: { token: sentinel },
        });
        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: sentinel,
                schema: elicitation.params.requestedSchema,
            })
        );
        await expect(handler(elicitation)).resolves.toEqual({ action: 'decline' });
        await expect(client.disconnect()).resolves.toBeUndefined();
        expect(recordedLogs(logger)).not.toContain(sentinel);
    });
});
