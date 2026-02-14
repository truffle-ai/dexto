import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { MCPManager } from './manager.js';
import type { McpClient, MCPResourceSummary } from './types.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { MCPErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { eventBus } from '../events/index.js';
import type { JSONSchema7 } from 'json-schema';
import type { Prompt } from '@modelcontextprotocol/sdk/types.js';

// Mock client for testing
class MockMCPClient extends EventEmitter implements McpClient {
    private tools: Record<
        string,
        { name?: string; description?: string; parameters: JSONSchema7 }
    > = {};
    private prompts: string[] = [];
    private resources: MCPResourceSummary[] = [];

    constructor(
        tools: Record<
            string,
            { name?: string; description?: string; parameters: JSONSchema7 }
        > = {},
        prompts: string[] = [],
        resources: MCPResourceSummary[] = []
    ) {
        super();
        this.tools = tools;
        this.prompts = prompts;
        this.resources = resources;
    }

    async connect(): Promise<any> {
        return {} as any; // Mock client
    }
    async disconnect(): Promise<void> {}

    async getConnectedClient(): Promise<any> {
        return {} as any; // Mock client
    }

    async getTools(): Promise<
        Record<string, { name?: string; description?: string; parameters: JSONSchema7 }>
    > {
        return this.tools;
    }

    async callTool(name: string, args: any): Promise<any> {
        if (!this.tools[name]) {
            throw new Error(`Tool ${name} not found`);
        }
        return { result: `Called ${name} with ${JSON.stringify(args)}` };
    }

    async listPrompts(): Promise<Prompt[]> {
        return this.prompts.map((name) => ({
            name,
            description: `Prompt ${name}`,
        }));
    }

    async getPrompt(name: string, _args?: any): Promise<any> {
        if (!this.prompts.includes(name)) {
            throw new Error(`Prompt ${name} not found`);
        }
        return {
            description: `Prompt ${name}`,
            messages: [{ role: 'user', content: { type: 'text', text: `Content for ${name}` } }],
        };
    }

    async listResources(): Promise<MCPResourceSummary[]> {
        return this.resources;
    }

    async readResource(uri: string): Promise<any> {
        if (!this.resources.find((r) => r.uri === uri)) {
            throw new Error(`Resource ${uri} not found`);
        }
        return {
            contents: [{ uri, mimeType: 'text/plain', text: `Resource content for ${uri}` }],
        };
    }

    // Public setters for test manipulation
    setTools(
        tools: Record<string, { name?: string; description?: string; parameters: JSONSchema7 }>
    ): void {
        this.tools = tools;
    }

    setPrompts(prompts: string[]): void {
        this.prompts = prompts;
    }

    setResources(resources: MCPResourceSummary[]): void {
        this.resources = resources;
    }
}

