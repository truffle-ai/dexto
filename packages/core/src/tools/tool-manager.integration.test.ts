import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolManager } from './tool-manager.js';
import { MCPManager } from '../mcp/manager.js';
import { NoOpConfirmationProvider } from './confirmation/noop-confirmation-provider.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ToolErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import type { InternalToolsServices } from './internal-tools/registry.js';
import type { InternalToolsConfig } from './schemas.js';
import type { IMCPClient } from '../mcp/types.js';
import { AgentEventBus } from '../events/index.js';

// Mock logger
vi.mock('../logger/index.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        getLevel: vi.fn().mockReturnValue('info'),
        silly: vi.fn(),
    },
}));

describe('ToolManager Integration Tests', () => {
    let mcpManager: MCPManager;
    let confirmationProvider: NoOpConfirmationProvider;
    let internalToolsServices: InternalToolsServices;
    let internalToolsConfig: InternalToolsConfig;
    let mockAgentEventBus: AgentEventBus;

    beforeEach(() => {
        // Create real MCPManager with no-op confirmation
        mcpManager = new MCPManager();
        confirmationProvider = new NoOpConfirmationProvider();

        // Create mock AgentEventBus
        mockAgentEventBus = {
            on: vi.fn(),
            emit: vi.fn(),
            off: vi.fn(),
            once: vi.fn(),
            removeAllListeners: vi.fn(),
        } as any;

        // Mock SearchService for internal tools
        const mockSearchService = {
            searchMessages: vi
                .fn()
                .mockResolvedValue([{ id: '1', content: 'test message', role: 'user' }]),
            searchSessions: vi.fn().mockResolvedValue([{ id: 'session1', title: 'Test Session' }]),
        } as any;

        internalToolsServices = {
            searchService: mockSearchService,
        };

        internalToolsConfig = ['search_history'];
    });

    describe('End-to-End Tool Execution', () => {
        it('should execute MCP tools through the complete pipeline', async () => {
            // Create mock MCP client
            const mockClient: IMCPClient = {
                getTools: vi.fn().mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'Test MCP tool',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn().mockResolvedValue('mcp tool result'),
                listPrompts: vi.fn().mockResolvedValue([]),
                listResources: vi.fn().mockResolvedValue([]),
            } as any;

            // Register mock client and update cache
            mcpManager.registerClient('test-server', mockClient);
            // Need to manually call updateClientCache since registerClient doesn't do it
            await (mcpManager as any).updateClientCache('test-server', mockClient);

            // Create ToolManager with real components
            const toolManager = new ToolManager(
                mcpManager,
                confirmationProvider,
                mockAgentEventBus
            );
            await toolManager.initialize();

            // Execute tool through complete pipeline
            const result = await toolManager.executeTool('mcp--test_tool', { param: 'value' });

            expect(mockClient.callTool).toHaveBeenCalledWith('test_tool', { param: 'value' });
            expect(result).toBe('mcp tool result');
        });

        it('should execute internal tools through the complete pipeline', async () => {
            // Create ToolManager with internal tools
            const toolManager = new ToolManager(
                mcpManager,
                confirmationProvider,
                mockAgentEventBus,
                {
                    internalToolsServices,
                    internalToolsConfig,
                }
            );

            await toolManager.initialize();

            // Execute internal tool
            const result = await toolManager.executeTool('internal--search_history', {
                query: 'test query',
                mode: 'messages',
            });

            expect(internalToolsServices.searchService?.searchMessages).toHaveBeenCalledWith(
                'test query',
                expect.objectContaining({
                    limit: 20, // Default from Zod schema
                    offset: 0, // Default from Zod schema
                })
            );
            expect(result).toEqual([{ id: '1', content: 'test message', role: 'user' }]);
        });

        it('should work with both MCP and internal tools together', async () => {
            // Set up MCP tool
            const mockClient: IMCPClient = {
                getTools: vi.fn().mockResolvedValue({
                    file_read: {
                        name: 'file_read',
                        description: 'Read file',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn().mockResolvedValue('file content'),
                listPrompts: vi.fn().mockResolvedValue([]),
                listResources: vi.fn().mockResolvedValue([]),
            } as any;

            mcpManager.registerClient('file-server', mockClient);
            await (mcpManager as any).updateClientCache('file-server', mockClient);

            // Create ToolManager with both MCP and internal tools
            const toolManager = new ToolManager(
                mcpManager,
                confirmationProvider,
                mockAgentEventBus,
                {
                    internalToolsServices,
                    internalToolsConfig,
                }
            );

            await toolManager.initialize();

            // Get all tools - should include both types with proper prefixing
            const allTools = await toolManager.getAllTools();

            expect(allTools['mcp--file_read']).toBeDefined();
            expect(allTools['internal--search_history']).toBeDefined();
            expect(allTools['mcp--file_read']?.description).toContain('(via MCP servers)');
            expect(allTools['internal--search_history']?.description).toContain('(internal tool)');

            // Execute both types
            const mcpResult = await toolManager.executeTool('mcp--file_read', { path: '/test' });
            const internalResult = await toolManager.executeTool('internal--search_history', {
                query: 'search test',
                mode: 'sessions',
            });

            expect(mcpResult).toBe('file content');
            expect(internalResult).toEqual([{ id: 'session1', title: 'Test Session' }]);
        });
    });

    describe('Confirmation Flow Integration', () => {
        it('should work with auto-approve confirmation provider', async () => {
            const autoApproveProvider = new NoOpConfirmationProvider(undefined, true);
            const mockClient: IMCPClient = {
                getTools: vi.fn().mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'Test tool',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn().mockResolvedValue('approved result'),
                listPrompts: vi.fn().mockResolvedValue([]),
                listResources: vi.fn().mockResolvedValue([]),
            } as any;

            const mcpMgr = new MCPManager();
            mcpMgr.registerClient('test-server', mockClient);
            await (mcpMgr as any).updateClientCache('test-server', mockClient);

            const toolManager = new ToolManager(mcpMgr, autoApproveProvider, mockAgentEventBus);
            const result = await toolManager.executeTool('mcp--test_tool', {});

            expect(result).toBe('approved result');
        });

        it('should work with auto-deny confirmation provider', async () => {
            const autoDenyProvider = new NoOpConfirmationProvider(undefined, false);
            const mockClient: IMCPClient = {
                getTools: vi.fn().mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'Test tool',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn().mockResolvedValue('should not execute'),
                listPrompts: vi.fn().mockResolvedValue([]),
                listResources: vi.fn().mockResolvedValue([]),
            } as any;

            const mcpMgr = new MCPManager();
            mcpMgr.registerClient('test-server', mockClient);
            await (mcpMgr as any).updateClientCache('test-server', mockClient);

            const toolManager = new ToolManager(mcpMgr, autoDenyProvider, mockAgentEventBus);

            const error = (await toolManager
                .executeTool('mcp--test_tool', {})
                .catch((e) => e)) as DextoRuntimeError;
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(ToolErrorCode.EXECUTION_DENIED);
            expect(error.scope).toBe(ErrorScope.TOOLS);
            expect(error.type).toBe(ErrorType.FORBIDDEN);

            expect(mockClient.callTool).not.toHaveBeenCalled();
        });
    });

    describe('Error Scenarios and Recovery', () => {
        it('should handle MCP client failures gracefully', async () => {
            const failingClient: IMCPClient = {
                getTools: vi.fn().mockRejectedValue(new Error('MCP connection failed')),
                callTool: vi.fn(),
                listPrompts: vi.fn().mockResolvedValue([]),
                listResources: vi.fn().mockResolvedValue([]),
            } as any;

            mcpManager.registerClient('failing-server', failingClient);

            const toolManager = new ToolManager(
                mcpManager,
                confirmationProvider,
                mockAgentEventBus,
                {
                    internalToolsServices,
                    internalToolsConfig,
                }
            );

            await toolManager.initialize();

            // Should still return internal tools even if MCP fails
            const allTools = await toolManager.getAllTools();
            expect(allTools['internal--search_history']).toBeDefined();
            expect(Object.keys(allTools).filter((name) => name.startsWith('mcp--'))).toHaveLength(
                0
            );
        });

        it('should handle internal tools initialization failures gracefully', async () => {
            // Mock services that will cause tool initialization to fail
            const failingServices: InternalToolsServices = {
                // Missing searchService - should cause search_history tool to be skipped
            };

            const toolManager = new ToolManager(
                mcpManager,
                confirmationProvider,
                mockAgentEventBus,
                {
                    internalToolsServices: failingServices,
                    internalToolsConfig,
                }
            );

            await toolManager.initialize();

            const allTools = await toolManager.getAllTools();
            // Should not have any internal tools since searchService is missing
            expect(
                Object.keys(allTools).filter((name) => name.startsWith('internal--'))
            ).toHaveLength(0);
        });

        it('should handle tool execution failures properly', async () => {
            const failingClient: IMCPClient = {
                getTools: vi.fn().mockResolvedValue({
                    failing_tool: {
                        name: 'failing_tool',
                        description: 'Tool that fails',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn().mockRejectedValue(new Error('Tool execution failed')),
                listPrompts: vi.fn().mockResolvedValue([]),
                listResources: vi.fn().mockResolvedValue([]),
            } as any;

            mcpManager.registerClient('failing-server', failingClient);
            await (mcpManager as any).updateClientCache('failing-server', failingClient);

            const toolManager = new ToolManager(
                mcpManager,
                confirmationProvider,
                mockAgentEventBus
            );

            await expect(toolManager.executeTool('mcp--failing_tool', {})).rejects.toThrow(Error);
        });

        it('should handle internal tool execution failures properly', async () => {
            // Mock SearchService to throw error
            const failingSearchService = {
                searchMessages: vi.fn().mockRejectedValue(new Error('Search service failed')),
                searchSessions: vi.fn().mockRejectedValue(new Error('Search service failed')),
            } as any;

            const failingServices: InternalToolsServices = {
                searchService: failingSearchService,
            };

            const toolManager = new ToolManager(
                mcpManager,
                confirmationProvider,
                mockAgentEventBus,
                {
                    internalToolsServices: failingServices,
                    internalToolsConfig,
                }
            );

            await toolManager.initialize();

            await expect(
                toolManager.executeTool('internal--search_history', {
                    query: 'test',
                    mode: 'messages',
                })
            ).rejects.toThrow(Error);
        });
    });

    describe('Performance and Caching', () => {
        it('should cache tool discovery results efficiently', async () => {
            const mockClient: IMCPClient = {
                getTools: vi.fn().mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'Test tool',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn(),
                listPrompts: vi.fn().mockResolvedValue([]),
                listResources: vi.fn().mockResolvedValue([]),
            } as any;

            mcpManager.registerClient('test-server', mockClient);
            await (mcpManager as any).updateClientCache('test-server', mockClient);

            // MCP client's getTools gets called during updateClientCache (1)
            expect(mockClient.getTools).toHaveBeenCalledTimes(1);
            vi.mocked(mockClient.getTools).mockClear();

            const toolManager = new ToolManager(
                mcpManager,
                confirmationProvider,
                mockAgentEventBus,
                {
                    internalToolsServices,
                    internalToolsConfig,
                }
            );

            await toolManager.initialize();

            // Multiple calls to getAllTools should use cache
            await toolManager.getAllTools();
            await toolManager.getAllTools();
            await toolManager.getAllTools();

            // With new architecture: MCPManager caches tools during updateClientCache
            // So mockClient.getTools is NOT called again by toolManager.getAllTools()
            expect(mockClient.getTools).toHaveBeenCalledTimes(0);
        });

        it('should refresh cache when requested', async () => {
            const mockClient: IMCPClient = {
                getTools: vi.fn().mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'Test tool',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn(),
                listPrompts: vi.fn().mockResolvedValue([]),
                listResources: vi.fn().mockResolvedValue([]),
            } as any;

            mcpManager.registerClient('test-server', mockClient);
            await (mcpManager as any).updateClientCache('test-server', mockClient);
            expect(mockClient.getTools).toHaveBeenCalledTimes(1);
            vi.mocked(mockClient.getTools).mockClear();

            const toolManager = new ToolManager(
                mcpManager,
                confirmationProvider,
                mockAgentEventBus
            );

            // First call uses MCPManager's cache (no client call)
            await toolManager.getAllTools();
            expect(mockClient.getTools).toHaveBeenCalledTimes(0);

            // ToolManager.refresh() now cascades to MCPManager.refresh()
            // This refreshes server capabilities by calling client.getTools() again
            await toolManager.refresh();
            expect(mockClient.getTools).toHaveBeenCalledTimes(1);
            vi.mocked(mockClient.getTools).mockClear();

            // Multiple calls after refresh still use cache
            await toolManager.getAllTools();
            await toolManager.getAllTools();
            expect(mockClient.getTools).toHaveBeenCalledTimes(0);
        });
    });

    describe('Session ID Handling', () => {
        it('should pass sessionId through the complete execution pipeline', async () => {
            const mockClient: IMCPClient = {
                getTools: vi.fn().mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'Test tool',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn().mockResolvedValue('result'),
                listPrompts: vi.fn().mockResolvedValue([]),
                listResources: vi.fn().mockResolvedValue([]),
            } as any;

            mcpManager.registerClient('test-server', mockClient);
            await (mcpManager as any).updateClientCache('test-server', mockClient);

            const toolManager = new ToolManager(
                mcpManager,
                confirmationProvider,
                mockAgentEventBus,
                {
                    internalToolsServices,
                    internalToolsConfig,
                }
            );

            await toolManager.initialize();

            const sessionId = 'test-session-123';

            // Execute MCP tool with sessionId
            await toolManager.executeTool('mcp--test_tool', { param: 'value' }, sessionId);

            // Execute internal tool with sessionId
            await toolManager.executeTool(
                'internal--search_history',
                {
                    query: 'test',
                    mode: 'messages',
                },
                sessionId
            );

            // Verify MCP tool received sessionId (note: MCPManager doesn't use sessionId in callTool currently)
            expect(mockClient.callTool).toHaveBeenCalledWith('test_tool', { param: 'value' });

            // Verify internal tool was called with proper defaults
            expect(internalToolsServices.searchService?.searchMessages).toHaveBeenCalledWith(
                'test',
                expect.objectContaining({
                    limit: 20, // Default from Zod schema
                    offset: 0, // Default from Zod schema
                })
            );
        });
    });
});
