import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolManager } from './tool-manager.js';
import { connectionFromClient, TestMCPConnections } from '../test-utils/mcp-connections.js';
import { MCPManager } from '../mcp/manager.js';
import { z } from 'zod';
import { AgentEventBus } from '../events/index.js';
import { ApprovalManager } from '../approval/manager.js';
import { ToolApprovalMetadataSchema } from '../approval/schemas.js';
import { ApprovalType } from '../approval/types.js';
import type { AllowedToolsProvider } from './approval/allowed-tools-provider/types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import {
    createInMemorySessionApprovalStore,
    createInMemorySessionToolPreferencesStore,
} from '../test-utils/session-state-stores.js';
import { InMemoryDextoStores } from '../storage/index.js';

type ToolManagerFactoryArgs =
    ConstructorParameters<typeof ToolManager> extends [
        infer McpManager,
        infer ApprovalManager,
        infer AllowedToolsProvider,
        infer ApprovalMode,
        infer AgentEventBus,
        infer ToolPolicies,
        infer Tools,
        infer Logger,
        infer _SessionToolPreferencesStore,
        infer _ToolExecutionStore,
    ]
        ? [
              McpManager,
              ApprovalManager,
              AllowedToolsProvider,
              ApprovalMode,
              AgentEventBus,
              ToolPolicies,
              Tools,
              Logger,
          ]
        : never;

function createToolManager(...args: ToolManagerFactoryArgs): ToolManager {
    const logger = args[7];
    return new ToolManager(
        ...args,
        createInMemorySessionToolPreferencesStore(logger),
        new InMemoryDextoStores().getStore('toolExecutions')
    );
}