describe('MCPManager Tool Conflict Resolution', () => {
    let manager: MCPManager;
    let client1: MockMCPClient;
    let client2: MockMCPClient;
    let client3: MockMCPClient;
    let mockLogger: any;

    beforeEach(() => {
        mockLogger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            silly: vi.fn(),
            trackException: vi.fn(),
            createChild: vi.fn(function (this: any) {
                return this;
            }),
            destroy: vi.fn(),
        } as any;
        manager = new MCPManager(mockLogger);

        // Create clients with overlapping and unique tools
        client1 = new MockMCPClient({
            unique_tool_1: {
                description: 'Tool unique to server 1',
                parameters: { type: 'object', properties: {} },
            },
            shared_tool: {
                description: 'Tool shared between servers',
                parameters: { type: 'object', properties: {} },
            },
            tool__with__underscores: {
                description: 'Tool with underscores in name',
                parameters: { type: 'object', properties: {} },
            },
        });

        client2 = new MockMCPClient({
            unique_tool_2: {
                description: 'Tool unique to server 2',
                parameters: { type: 'object', properties: {} },
            },
            shared_tool: {
                description: 'Different implementation of shared tool',
                parameters: { type: 'object', properties: {} },
            },
            another_shared: {
                description: 'Another shared tool',
                parameters: { type: 'object', properties: {} },
            },
        });

        client3 = new MockMCPClient({
            unique_tool_3: {
                description: 'Tool unique to server 3',
                parameters: { type: 'object', properties: {} },
            },
            another_shared: {
                description: 'Third implementation of another_shared',
                parameters: { type: 'object', properties: {} },
            },
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Basic Tool Registration and Conflict Detection', () => {
        it('should register tools from single client without conflicts', async () => {
            manager.registerClient('server1', client1);
            await manager['updateClientCache']('server1', client1);

            const tools = await manager.getAllTools();

            expect(tools).toHaveProperty('unique_tool_1');
            expect(tools).toHaveProperty('shared_tool');
            expect(tools).toHaveProperty('tool__with__underscores');
            expect(Object.keys(tools)).toHaveLength(3);
        });

        it('should detect conflicts and use qualified names', async () => {
            manager.registerClient('server1', client1);
            manager.registerClient('server2', client2);
            await manager['updateClientCache']('server1', client1);
            await manager['updateClientCache']('server2', client2);

            const tools = await manager.getAllTools();

            // Unique tools should be available directly
            expect(tools).toHaveProperty('unique_tool_1');
            expect(tools).toHaveProperty('unique_tool_2');

            // Conflicted tools should be qualified
            expect(tools).toHaveProperty('server1--shared_tool');
            expect(tools).toHaveProperty('server2--shared_tool');
            expect(tools).not.toHaveProperty('shared_tool'); // Unqualified should not exist

            // Verify descriptions are augmented (qualified tools always have descriptions)
            expect(tools['server1--shared_tool']!.description!).toContain('(via server1)');
            expect(tools['server2--shared_tool']!.description!).toContain('(via server2)');
        });

        it('should handle three-way conflicts correctly', async () => {
            manager.registerClient('server1', client1);
            manager.registerClient('server2', client2);
            manager.registerClient('server3', client3);

            await Promise.all([
                manager['updateClientCache']('server1', client1),
                manager['updateClientCache']('server2', client2),
                manager['updateClientCache']('server3', client3),
            ]);

            const tools = await manager.getAllTools();

            // Check that 'another_shared' appears as qualified from server2 and server3
            expect(tools).toHaveProperty('server2--another_shared');
            expect(tools).toHaveProperty('server3--another_shared');
            expect(tools).not.toHaveProperty('another_shared');

            // Unique tools should still be available
            expect(tools).toHaveProperty('unique_tool_1');
            expect(tools).toHaveProperty('unique_tool_2');
            expect(tools).toHaveProperty('unique_tool_3');
        });
    });

    describe('Conflict Resolution and Tool Restoration', () => {
        it('should restore tools to fast lookup when conflicts disappear', async () => {
            // Register two servers with conflicting tools
            manager.registerClient('server1', client1);
            manager.registerClient('server2', client2);
            await manager['updateClientCache']('server1', client1);
            await manager['updateClientCache']('server2', client2);

            let tools = await manager.getAllTools();
            expect(tools).toHaveProperty('server1--shared_tool');
            expect(tools).toHaveProperty('server2--shared_tool');
            expect(tools).not.toHaveProperty('shared_tool');

            // Remove one server to resolve conflict
            await manager.removeClient('server2');

            tools = await manager.getAllTools();

            // Now shared_tool should be available directly (conflict resolved)
            expect(tools).toHaveProperty('shared_tool');
            expect(tools).not.toHaveProperty('server1--shared_tool');
            expect(tools).not.toHaveProperty('server2--shared_tool');

            // Verify it can be resolved via getToolClient
            const client = manager.getToolClient('shared_tool');
            expect(client).toBe(client1);
        });

        it('should handle complex conflict resolution scenarios', async () => {
            // Register all three servers
            manager.registerClient('server1', client1);
            manager.registerClient('server2', client2);
            manager.registerClient('server3', client3);

            await Promise.all([
                manager['updateClientCache']('server1', client1),
                manager['updateClientCache']('server2', client2),
                manager['updateClientCache']('server3', client3),
            ]);

            // Remove server2, 'another_shared' should still be conflicted between server3
            await manager.removeClient('server2');

            const tools = await manager.getAllTools();

            // 'shared_tool' should be resolved since only server1 has it now
            expect(tools).toHaveProperty('shared_tool');
            expect(tools).not.toHaveProperty('server1--shared_tool');

            // 'another_shared' should still not exist as direct tool since server3 still has it
            // Actually, with only one server having it, it should be restored
            expect(tools).toHaveProperty('another_shared');
            expect(tools).not.toHaveProperty('server3--another_shared');
        });
    });

    describe('Server Name Sanitization and Collision Prevention', () => {
        it('should sanitize server names correctly', () => {
            const sanitize = manager['sanitizeServerName'].bind(manager);

            expect(sanitize('my-server')).toBe('my-server');
            expect(sanitize('my_server')).toBe('my_server');
            expect(sanitize('my@server')).toBe('my_server');
            expect(sanitize('my.server')).toBe('my_server');
            expect(sanitize('my server')).toBe('my_server');
            expect(sanitize('my/server\\path')).toBe('my_server_path');
        });

        it('should prevent sanitized name collisions', () => {
            manager.registerClient('my_server', client1);

            const error = (() => {
                try {
                    manager.registerClient('my@server', client2); // Both sanitize to 'my_server'
                    return null;
                } catch (e) {
                    return e;
                }
            })() as DextoRuntimeError;
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(MCPErrorCode.DUPLICATE_NAME);
            expect(error.scope).toBe(ErrorScope.MCP);
            expect(error.type).toBe(ErrorType.USER);
        });

        it('should allow re-registering the same server name', () => {
            manager.registerClient('server1', client1);

            // Should not throw when re-registering the same name
            expect(() => {
                manager.registerClient('server1', client2);
            }).not.toThrow();
        });

        it('should clean up sanitized mappings on client removal', async () => {
            manager.registerClient('my@server', client1);
            await manager.removeClient('my@server');

            // Should now be able to register a server that sanitizes to the same name
            expect(() => {
                manager.registerClient('my_server', client2);
            }).not.toThrow();
        });
    });

    describe('Qualified Tool Name Parsing', () => {
        beforeEach(async () => {
            manager.registerClient('server__with__underscores', client1);
            manager.registerClient('server@@with@@delimiters', client2);
            await manager['updateClientCache']('server__with__underscores', client1);
            await manager['updateClientCache']('server@@with@@delimiters', client2);
        });

        it('should parse qualified names correctly using last delimiter', async () => {
            const parse = manager['parseQualifiedToolName'].bind(manager);

            // Wait for cache to populate
            await manager['updateClientCache']('server__with__underscores', client1);
            await manager['updateClientCache']('server@@with@@delimiters', client2);

            // shared_tool is the only conflicted tool - both servers have it, so it's qualified
            const result1 = parse('server__with__underscores--shared_tool');
            expect(result1).toEqual({
                serverName: 'server__with__underscores',
                toolName: 'shared_tool',
            });

            // Server name with delimiters gets sanitized, so we need to use the sanitized version
            // 'server@@with@@delimiters' becomes 'server__with__delimiters' when sanitized
            const result2 = parse('server__with__delimiters--shared_tool');
            expect(result2).toEqual({
                serverName: 'server@@with@@delimiters',
                toolName: 'shared_tool',
            });
        });

        it('should return null for non-qualified names', () => {
            const parse = manager['parseQualifiedToolName'].bind(manager);

            expect(parse('simple_tool')).toBeNull();
            expect(parse('tool__with__underscores')).toBeNull();
            expect(parse('')).toBeNull();
        });

        it('should return null for invalid qualified names', () => {
            const parse = manager['parseQualifiedToolName'].bind(manager);

            // Non-existent server
            expect(parse('nonexistent--tool')).toBeNull();

            // Non-existent tool on valid server
            expect(parse('server__with__underscores--nonexistent_tool')).toBeNull();
        });
    });

    describe('Tool Client Resolution', () => {
        beforeEach(async () => {
            manager.registerClient('server1', client1);
            manager.registerClient('server2', client2);
            await manager['updateClientCache']('server1', client1);
            await manager['updateClientCache']('server2', client2);
        });

        it('should resolve non-conflicted tools directly', () => {
            const client = manager.getToolClient('unique_tool_1');
            expect(client).toBe(client1);

            const client2Instance = manager.getToolClient('unique_tool_2');
            expect(client2Instance).toBe(client2);
        });

        it('should resolve qualified conflicted tools', () => {
            const client1Instance = manager.getToolClient('server1--shared_tool');
            expect(client1Instance).toBe(client1);

            const client2Instance = manager.getToolClient('server2--shared_tool');
            expect(client2Instance).toBe(client2);
        });

        it('should return undefined for non-existent tools', () => {
            expect(manager.getToolClient('nonexistent_tool')).toBeUndefined();
            expect(manager.getToolClient('server1--nonexistent_tool')).toBeUndefined();
            expect(manager.getToolClient('nonexistent_server--tool')).toBeUndefined();
        });

        it('should not resolve conflicted tools without qualification', () => {
            // 'shared_tool' exists on both servers, so unqualified lookup should fail
            expect(manager.getToolClient('shared_tool')).toBeUndefined();
        });
    });

    describe('Performance Optimizations and Caching', () => {
        it('should use cache for getAllTools (no network calls)', async () => {
            const getToolsSpy1 = vi.spyOn(client1, 'getTools');
            const getToolsSpy2 = vi.spyOn(client2, 'getTools');

            manager.registerClient('server1', client1);
            manager.registerClient('server2', client2);
            await manager['updateClientCache']('server1', client1);
            await manager['updateClientCache']('server2', client2);

            // Reset spy counts (updateClientCache calls getTools during initialization)
            getToolsSpy1.mockClear();
            getToolsSpy2.mockClear();

            // Call getAllTools multiple times - should use cache, NO network calls
            await manager.getAllTools();
            await manager.getAllTools();
            await manager.getAllTools();

            // ZERO calls to getTools - uses toolCache
            expect(getToolsSpy1).toHaveBeenCalledTimes(0);
            expect(getToolsSpy2).toHaveBeenCalledTimes(0);
        });

        it('should use O(1) lookup for qualified name parsing', async () => {
            manager.registerClient('server1', client1);
            manager.registerClient('server2', client2);
            await manager['updateClientCache']('server1', client1);
            await manager['updateClientCache']('server2', client2);

            // The parseQualifiedToolName method should use the sanitizedNameToServerMap
            // for O(1) lookup instead of iterating through all servers
            const result = manager['parseQualifiedToolName']('server1--shared_tool');
            expect(result).toEqual({
                serverName: 'server1',
                toolName: 'shared_tool',
            });

            // Verify the sanitized map contains the expected mappings
            const sanitizedMap = manager['sanitizedNameToServerMap'];
            expect(sanitizedMap.get('server1')).toBe('server1');
            expect(sanitizedMap.get('server2')).toBe('server2');
        });
    });

    describe('Tool Execution with Qualified Names', () => {
        beforeEach(async () => {
            manager.registerClient('server1', client1);
            manager.registerClient('server2', client2);
            await manager['updateClientCache']('server1', client1);
            await manager['updateClientCache']('server2', client2);
        });

        it('should execute non-conflicted tools directly', async () => {
            const result = await manager.executeTool('unique_tool_1', { param: 'value' });
            expect(result.result).toBe('Called unique_tool_1 with {"param":"value"}');
        });

        it('should execute qualified conflicted tools', async () => {
            const result1 = await manager.executeTool('server1--shared_tool', { param: 'test' });
            expect(result1.result).toBe('Called shared_tool with {"param":"test"}');

            const result2 = await manager.executeTool('server2--shared_tool', { param: 'test' });
            expect(result2.result).toBe('Called shared_tool with {"param":"test"}');
        });

        it('should throw error for non-existent tools', async () => {
            await expect(manager.executeTool('nonexistent_tool', {})).rejects.toThrow(
                'No MCP tool found: nonexistent_tool'
            );
        });

        it('should throw error for unqualified conflicted tools', async () => {
            await expect(manager.executeTool('shared_tool', {})).rejects.toThrow(
                'No MCP tool found: shared_tool'
            );
        });
    });

    describe('Edge Cases and Error Handling', () => {
        it('should handle tools with @@ in their names', async () => {
            const clientWithWeirdTool = new MockMCPClient({
                'tool@@with@@delimiters': {
                    description: 'Tool with @@ in name',
                    parameters: { type: 'object', properties: {} },
                },
            });

            manager.registerClient('normalserver', clientWithWeirdTool);
            await manager['updateClientCache']('normalserver', clientWithWeirdTool);

            const tools = await manager.getAllTools();
            expect(tools).toHaveProperty('tool@@with@@delimiters');

            // Should be able to execute it
            const result = await manager.executeTool('tool@@with@@delimiters', {});
            expect(result.result).toBe('Called tool@@with@@delimiters with {}');
        });

        it('should handle empty tool lists', async () => {
            const emptyClient = new MockMCPClient({});
            manager.registerClient('empty_server', emptyClient);
            await manager['updateClientCache']('empty_server', emptyClient);

            const tools = await manager.getAllTools();
            // Should not crash and should not add any tools
            expect(Object.keys(tools)).toHaveLength(0);
        });

        it('should handle server disconnection gracefully', async () => {
            manager.registerClient('server1', client1);
            await manager['updateClientCache']('server1', client1);

            let tools = await manager.getAllTools();
            expect(Object.keys(tools)).toHaveLength(3);

            await manager.removeClient('server1');

            // After removing the client, getAllTools should still call getTools() on disconnected clients
            // but since we removed the server from serverToolsMap and toolToClientMap, it should return empty
            tools = await manager.getAllTools();
            expect(Object.keys(tools)).toHaveLength(0);
        });
    });

    describe('Complete Cleanup', () => {
        it('should clear all caches on disconnectAll', async () => {
            manager.registerClient('server1', client1);
            manager.registerClient('server2', client2);
            await manager['updateClientCache']('server1', client1);
            await manager['updateClientCache']('server2', client2);

            // Verify caches are populated
            expect(manager['sanitizedNameToServerMap'].size).toBe(2);
            expect(manager['toolCache'].size).toBeGreaterThan(0);
            expect(manager['toolConflicts'].size).toBeGreaterThan(0);

            await manager.disconnectAll();

            // Verify all caches are cleared
            expect(manager['sanitizedNameToServerMap'].size).toBe(0);
            expect(manager['toolCache'].size).toBe(0);
            expect(manager['toolConflicts'].size).toBe(0);
            expect(manager['promptCache'].size).toBe(0);
            expect(manager['resourceCache'].size).toBe(0);
        });
    });
});

describe('MCPManager Prompt Caching', () => {
    let manager: MCPManager;
    let client1: MockMCPClient;
    let client2: MockMCPClient;
    let mockLogger: any;

    beforeEach(() => {
        mockLogger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            silly: vi.fn(),
            trackException: vi.fn(),
            createChild: vi.fn(function (this: any) {
                return this;
            }),
            destroy: vi.fn(),
        } as any;
        manager = new MCPManager(mockLogger);

        client1 = new MockMCPClient({}, ['prompt1', 'prompt2', 'shared_prompt'], []);

        client2 = new MockMCPClient({}, ['prompt3', 'shared_prompt'], []);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should cache prompts during updateClientCache', async () => {
        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        // Verify prompt cache is populated
        expect(manager['promptCache'].size).toBe(3);
        expect(manager['promptCache'].has('prompt1')).toBe(true);
        expect(manager['promptCache'].has('prompt2')).toBe(true);
        expect(manager['promptCache'].has('shared_prompt')).toBe(true);
    });

    it('should cache prompt metadata without calling getPrompt (performance optimization)', async () => {
        const listPromptsSpy = vi.spyOn(client1, 'listPrompts');
        const getPromptSpy = vi.spyOn(client1, 'getPrompt');

        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        // Verify listPrompts was called once during cache update
        expect(listPromptsSpy).toHaveBeenCalledTimes(1);

        // Critical: getPrompt should NEVER be called - metadata comes from listPrompts
        expect(getPromptSpy).toHaveBeenCalledTimes(0);

        // Verify metadata was cached correctly from listPrompts response
        const metadata = manager.getPromptMetadata('prompt1');
        expect(metadata).toBeDefined();
        expect(metadata?.name).toBe('prompt1');
        expect(metadata?.description).toBe('Prompt prompt1');

        // Still no getPrompt calls when retrieving metadata
        expect(getPromptSpy).toHaveBeenCalledTimes(0);
    });

    it('should use cache for listAllPrompts (no network calls)', async () => {
        const listPromptsSpy = vi.spyOn(client1, 'listPrompts');

        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        listPromptsSpy.mockClear();

        // Multiple calls should use cache
        const prompts1 = await manager.listAllPrompts();
        const prompts2 = await manager.listAllPrompts();

        expect(prompts1).toHaveLength(3);
        expect(prompts2).toHaveLength(3);
        expect(listPromptsSpy).toHaveBeenCalledTimes(0); // No network calls
    });

    it('should get prompt metadata from cache', async () => {
        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        const metadata = manager.getPromptMetadata('prompt1');
        expect(metadata).toBeDefined();
        expect(metadata?.name).toBe('prompt1');
        expect(metadata?.description).toBe('Prompt prompt1');
    });

    it('should return all prompt metadata from cache', async () => {
        manager.registerClient('server1', client1);
        manager.registerClient('server2', client2);
        await manager['updateClientCache']('server1', client1);
        await manager['updateClientCache']('server2', client2);

        const allMetadata = manager.getAllPromptMetadata();

        // Should have 4 unique prompts (shared_prompt from server2 overwrites server1)
        // Unlike tools, prompts don't have conflict detection - last writer wins
        expect(allMetadata.length).toBe(4);

        const promptNames = allMetadata.map((m) => m.promptName);
        expect(promptNames).toContain('prompt1');
        expect(promptNames).toContain('prompt2');
        expect(promptNames).toContain('prompt3');
        expect(promptNames).toContain('shared_prompt');

        // Check server attribution
        const prompt1Meta = allMetadata.find((m) => m.promptName === 'prompt1');
        expect(prompt1Meta?.serverName).toBe('server1');

        // shared_prompt should be from server2 (last writer wins)
        const sharedPromptMeta = allMetadata.find((m) => m.promptName === 'shared_prompt');
        expect(sharedPromptMeta?.serverName).toBe('server2');
    });

    it('should clear prompt cache on client removal', async () => {
        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        expect(manager['promptCache'].size).toBe(3);

        await manager.removeClient('server1');

        expect(manager['promptCache'].size).toBe(0);
    });
});

