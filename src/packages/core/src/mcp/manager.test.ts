import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPManager } from './manager.js';
import { IMCPClient } from './types.js';
import { NoOpConfirmationProvider } from '../tools/confirmation/noop-confirmation-provider.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { MCPErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';

// Mock client for testing
class MockMCPClient implements IMCPClient {
    private tools: Record<string, any> = {};
    private prompts: string[] = [];
    private resources: string[] = [];

    constructor(tools: Record<string, any> = {}, prompts: string[] = [], resources: string[] = []) {
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

    async getTools(): Promise<Record<string, any>> {
        return this.tools;
    }

    async callTool(name: string, args: any): Promise<any> {
        if (!this.tools[name]) {
            throw new Error(`Tool ${name} not found`);
        }
        return { result: `Called ${name} with ${JSON.stringify(args)}` };
    }

    async listPrompts(): Promise<string[]> {
        return this.prompts;
    }

    async getPrompt(name: string, _args?: any): Promise<any> {
        if (!this.prompts.includes(name)) {
            throw new Error(`Prompt ${name} not found`);
        }
        return { content: `Prompt ${name}` };
    }

    async listResources(): Promise<string[]> {
        return this.resources;
    }

    async readResource(uri: string): Promise<any> {
        if (!this.resources.includes(uri)) {
            throw new Error(`Resource ${uri} not found`);
        }
        return { content: `Resource ${uri}` };
    }
}

describe('MCPManager Tool Conflict Resolution', () => {
    let manager: MCPManager;
    let client1: MockMCPClient;
    let client2: MockMCPClient;
    let client3: MockMCPClient;

    beforeEach(() => {
        manager = new MCPManager(new NoOpConfirmationProvider());

        // Create clients with overlapping and unique tools
        client1 = new MockMCPClient({
            unique_tool_1: { description: 'Tool unique to server 1' },
            shared_tool: { description: 'Tool shared between servers' },
            tool__with__underscores: { description: 'Tool with underscores in name' },
        });

        client2 = new MockMCPClient({
            unique_tool_2: { description: 'Tool unique to server 2' },
            shared_tool: { description: 'Different implementation of shared tool' },
            another_shared: { description: 'Another shared tool' },
        });

        client3 = new MockMCPClient({
            unique_tool_3: { description: 'Tool unique to server 3' },
            another_shared: { description: 'Third implementation of another_shared' },
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

        it('should parse qualified names correctly using last delimiter', () => {
            const parse = manager['parseQualifiedToolName'].bind(manager);

            // Normal case
            const result1 = parse('server__with__underscores--shared_tool');
            expect(result1).toEqual({
                serverName: 'server__with__underscores',
                toolName: 'shared_tool',
            });

            // Tool name with underscores
            const result2 = parse('server__with__underscores--tool__with__underscores');
            expect(result2).toEqual({
                serverName: 'server__with__underscores',
                toolName: 'tool__with__underscores',
            });

            // Server name with delimiters gets sanitized, so we need to use the sanitized version
            // 'server@@with@@delimiters' becomes 'server__with__delimiters' when sanitized
            const result3 = parse('server__with__delimiters--shared_tool');
            expect(result3).toEqual({
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

    describe('Performance Optimizations', () => {
        it('should cache client tool calls in getAllTools', async () => {
            const getToolsSpy1 = vi.spyOn(client1, 'getTools');
            const getToolsSpy2 = vi.spyOn(client2, 'getTools');

            manager.registerClient('server1', client1);
            manager.registerClient('server2', client2);
            await manager['updateClientCache']('server1', client1);
            await manager['updateClientCache']('server2', client2);

            // Reset spy counts (updateClientCache calls getTools)
            getToolsSpy1.mockClear();
            getToolsSpy2.mockClear();

            // Call getAllTools - should call getTools once per client
            await manager.getAllTools();

            expect(getToolsSpy1).toHaveBeenCalledTimes(1);
            expect(getToolsSpy2).toHaveBeenCalledTimes(1);

            // Reset and call again - should use cache within the same call
            getToolsSpy1.mockClear();
            getToolsSpy2.mockClear();

            await manager.getAllTools();

            // Should call each client's getTools exactly once per getAllTools call
            expect(getToolsSpy1).toHaveBeenCalledTimes(1);
            expect(getToolsSpy2).toHaveBeenCalledTimes(1);
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
                'tool@@with@@delimiters': { description: 'Tool with @@ in name' },
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
        it('should clear all maps on disconnectAll', async () => {
            manager.registerClient('server1', client1);
            manager.registerClient('server2', client2);
            await manager['updateClientCache']('server1', client1);
            await manager['updateClientCache']('server2', client2);

            // Verify maps are populated
            expect(manager['sanitizedNameToServerMap'].size).toBe(2);
            expect(manager['toolToClientMap'].size).toBeGreaterThan(0);
            expect(manager['serverToolsMap'].size).toBe(2);

            await manager.disconnectAll();

            // Verify all maps are cleared
            expect(manager['sanitizedNameToServerMap'].size).toBe(0);
            expect(manager['toolToClientMap'].size).toBe(0);
            expect(manager['serverToolsMap'].size).toBe(0);
            expect(manager['toolConflicts'].size).toBe(0);
        });
    });
});
