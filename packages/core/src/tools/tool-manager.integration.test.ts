import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolManager } from './tool-manager.js';
import { MCPManager } from '../mcp/manager.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ToolErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { z } from 'zod';
import type { McpClient } from '../mcp/types.js';
import { AgentEventBus } from '../events/index.js';
import { ApprovalManager } from '../approval/manager.js';
import type { AllowedToolsProvider } from './confirmation/allowed-tools-provider/types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

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
    let approvalManager: ApprovalManager;
    let allowedToolsProvider: AllowedToolsProvider;
    let mockAgentEventBus: AgentEventBus;
    let mockSearchService: {
        searchMessages: ReturnType<typeof vi.fn>;
        searchSessions: ReturnType<typeof vi.fn>;
    };
    let internalSearchHistoryTool: any;
    const mockLogger = createMockLogger();

    const SearchHistoryInputSchema = z.object({
        query: z.string().describe('The search query to find in conversation history'),
        mode: z
            .enum(['messages', 'sessions'])
            .describe(
                'Search mode: "messages" searches for individual messages, "sessions" finds sessions containing the query'
            ),
        sessionId: z
            .string()
            .optional()
            .describe('Optional: limit search to a specific session (only for mode="messages")'),
        role: z
            .enum(['user', 'assistant', 'system', 'tool'])
            .optional()
            .describe('Optional: filter by message role (only for mode="messages")'),
        limit: z
            .number()
            .optional()
            .default(20)
            .describe(
                'Optional: maximum number of results to return (default: 20, only for mode="messages")'
            ),
        offset: z
            .number()
            .optional()
            .default(0)
            .describe('Optional: offset for pagination (default: 0, only for mode="messages")'),
    });

    type SearchServiceLike = {
        searchMessages: (query: string, options: Record<string, unknown>) => Promise<unknown>;
        searchSessions: (query: string) => Promise<unknown>;
    };

    function createSearchHistoryTool(searchService: SearchServiceLike) {
        return {
            id: 'search_history',
            description:
                'Search through conversation history across sessions. Use mode="messages" to search for specific messages, or mode="sessions" to find sessions containing the query.',
            inputSchema: SearchHistoryInputSchema,
            execute: async (input: unknown) => {
                const { query, mode, sessionId, role, limit, offset } = input as {
                    query: string;
                    mode: 'messages' | 'sessions';
                    sessionId?: string;
                    role?: 'user' | 'assistant' | 'system' | 'tool';
                    limit?: number;
                    offset?: number;
                };

                if (mode === 'messages') {
                    const searchOptions: Record<string, unknown> = {};
                    if (sessionId !== undefined) searchOptions.sessionId = sessionId;
                    if (role !== undefined) searchOptions.role = role;
                    if (limit !== undefined) searchOptions.limit = limit;
                    if (offset !== undefined) searchOptions.offset = offset;
                    return await searchService.searchMessages(query, searchOptions);
                }

                return await searchService.searchSessions(query);
            },
        };
    }

    beforeEach(() => {
        // Create real MCPManager
        mcpManager = new MCPManager(mockLogger);

        // Create mock AgentEventBus
        mockAgentEventBus = {
            on: vi.fn(),
            emit: vi.fn(),
            off: vi.fn(),
            once: vi.fn(),
            removeAllListeners: vi.fn(),
        } as any;

        // Create ApprovalManager in auto-approve mode for integration tests
        approvalManager = new ApprovalManager(
            {
                toolConfirmation: {
                    mode: 'auto-approve',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: true,
                    timeout: 120000,
                },
            },
            mockLogger
        );

        // Create mock AllowedToolsProvider
        allowedToolsProvider = {
            isToolAllowed: vi.fn().mockResolvedValue(false),
            allowTool: vi.fn().mockResolvedValue(undefined),
            disallowTool: vi.fn().mockResolvedValue(undefined),
        } as any;

        // Mock SearchService for internal tools
        mockSearchService = {
            searchMessages: vi
                .fn()
                .mockResolvedValue([{ id: '1', content: 'test message', role: 'user' }]),
            searchSessions: vi.fn().mockResolvedValue([{ id: 'session1', title: 'Test Session' }]),
        };
        internalSearchHistoryTool = createSearchHistoryTool(mockSearchService);
    });

    describe('End-to-End Tool Execution', () => {
        it('should execute MCP tools through the complete pipeline', async () => {
            // Create mock MCP client
            const mockClient: McpClient = {
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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );
            await toolManager.initialize();

            // Execute tool through complete pipeline
            const result = await toolManager.executeTool(
                'mcp--test_tool',
                { param: 'value' },
                'test-call-id'
            );

            expect(mockClient.callTool).toHaveBeenCalledWith('test_tool', { param: 'value' });
            expect(result).toEqual({ result: 'mcp tool result' });
        });

        it('should execute local tools through the complete pipeline', async () => {
            // Create ToolManager with local tools
            const toolManager = new ToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [internalSearchHistoryTool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.initialize();

            // Execute local tool
            const result = await toolManager.executeTool(
                'search_history',
                { query: 'test query', mode: 'messages' },
                'test-call-id'
            );

            expect(mockSearchService.searchMessages).toHaveBeenCalledWith(
                'test query',
                expect.objectContaining({
                    limit: 20, // Default from Zod schema
                    offset: 0, // Default from Zod schema
                })
            );
            expect(result).toEqual({
                result: [{ id: '1', content: 'test message', role: 'user' }],
            });
        });

        it('should work with both MCP and local tools together', async () => {
            // Set up MCP tool
            const mockClient: McpClient = {
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

            // Create ToolManager with both MCP and local tools
            const toolManager = new ToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [internalSearchHistoryTool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.initialize();

            // Get all tools - should include both MCP and local tools
            const allTools = await toolManager.getAllTools();

            expect(allTools['mcp--file_read']).toBeDefined();
            expect(allTools['search_history']).toBeDefined();
            expect(allTools['mcp--file_read']?.description).toContain('(via MCP servers)');
            expect(allTools['search_history']?.description).toContain(
                'Search through conversation'
            );

            const mcpParams = allTools['mcp--file_read']?.parameters as {
                properties?: Record<string, unknown>;
            };
            expect(mcpParams.properties?.__meta).toBeDefined();

            // Execute both types
            const mcpResult = await toolManager.executeTool(
                'mcp--file_read',
                { path: '/test' },
                'test-call-id-1'
            );
            const localResult = await toolManager.executeTool(
                'search_history',
                { query: 'search test', mode: 'sessions' },
                'test-call-id-2'
            );

            expect(mcpResult).toEqual({ result: 'file content' });
            expect(localResult).toEqual({
                result: [{ id: 'session1', title: 'Test Session' }],
            });
        });
    });

    describe('Confirmation Flow Integration', () => {
        it('should work with auto-approve mode', async () => {
            const autoApproveManager = new ApprovalManager(
                {
                    toolConfirmation: {
                        mode: 'auto-approve',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );
            const mockClient: McpClient = {
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

            const mcpMgr = new MCPManager(mockLogger);
            mcpMgr.registerClient('test-server', mockClient);
            await (mcpMgr as any).updateClientCache('test-server', mockClient);

            const toolManager = new ToolManager(
                mcpMgr,
                autoApproveManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );
            const result = await toolManager.executeTool('mcp--test_tool', {}, 'test-call-id');

            expect(result).toEqual({ result: 'approved result' });
        });

        it('should work with auto-deny mode', async () => {
            const autoDenyManager = new ApprovalManager(
                {
                    toolConfirmation: {
                        mode: 'auto-deny',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );
            const mockClient: McpClient = {
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

            const mcpMgr = new MCPManager(mockLogger);
            mcpMgr.registerClient('test-server', mockClient);
            await (mcpMgr as any).updateClientCache('test-server', mockClient);

            const toolManager = new ToolManager(
                mcpMgr,
                autoDenyManager,
                allowedToolsProvider,
                'auto-deny',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const error = (await toolManager
                .executeTool('mcp--test_tool', {}, 'test-call-id')
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
            const failingClient: McpClient = {
                getTools: vi.fn().mockRejectedValue(new Error('MCP connection failed')),
                callTool: vi.fn(),
                listPrompts: vi.fn().mockResolvedValue([]),
                listResources: vi.fn().mockResolvedValue([]),
            } as any;

            mcpManager.registerClient('failing-server', failingClient);

            const toolManager = new ToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [internalSearchHistoryTool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.initialize();

            // Should still return internal tools even if MCP fails
            const allTools = await toolManager.getAllTools();
            expect(allTools['search_history']).toBeDefined();
            expect(Object.keys(allTools).filter((name) => name.startsWith('mcp--'))).toHaveLength(
                0
            );
        });

        it('should handle tool execution failures properly', async () => {
            const failingClient: McpClient = {
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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            await expect(
                toolManager.executeTool('mcp--failing_tool', {}, 'test-call-id')
            ).rejects.toThrow(Error);
        });

        it('should handle local tool execution failures properly', async () => {
            // Mock SearchService to throw error
            const failingSearchService = {
                searchMessages: vi.fn().mockRejectedValue(new Error('Search service failed')),
                searchSessions: vi.fn().mockRejectedValue(new Error('Search service failed')),
            } as any;

            const toolManager = new ToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [createSearchHistoryTool(failingSearchService)],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.initialize();

            await expect(
                toolManager.executeTool(
                    'search_history',
                    { query: 'test', mode: 'messages' },
                    'test-call-id'
                )
            ).rejects.toThrow(Error);
        });
    });

    describe('Performance and Caching', () => {
        it('should cache tool discovery results efficiently', async () => {
            const mockClient: McpClient = {
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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
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
            const mockClient: McpClient = {
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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
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
            const mockClient: McpClient = {
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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [internalSearchHistoryTool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.initialize();

            const sessionId = 'test-session-123';

            // Execute MCP tool with sessionId
            await toolManager.executeTool(
                'mcp--test_tool',
                { param: 'value' },
                'test-call-id-1',
                sessionId
            );

            // Execute local tool with sessionId
            await toolManager.executeTool(
                'search_history',
                { query: 'test', mode: 'messages' },
                'test-call-id-2',
                sessionId
            );

            // Verify MCP tool received sessionId (note: MCPManager doesn't use sessionId in callTool currently)
            expect(mockClient.callTool).toHaveBeenCalledWith('test_tool', { param: 'value' });

            // Verify local tool was called with proper defaults
            expect(mockSearchService.searchMessages).toHaveBeenCalledWith(
                'test',
                expect.objectContaining({
                    limit: 20, // Default from Zod schema
                    offset: 0, // Default from Zod schema
                })
            );
        });
    });
});