describe('MCPManager Resource Caching', () => {
    let manager: MCPManager;
    let client1: MockMCPClient;
    let client2: MockMCPClient;
    let mockLogger: any;

    beforeEach(() => {
        mockLogger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            silly: vi.fn(),
            trackException: vi.fn(),
            createChild: vi.fn(function (this: any) {
                return this;
            }),
            destroy: vi.fn(),
        } as any;
        manager = new MCPManager(mockLogger);

        client1 = new MockMCPClient(
            {},
            [],
            [
                { uri: 'file:///test1.txt', name: 'Test 1', mimeType: 'text/plain' },
                { uri: 'file:///test2.txt', name: 'Test 2', mimeType: 'text/plain' },
            ]
        );

        client2 = new MockMCPClient(
            {},
            [],
            [{ uri: 'file:///test3.txt', name: 'Test 3', mimeType: 'text/plain' }]
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should cache resources during updateClientCache', async () => {
        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        // Verify resource cache is populated with qualified keys
        expect(manager['resourceCache'].size).toBe(2);
        expect(manager.hasResource('mcp:server1:file:///test1.txt')).toBe(true);
        expect(manager.hasResource('mcp:server1:file:///test2.txt')).toBe(true);
    });

    it('should use cache for listAllResources (no network calls)', async () => {
        const listResourcesSpy = vi.spyOn(client1, 'listResources');

        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        listResourcesSpy.mockClear();

        // Multiple calls should use cache
        const resources1 = await manager.listAllResources();
        const resources2 = await manager.listAllResources();

        expect(resources1).toHaveLength(2);
        expect(resources2).toHaveLength(2);
        expect(listResourcesSpy).toHaveBeenCalledTimes(0); // No network calls
    });

    it('should get resource metadata from cache', async () => {
        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        const resource = manager.getResource('mcp:server1:file:///test1.txt');
        expect(resource).toBeDefined();
        expect(resource?.summary.uri).toBe('file:///test1.txt');
        expect(resource?.summary.name).toBe('Test 1');
        expect(resource?.serverName).toBe('server1');
    });

    it('should handle resources from multiple servers', async () => {
        manager.registerClient('server1', client1);
        manager.registerClient('server2', client2);
        await manager['updateClientCache']('server1', client1);
        await manager['updateClientCache']('server2', client2);

        const allResources = await manager.listAllResources();

        expect(allResources).toHaveLength(3);

        const serverNames = allResources.map((r) => r.serverName);
        expect(serverNames).toContain('server1');
        expect(serverNames).toContain('server2');
    });

    it('should clear resource cache on client removal', async () => {
        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        expect(manager['resourceCache'].size).toBe(2);

        await manager.removeClient('server1');

        expect(manager['resourceCache'].size).toBe(0);
        expect(manager.hasResource('mcp:server1:file:///test1.txt')).toBe(false);
    });

    it('should only clear resources for removed client', async () => {
        manager.registerClient('server1', client1);
        manager.registerClient('server2', client2);
        await manager['updateClientCache']('server1', client1);
        await manager['updateClientCache']('server2', client2);

        expect(manager['resourceCache'].size).toBe(3);

        await manager.removeClient('server1');

        // server2 resources should remain
        expect(manager['resourceCache'].size).toBe(1);
        expect(manager.hasResource('mcp:server2:file:///test3.txt')).toBe(true);
        expect(manager.hasResource('mcp:server1:file:///test1.txt')).toBe(false);
    });
});

