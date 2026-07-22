import { describe, expect, it, vi } from 'vitest';
import { ToolSchema, type Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';

import { AgentEventBus } from '../events/index.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { createAgentRunContext } from '../runtime/run-context.js';
import { TestMCPConnections } from '../test-utils/mcp-connections.js';
import type { ToolSet } from '../tools/types.js';
import type { MCPConnection } from './connection-layer.js';
import { MCPErrorCode } from './error-codes.js';
import { MCPManager } from './manager.js';
import { toolSchemaFingerprint } from '../tools/schema-fingerprint.js';

function createDeferred<T>() {
    let resolve: ((value: T) => void) | undefined;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    if (!resolve) throw new Error('Deferred resolver was not initialized');
    return { promise, resolve };
}

function tool(description: string): ToolSet[string] {
    return {
        description,
        parameters: { type: 'object', properties: {} },
    };
}

function rawTools(tools: ToolSet): MCPTool[] {
    return Object.entries(tools).map(([name, definition]) =>
        ToolSchema.parse({
            name,
            description: definition.description,
            inputSchema: definition.parameters,
            ...(definition.outputSchema === undefined
                ? {}
                : { outputSchema: definition.outputSchema }),
            ...(definition.annotations === undefined
                ? {}
                : { annotations: definition.annotations }),
            ...(definition._meta === undefined ? {} : { _meta: definition._meta }),
        })
    );
}

function createConnection(options: {
    id: string;
    name?: string;
    tools: () => Promise<ToolSet>;
    callTool?: MCPConnection['callTool'];
    prompts?: MCPConnection['prompts'];
    resources?: MCPConnection['resources'];
}): MCPConnection {
    return {
        id: options.id,
        name: options.name ?? options.id,
        listTools: async () => rawTools(await options.tools()),
        callTool: options.callTool ?? vi.fn().mockResolvedValue({ ok: true }),
        ...(options.prompts ? { prompts: options.prompts } : {}),
        ...(options.resources ? { resources: options.resources } : {}),
    };
}

async function createManager(
    connections: TestMCPConnections,
    eventBus?: AgentEventBus
): Promise<MCPManager> {
    const manager = new MCPManager(connections, createMockLogger(), eventBus);
    await manager.initialize();
    return manager;
}

describe('MCPManager', () => {
    it('normalizes canonical schemas and dispatches through the injected connection', async () => {
        const connections = new TestMCPConnections();
        const invocation = vi.fn().mockResolvedValue({ items: ['dexto'] });
        const definition: ToolSet[string] = {
            description: 'Search the web',
            parameters: {
                type: 'object',
                properties: { query: { type: 'string' } },
                required: ['query'],
            },
            outputSchema: {
                type: 'object',
                properties: { items: { type: 'array' } },
            },
            annotations: { readOnlyHint: true },
        };
        connections.set(
            createConnection({
                id: 'connection-1',
                name: 'Web Search',
                tools: async () => ({ search: definition }),
                callTool: invocation,
            })
        );
        const manager = await createManager(connections);

        expect(manager.getToolDescriptor('search')).toEqual({
            name: 'search',
            description: 'Search the web',
            identity: {
                type: 'mcp',
                connectionId: 'connection-1',
                toolName: 'search',
            },
            inputSchema: definition.parameters,
            outputSchema: definition.outputSchema,
            annotations: { readOnlyHint: true },
            schemaFingerprint: toolSchemaFingerprint(
                definition.parameters,
                definition.outputSchema
            ),
        });

        const logger = createMockLogger();
        await expect(
            manager.executeTool('search', { query: 'dexto' }, { logger, sessionId: 'session-1' })
        ).resolves.toEqual({ items: ['dexto'] });
        expect(invocation).toHaveBeenCalledWith(
            'search',
            { query: 'dexto' },
            {
                logger,
                sessionId: 'session-1',
            }
        );
    });

    it('validates tool input against the canonical MCP schema before dispatch', async () => {
        const callTool = vi.fn().mockResolvedValue({ ok: true });
        const connections = new TestMCPConnections();
        connections.set(
            createConnection({
                id: 'connection-1',
                tools: async () => ({
                    lookup: {
                        description: 'Lookup a record',
                        parameters: {
                            additionalProperties: false,
                            properties: { id: { type: 'string' } },
                            required: ['id'],
                            type: 'object',
                        },
                    },
                }),
                callTool,
            })
        );
        const manager = await createManager(connections);

        expect(manager.validateToolInput('lookup', { id: 'record-1' })).toEqual({
            id: 'record-1',
        });
        expect(() => manager.validateToolInput('lookup', { id: 42 })).toThrow(
            "MCP tool 'lookup' received invalid arguments"
        );
        expect(() => manager.validateToolInput('lookup', { id: 'record-1', extra: true })).toThrow(
            "MCP tool 'lookup' received invalid arguments"
        );

        await expect(manager.executeTool('lookup', { id: 42 })).rejects.toThrow(
            "MCP tool 'lookup' received invalid arguments"
        );
        expect(callTool).not.toHaveBeenCalled();
    });

    it('does not copy upstream tool failures into logs', async () => {
        const sensitiveError = new Error('provider-private-error-body');
        const connections = new TestMCPConnections();
        connections.set(
            createConnection({
                id: 'connection-1',
                tools: async () => ({ lookup: tool('Lookup') }),
                callTool: vi.fn().mockRejectedValue(sensitiveError),
            })
        );
        const logger = createMockLogger();
        const manager = new MCPManager(connections, logger);
        await manager.initialize();

        await expect(manager.executeTool('lookup', {})).rejects.toBe(sensitiveError);

        expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
            sensitiveError.message
        );
    });

    it('qualifies conflicts and restores the simple alias when one connection remains', async () => {
        const connections = new TestMCPConnections();
        const firstCall = vi.fn().mockResolvedValue({ source: 'first' });
        const secondCall = vi.fn().mockResolvedValue({ source: 'second' });
        connections.set(
            createConnection({
                id: 'first-id',
                name: 'First Server',
                tools: async () => ({ shared: tool('First shared tool') }),
                callTool: firstCall,
            })
        );
        connections.set(
            createConnection({
                id: 'second-id',
                name: 'Second Server',
                tools: async () => ({ shared: tool('Second shared tool') }),
                callTool: secondCall,
            })
        );
        const manager = await createManager(connections);

        expect(Object.keys(await manager.getAllTools()).sort()).toEqual([
            'First_Server--shared',
            'Second_Server--shared',
        ]);
        await manager.executeTool('Second_Server--shared', {});
        expect(secondCall).toHaveBeenCalledWith('shared', {}, undefined);

        connections.delete('second-id');
        await connections.announce({ type: 'connections-changed' });

        expect(Object.keys(await manager.getAllTools())).toEqual(['shared']);
        expect(manager.getToolDescriptor('shared')?.identity).toEqual({
            type: 'mcp',
            connectionId: 'first-id',
            toolName: 'shared',
        });
    });

    it('uses stable connection-derived suffixes when display names produce the same namespace', async () => {
        const connections = new TestMCPConnections();
        connections.set(
            createConnection({
                id: 'connection-one',
                name: 'my@server',
                tools: async () => ({ shared: tool('First') }),
            })
        );
        connections.set(
            createConnection({
                id: 'connection-two',
                name: 'my_server',
                tools: async () => ({ shared: tool('Second') }),
            })
        );
        const manager = await createManager(connections);
        const aliasesByIdentity = new Map(
            manager
                .getToolDescriptors()
                .map((descriptor) => [descriptor.identity.connectionId, descriptor.name])
        );

        const reversedConnections = new TestMCPConnections();
        reversedConnections.set(
            createConnection({
                id: 'connection-two',
                name: 'my_server',
                tools: async () => ({ shared: tool('Second') }),
            })
        );
        reversedConnections.set(
            createConnection({
                id: 'connection-one',
                name: 'my@server',
                tools: async () => ({ shared: tool('First') }),
            })
        );
        const reversedManager = await createManager(reversedConnections);

        expect(aliasesByIdentity).toEqual(
            new Map(
                reversedManager
                    .getToolDescriptors()
                    .map((descriptor) => [descriptor.identity.connectionId, descriptor.name])
            )
        );
        expect(Array.from(aliasesByIdentity.values())).toEqual([
            expect.stringMatching(/^my_server_[a-z0-9]+--shared$/),
            expect.stringMatching(/^my_server_[a-z0-9]+--shared$/),
        ]);
        expect(new Set(aliasesByIdentity.values()).size).toBe(2);
    });

    it('keeps canonical identity stable when the display name changes', async () => {
        const connections = new TestMCPConnections();
        const operation = createConnection({
            id: 'stable-id',
            name: 'Old Name',
            tools: async () => ({ lookup: tool('Lookup') }),
        });
        connections.set(operation);
        const manager = await createManager(connections);

        connections.set({ ...operation, name: 'New Name' });
        await connections.announce({ type: 'connections-changed' });

        expect(manager.getToolDescriptor('lookup')?.identity).toEqual({
            type: 'mcp',
            connectionId: 'stable-id',
            toolName: 'lookup',
        });
    });

    it('refreshes a changed tool catalog from layer invalidation', async () => {
        const eventBus = new AgentEventBus();
        const event = vi.fn();
        eventBus.on('mcp:tools-list-changed', event);
        let tools: ToolSet = { old_tool: tool('Old') };
        const getTools = vi.fn(async () => tools);
        const listPrompts = vi.fn().mockResolvedValue([{ name: 'unchanged-prompt' }]);
        const listResources = vi
            .fn()
            .mockResolvedValue([{ uri: 'file:///unchanged.txt', name: 'Unchanged' }]);
        const connections = new TestMCPConnections();
        connections.set(
            createConnection({
                id: 'server-1',
                tools: getTools,
                prompts: { list: listPrompts, get: vi.fn() },
                resources: { list: listResources, read: vi.fn() },
            })
        );
        const manager = await createManager(connections, eventBus);
        const initialFingerprint = manager.getToolDescriptor('old_tool')?.schemaFingerprint;
        getTools.mockClear();
        listPrompts.mockClear();
        listResources.mockClear();

        tools = {
            new_tool: {
                description: 'New',
                parameters: {
                    properties: { id: { type: 'string' } },
                    required: ['id'],
                    type: 'object',
                },
            },
        };
        await connections.announce({ type: 'tools-changed', connectionId: 'server-1' });

        expect(manager.getToolDescriptor('old_tool')).toBeUndefined();
        expect(manager.getToolDescriptor('new_tool')).toBeDefined();
        expect(manager.getToolDescriptor('new_tool')?.schemaFingerprint).not.toBe(
            initialFingerprint
        );
        expect(getTools).toHaveBeenCalledOnce();
        expect(listPrompts).not.toHaveBeenCalled();
        expect(listResources).not.toHaveBeenCalled();
        expect(event).toHaveBeenCalledWith({ serverName: 'server-1', tools: ['new_tool'] });
    });

    it('refreshes prompt and resource catalogs only for their invalidated surface', async () => {
        const getTools = vi.fn().mockResolvedValue({ stable_tool: tool('Stable') });
        const listPrompts = vi
            .fn()
            .mockResolvedValueOnce([{ name: 'old-prompt' }])
            .mockResolvedValueOnce([{ name: 'new-prompt' }]);
        const listResources = vi
            .fn()
            .mockResolvedValueOnce([{ uri: 'file:///old.txt', name: 'Old' }])
            .mockResolvedValueOnce([{ uri: 'file:///new.txt', name: 'New' }]);
        const connections = new TestMCPConnections();
        connections.set(
            createConnection({
                id: 'server-1',
                tools: getTools,
                prompts: { list: listPrompts, get: vi.fn() },
                resources: { list: listResources, read: vi.fn() },
            })
        );
        const manager = await createManager(connections);
        getTools.mockClear();

        await connections.announce({ type: 'prompts-changed', connectionId: 'server-1' });
        expect(await manager.listAllPrompts()).toEqual(['new-prompt']);
        expect(getTools).not.toHaveBeenCalled();
        expect(listResources).toHaveBeenCalledOnce();

        listResources.mockClear();
        await connections.announce({ type: 'resources-changed', connectionId: 'server-1' });
        expect((await manager.listAllResources()).map((resource) => resource.summary.uri)).toEqual([
            'file:///new.txt',
        ]);
        expect(getTools).not.toHaveBeenCalled();
        expect(listPrompts).toHaveBeenCalledTimes(2);
        expect(listResources).toHaveBeenCalledOnce();
    });

    it('serializes overlapping invalidations so an older response cannot win', async () => {
        const firstRefresh = createDeferred<ToolSet>();
        const getTools = vi
            .fn<() => Promise<ToolSet>>()
            .mockResolvedValueOnce({ initial: tool('Initial') })
            .mockImplementationOnce(() => firstRefresh.promise)
            .mockResolvedValueOnce({ newest: tool('Newest') });
        const connections = new TestMCPConnections();
        connections.set(createConnection({ id: 'server-1', tools: getTools }));
        const manager = await createManager(connections);

        const older = connections.announce({
            type: 'tools-changed',
            connectionId: 'server-1',
        });
        const newer = connections.announce({
            type: 'tools-changed',
            connectionId: 'server-1',
        });
        firstRefresh.resolve({ older: tool('Older') });
        await Promise.all([older, newer]);

        expect(manager.getToolDescriptors().map((descriptor) => descriptor.name)).toEqual([
            'newest',
        ]);
    });

    it('supports tool-only connections without inventing prompt or resource capabilities', async () => {
        const connections = new TestMCPConnections();
        connections.set(
            createConnection({
                id: 'cloud-connection',
                tools: async () => ({ ping: tool('Ping') }),
            })
        );
        const manager = await createManager(connections);

        expect(await manager.listAllPrompts()).toEqual([]);
        expect(await manager.listAllResources()).toEqual([]);
        expect(manager.getToolDescriptor('ping')).toBeDefined();
    });

    it('caches optional prompt and resource catalogs while dispatching reads on demand', async () => {
        const listPrompts = vi
            .fn()
            .mockResolvedValue([{ name: 'summarize', description: 'Summarize content' }]);
        const getPrompt = vi.fn().mockResolvedValue({
            messages: [{ role: 'user', content: { type: 'text', text: 'Summarize' } }],
        });
        const listResources = vi
            .fn()
            .mockResolvedValue([
                { uri: 'file:///report.txt', name: 'Report', mimeType: 'text/plain' },
            ]);
        const readResource = vi.fn().mockResolvedValue({
            contents: [{ uri: 'file:///report.txt', text: 'Report contents' }],
        });
        const connections = new TestMCPConnections();
        connections.set(
            createConnection({
                id: 'content',
                tools: async () => ({}),
                prompts: { list: listPrompts, get: getPrompt },
                resources: { list: listResources, read: readResource },
            })
        );
        const manager = await createManager(connections);
        listPrompts.mockClear();
        listResources.mockClear();

        expect(await manager.listAllPrompts()).toEqual(['summarize']);
        expect(await manager.listAllPrompts()).toEqual(['summarize']);
        expect(await manager.listAllResources()).toEqual([
            {
                key: 'mcp:content:file:///report.txt',
                serverName: 'content',
                summary: {
                    uri: 'file:///report.txt',
                    name: 'Report',
                    mimeType: 'text/plain',
                },
            },
        ]);
        expect(listPrompts).not.toHaveBeenCalled();
        expect(listResources).not.toHaveBeenCalled();

        await manager.getPrompt('summarize', { style: 'short' });
        await manager.readResource('mcp:content:file:///report.txt');
        expect(getPrompt).toHaveBeenCalledWith('summarize', { style: 'short' });
        expect(readResource).toHaveBeenCalledWith('file:///report.txt');
    });

    it('passes execution-scoped run context to the raw operation', async () => {
        const callTool = vi.fn().mockResolvedValue({ ok: true });
        const runContext = createAgentRunContext({
            sessionId: 'session-1',
            hostRuntime: {
                ids: { runId: 'run-1', runAttemptId: 'attempt-1' },
            },
        });
        const connections = new TestMCPConnections();
        connections.set(
            createConnection({
                id: 'server-1',
                tools: async () => ({ inspect: tool('Inspect') }),
                callTool,
            })
        );
        const manager = await createManager(connections);

        const logger = createMockLogger();
        await manager.executeTool(
            'inspect',
            {},
            {
                logger,
                runContext,
                sessionId: 'session-1',
                toolCallId: 'call-1',
            }
        );

        expect(callTool).toHaveBeenCalledWith(
            'inspect',
            {},
            { logger, sessionId: 'session-1', runContext, toolCallId: 'call-1' }
        );
    });

    it('rejects unknown tools before calling a connection', async () => {
        const callTool = vi.fn();
        const connections = new TestMCPConnections();
        connections.set(createConnection({ id: 'server-1', tools: async () => ({}), callTool }));
        const manager = await createManager(connections);

        await expect(manager.executeTool('missing', {})).rejects.toMatchObject({
            code: MCPErrorCode.TOOL_NOT_FOUND,
        });
        expect(callTool).not.toHaveBeenCalled();
    });

    it('unsubscribes from layer invalidations when connections close', async () => {
        const connections = new TestMCPConnections();
        connections.set(
            createConnection({ id: 'server-1', tools: async () => ({ first: tool('First') }) })
        );
        const manager = await createManager(connections);

        await manager.close();
        connections.set(
            createConnection({ id: 'server-2', tools: async () => ({ second: tool('Second') }) })
        );
        await connections.announce({ type: 'connections-changed' });

        expect(manager.getToolDescriptors()).toEqual([]);
    });
});