function createApprovalManager(
    config: ConstructorParameters<typeof ApprovalManager>[0],
    logger: ConstructorParameters<typeof ApprovalManager>[1]
): ApprovalManager {
    return new ApprovalManager(config, logger, createInMemorySessionApprovalStore(logger));
}

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
    let mcpConnections: TestMCPConnections;
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

    beforeEach(async () => {
        mockAgentEventBus = new AgentEventBus();

        // Create real MCPManager
        mcpConnections = new TestMCPConnections();
        mcpManager = new MCPManager(mcpConnections, mockLogger, mockAgentEventBus);
        await mcpManager.initialize();

        // Create ApprovalManager in auto-approve mode for integration tests
        approvalManager = createApprovalManager(
            {
                permissions: {
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
            const mockClient = {
                getTools: vi.fn().mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'Test MCP tool',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn().mockResolvedValue('mcp tool result'),
            };

            mcpConnections.set(connectionFromClient('test-server', mockClient));
            await mcpManager.refresh();

            // Create ToolManager with real components
            const toolManager = createToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
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

            expect(mockClient.callTool).toHaveBeenCalledWith(
                'test_tool',
                { param: 'value' },
                expect.objectContaining({
                    logger: mockLogger,
                    toolCallId: 'test-call-id',
                })
            );
            expect(result).toEqual(expect.objectContaining({ result: 'mcp tool result' }));
        });

        it('should execute local tools through the complete pipeline', async () => {
            // Create ToolManager with local tools
            const toolManager = createToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
            expect(result).toEqual(
                expect.objectContaining({
                    result: [{ id: '1', content: 'test message', role: 'user' }],
                })
            );
        });

        it('should work with both MCP and local tools together', async () => {
            // Set up MCP tool
            const mockClient = {
                getTools: vi.fn().mockResolvedValue({
                    file_read: {
                        name: 'file_read',
                        description: 'Read file',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn().mockResolvedValue('file content'),
            };

            mcpConnections.set(connectionFromClient('file-server', mockClient));
            await mcpManager.refresh();

            // Create ToolManager with both MCP and local tools
            const toolManager = createToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
            expect(
                (
                    mcpParams.properties?.__meta as {
                        additionalProperties?: boolean;
                    }
                ).additionalProperties
            ).toBe(true);

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

            expect(mcpResult).toEqual(expect.objectContaining({ result: 'file content' }));
            expect(localResult).toEqual(
                expect.objectContaining({
                    result: [{ id: 'session1', title: 'Test Session' }],
                })
            );
        });
    });

    describe('Approval Flow Integration', () => {
        it('should work with auto-approve mode', async () => {
            const autoApproveManager = createApprovalManager(
                {
                    permissions: {
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
            const mockClient = {
                getTools: vi.fn().mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'Test tool',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn().mockResolvedValue('approved result'),
            };

            const connections = new TestMCPConnections();
            connections.set(connectionFromClient('test-server', mockClient));
            const mcpMgr = new MCPManager(connections, mockLogger);
            await mcpMgr.initialize();

            const toolManager = createToolManager(
                mcpMgr,
                autoApproveManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );
            const result = await toolManager.executeTool('mcp--test_tool', {}, 'test-call-id');

            expect(result).toEqual(expect.objectContaining({ result: 'approved result' }));
        });
    });

    describe('Error Scenarios and Recovery', () => {
        it('should handle MCP client failures gracefully', async () => {
            const failingClient = {
                getTools: vi.fn().mockRejectedValue(new Error('MCP connection failed')),
                callTool: vi.fn(),
            };

            mcpConnections.set(connectionFromClient('failing-server', failingClient));
            await mcpManager.refresh();

            const toolManager = createToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
            const failingClient = {
                getTools: vi.fn().mockResolvedValue({
                    failing_tool: {
                        name: 'failing_tool',
                        description: 'Tool that fails',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn().mockRejectedValue(new Error('Tool execution failed')),
            };

            mcpConnections.set(connectionFromClient('failing-server', failingClient));
            await mcpManager.refresh();

            const toolManager = createToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
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

            const toolManager = createToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
        it('updates the model-facing cache after an injected connection change', async () => {
            const toolManager = createToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );
            expect(await toolManager.getAllTools()).toEqual({});

            const getTools = vi.fn().mockResolvedValue({
                added_tool: {
                    description: 'Added later',
                    parameters: { type: 'object', properties: {} },
                },
            });
            mcpConnections.set(
                connectionFromClient('added-server', { getTools, callTool: vi.fn() })
            );
            await mcpConnections.announce({ type: 'connections-changed' });

            expect(await toolManager.getAllTools()).toHaveProperty('mcp--added_tool');
            expect(getTools).toHaveBeenCalledOnce();
        });

        it('should cache tool discovery results efficiently', async () => {
            const mockClient = {
                getTools: vi.fn().mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'Test tool',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn(),
            };

            mcpConnections.set(connectionFromClient('test-server', mockClient));
            await mcpManager.refresh();

            // MCP client's getTools gets called during the initial catalog refresh (1)
            expect(mockClient.getTools).toHaveBeenCalledTimes(1);
            vi.mocked(mockClient.getTools).mockClear();

            const toolManager = createToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            await toolManager.initialize();

            // Multiple calls to getAllTools should use cache
            await toolManager.getAllTools();
            await toolManager.getAllTools();
            await toolManager.getAllTools();

            // MCPManager caches tools during catalog refresh.
            // So mockClient.getTools is NOT called again by toolManager.getAllTools()
            expect(mockClient.getTools).toHaveBeenCalledTimes(0);
        });

        it('should refresh cache when requested', async () => {
            const mockClient = {
                getTools: vi.fn().mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'Test tool',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn(),
            };

            mcpConnections.set(connectionFromClient('test-server', mockClient));
            await mcpManager.refresh();
            expect(mockClient.getTools).toHaveBeenCalledTimes(1);
            vi.mocked(mockClient.getTools).mockClear();

            const toolManager = createToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
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

    describe('Canonical preparation parity', () => {
        it('prepares direct and Code Mode child calls with identical validation, policy, and presentation', async () => {
            const client = {
                getTools: vi.fn().mockResolvedValue({
                    lookup_record: {
                        description: 'Lookup a record',
                        parameters: {
                            additionalProperties: false,
                            properties: { id: { type: 'string' } },
                            required: ['id'],
                            type: 'object',
                        },
                    },
                }),
                callTool: vi.fn(),
            };
            mcpConnections.set(
                connectionFromClient('stable-connection-id', client, 'Friendly Connection')
            );
            await mcpManager.refresh();

            const manualApprovalManager = createApprovalManager(
                {
                    permissions: { mode: 'manual', timeout: 120_000 },
                    elicitation: { enabled: true, timeout: 120_000 },
                },
                mockLogger
            );
            const toolManager = createToolManager(
                mcpManager,
                manualApprovalManager,
                allowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            const prepare = (toolCallId: string, input: Record<string, unknown>) =>
                toolManager.prepareToolCall({
                    input,
                    sessionId: 'session-1',
                    toolCallId,
                    toolName: 'mcp--lookup_record',
                });
            const direct = await prepare('direct-call', { id: 'record-1' });
            const codeModeChild = await prepare('code-mode-child-call', { id: 'record-1' });

            expect(direct.kind).toBe('approval-required');
            expect(codeModeChild.kind).toBe('approval-required');
            if (direct.kind !== 'approval-required' || codeModeChild.kind !== 'approval-required') {
                throw new Error('Expected both calls to require approval');
            }
            if (
                direct.requestDetails.type !== ApprovalType.TOOL_APPROVAL ||
                codeModeChild.requestDetails.type !== ApprovalType.TOOL_APPROVAL
            ) {
                throw new Error('Expected tool approval details');
            }
            const directMetadata = ToolApprovalMetadataSchema.parse(direct.requestDetails.metadata);
            const codeModeMetadata = ToolApprovalMetadataSchema.parse(
                codeModeChild.requestDetails.metadata
            );

            expect({
                approvalKey: directMetadata.approvalKey,
                identity: direct.call.identity,
                input: direct.call.input,
                presentation: direct.call.presentationSnapshot,
            }).toEqual({
                approvalKey: codeModeMetadata.approvalKey,
                identity: codeModeChild.call.identity,
                input: codeModeChild.call.input,
                presentation: codeModeChild.call.presentationSnapshot,
            });
            expect(directMetadata.approvalKey).toBe('mcp:stable-connection-id:lookup_record');

            const invalidDirect = await prepare('invalid-direct', { id: 42 });
            const invalidCodeModeChild = await prepare('invalid-code-mode-child', { id: 42 });
            expect(invalidDirect).toEqual(invalidCodeModeChild);
            expect(invalidDirect).toEqual(
                expect.objectContaining({ kind: 'terminal', reason: 'invalid-input' })
            );
        });
    });

    describe('Session ID Handling', () => {
        it('should pass sessionId through the complete execution pipeline', async () => {
            const mockClient = {
                getTools: vi.fn().mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'Test tool',
                        parameters: { type: 'object', properties: {} },
                    },
                }),
                callTool: vi.fn().mockResolvedValue('result'),
            };

            mcpConnections.set(connectionFromClient('test-server', mockClient));
            await mcpManager.refresh();

            const toolManager = createToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [internalSearchHistoryTool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.initialize();

            const sessionId = 'test-session-123';

            // Execute MCP tool with sessionId
            await toolManager.executeTool('mcp--test_tool', { param: 'value' }, 'test-call-id-1', {
                sessionId,
            });

            // Execute local tool with sessionId
            await toolManager.executeTool(
                'search_history',
                { query: 'test', mode: 'messages' },
                'test-call-id-2',
                { sessionId }
            );

            // Verify MCP tool received session-scoped invocation context
            expect(mockClient.callTool).toHaveBeenCalledWith(
                'test_tool',
                { param: 'value' },
                expect.objectContaining({
                    logger: mockLogger,
                    sessionId,
                    toolCallId: 'test-call-id-1',
                })
            );

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