describe('Tool notification handling', () => {
    let manager: MCPManager;
    let client1: MockMCPClient;
    let client2: MockMCPClient;
    let mockLogger: any;

    beforeEach(() => {
        mockLogger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            silly: vi.fn(),
            trackException: vi.fn(),
            createChild: vi.fn(function (this: any) {
                return this;
            }),
            destroy: vi.fn(),
        } as any;
        manager = new MCPManager(mockLogger);
        client1 = new MockMCPClient(
            {
                tool1: { name: 'tool1', description: 'Tool 1', parameters: {} },
                tool2: { name: 'tool2', description: 'Tool 2', parameters: {} },
            },
            [],
            []
        );

        client2 = new MockMCPClient(
            {
                tool3: { name: 'tool3', description: 'Tool 3', parameters: {} },
            },
            [],
            []
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should refresh tool cache when toolsListChanged notification received', async () => {
        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        // Verify initial cache
        expect(manager['toolCache'].size).toBe(2);
        expect(manager['toolCache'].has('tool1')).toBe(true);
        expect(manager['toolCache'].has('tool2')).toBe(true);

        // Update tools on the mock client
        client1.setTools({
            tool1: { name: 'tool1', description: 'Tool 1 Updated', parameters: {} },
            tool3: { name: 'tool3', description: 'Tool 3', parameters: {} },
        });

        // Trigger handleToolsListChanged
        await manager['handleToolsListChanged']('server1', client1);

        // Verify cache was refreshed
        expect(manager['toolCache'].size).toBe(2);
        expect(manager['toolCache'].has('tool1')).toBe(true);
        expect(manager['toolCache'].has('tool3')).toBe(true);
        expect(manager['toolCache'].has('tool2')).toBe(false); // tool2 removed
    });

    it('should emit mcp:tools-list-changed event with correct payload', async () => {
        const eventSpy = vi.fn();
        eventBus.on('mcp:tools-list-changed', eventSpy);

        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        // Update tools
        client1.setTools({
            tool1: { name: 'tool1', description: 'Tool 1 Updated', parameters: {} },
        });

        // Trigger notification handler
        await manager['handleToolsListChanged']('server1', client1);

        expect(eventSpy).toHaveBeenCalledWith({
            serverName: 'server1',
            tools: ['tool1'],
        });

        eventBus.off('mcp:tools-list-changed', eventSpy);
    });

    it('should detect conflicts when notification adds conflicting tool', async () => {
        // Setup: server1 has tool1
        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        // Setup: server2 has tool3
        manager.registerClient('server2', client2);
        await manager['updateClientCache']('server2', client2);

        expect(manager['toolConflicts'].has('tool1')).toBe(false);

        // Update server2 to also provide tool1 (conflict!)
        client2.setTools({
            tool1: { name: 'tool1', description: 'Tool 1 from server2', parameters: {} },
            tool3: { name: 'tool3', description: 'Tool 3', parameters: {} },
        });

        // Trigger notification handler
        await manager['handleToolsListChanged']('server2', client2);

        // Should detect conflict and use qualified names
        expect(manager['toolConflicts'].has('tool1')).toBe(true);
        expect(manager['toolCache'].has('tool1')).toBe(false); // Simple name removed
        expect(manager['toolCache'].has('server1--tool1')).toBe(true);
        expect(manager['toolCache'].has('server2--tool1')).toBe(true);
    });

    it('should resolve conflicts when notification removes conflicting tool', async () => {
        // Setup: Both servers provide tool1 (conflict exists)
        client1.setTools({
            tool1: { name: 'tool1', description: 'Tool 1 from server1', parameters: {} },
        });
        client2.setTools({
            tool1: { name: 'tool1', description: 'Tool 1 from server2', parameters: {} },
        });

        manager.registerClient('server1', client1);
        manager.registerClient('server2', client2);
        await manager['updateClientCache']('server1', client1);
        await manager['updateClientCache']('server2', client2);

        // Verify conflict detected
        expect(manager['toolConflicts'].has('tool1')).toBe(true);
        expect(manager['toolCache'].has('server1--tool1')).toBe(true);
        expect(manager['toolCache'].has('server2--tool1')).toBe(true);

        // Update server2 to no longer provide tool1
        client2.setTools({
            tool3: { name: 'tool3', description: 'Tool 3', parameters: {} },
        });

        // Trigger notification handler
        await manager['handleToolsListChanged']('server2', client2);

        // Conflict should be resolved, tool1 restored to simple name
        expect(manager['toolConflicts'].has('tool1')).toBe(false);
        expect(manager['toolCache'].has('tool1')).toBe(true);
        expect(manager['toolCache'].has('server1--tool1')).toBe(false);
        expect(manager['toolCache'].has('server2--tool1')).toBe(false);

        // Verify it points to server1
        const entry = manager['toolCache'].get('tool1');
        expect(entry?.serverName).toBe('server1');
    });

    it('should handle empty tool list notification', async () => {
        manager.registerClient('server1', client1);
        await manager['updateClientCache']('server1', client1);

        expect(manager['toolCache'].size).toBe(2);

        // Update to empty tools
        client1.setTools({});

        await manager['handleToolsListChanged']('server1', client1);

        // All server1 tools should be removed
        const remainingTools = Array.from(manager['toolCache'].values());
        expect(remainingTools.every((entry) => entry.serverName !== 'server1')).toBe(true);
    });

    it('should not affect other servers tools during notification', async () => {
        manager.registerClient('server1', client1);
        manager.registerClient('server2', client2);
        await manager['updateClientCache']('server1', client1);
        await manager['updateClientCache']('server2', client2);

        expect(manager['toolCache'].size).toBe(3);

        // Update server1 tools
        client1.setTools({ tool1: { name: 'tool1', description: 'Tool 1 Only', parameters: {} } });

        await manager['handleToolsListChanged']('server1', client1);

        // server2's tool3 should still be there
        expect(manager['toolCache'].has('tool3')).toBe(true);
        const tool3Entry = manager['toolCache'].get('tool3');
        expect(tool3Entry?.serverName).toBe('server2');
    });
});
