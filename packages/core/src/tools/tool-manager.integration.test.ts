import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'node:path';
import { ToolManager } from './tool-manager.js';
import { MCPManager } from '../mcp/manager.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ToolErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import type { InternalToolsServices } from './internal-tools/registry.js';
import type { InternalToolsConfig } from './schemas.js';
import type { IMCPClient } from '../mcp/types.js';
import { AgentEventBus } from '../events/index.js';
import { ApprovalManager } from '../approval/manager.js';
import { ApprovalStatus } from '../approval/types.js';
import type { IAllowedToolsProvider } from './confirmation/allowed-tools-provider/types.js';
import { PathValidator } from '../filesystem/path-validator.js';
import type { FileSystemService } from '../filesystem/index.js';
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
    let allowedToolsProvider: IAllowedToolsProvider;
    let internalToolsServices: InternalToolsServices;
    let internalToolsConfig: InternalToolsConfig;
    let mockAgentEventBus: AgentEventBus;
    const mockLogger = createMockLogger();

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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                {
                    internalToolsServices: {},
                    internalToolsConfig: [],
                },
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

        it('should execute internal tools through the complete pipeline', async () => {
            // Create ToolManager with internal tools
            const toolManager = new ToolManager(
                mcpManager,
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                {
                    internalToolsServices,
                    internalToolsConfig,
                },
                mockLogger
            );

            await toolManager.initialize();

            // Execute internal tool
            const result = await toolManager.executeTool(
                'internal--search_history',
                { query: 'test query', mode: 'messages' },
                'test-call-id'
            );

            expect(internalToolsServices.searchService?.searchMessages).toHaveBeenCalledWith(
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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                {
                    internalToolsServices,
                    internalToolsConfig,
                },
                mockLogger
            );

            await toolManager.initialize();

            // Get all tools - should include both types with proper prefixing
            const allTools = await toolManager.getAllTools();

            expect(allTools['mcp--file_read']).toBeDefined();
            expect(allTools['internal--search_history']).toBeDefined();
            expect(allTools['mcp--file_read']?.description).toContain('(via MCP servers)');
            expect(allTools['internal--search_history']?.description).toContain('(internal tool)');

            // Execute both types
            const mcpResult = await toolManager.executeTool(
                'mcp--file_read',
                { path: '/test' },
                'test-call-id-1'
            );
            const internalResult = await toolManager.executeTool(
                'internal--search_history',
                { query: 'search test', mode: 'sessions' },
                'test-call-id-2'
            );

            expect(mcpResult).toEqual({ result: 'file content' });
            expect(internalResult).toEqual({
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
                {
                    internalToolsServices: {},
                    internalToolsConfig: [],
                },
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
                {
                    internalToolsServices: {},
                    internalToolsConfig: [],
                },
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
            const failingClient: IMCPClient = {
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
                {
                    internalToolsServices,
                    internalToolsConfig,
                },
                mockLogger
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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                {
                    internalToolsServices: failingServices,
                    internalToolsConfig,
                },
                mockLogger
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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                {
                    internalToolsServices: {},
                    internalToolsConfig: [],
                },
                mockLogger
            );

            await expect(
                toolManager.executeTool('mcp--failing_tool', {}, 'test-call-id')
            ).rejects.toThrow(Error);
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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                {
                    internalToolsServices: failingServices,
                    internalToolsConfig,
                },
                mockLogger
            );

            await toolManager.initialize();

            await expect(
                toolManager.executeTool(
                    'internal--search_history',
                    { query: 'test', mode: 'messages' },
                    'test-call-id'
                )
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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                {
                    internalToolsServices,
                    internalToolsConfig,
                },
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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                {
                    internalToolsServices: {},
                    internalToolsConfig: [],
                },
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
                approvalManager,
                allowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                {
                    internalToolsServices,
                    internalToolsConfig,
                },
                mockLogger
            );

            await toolManager.initialize();

            const sessionId = 'test-session-123';

            // Execute MCP tool with sessionId
            await toolManager.executeTool(
                'mcp--test_tool',
                { param: 'value' },
                'test-call-id-1',
                sessionId
            );

            // Execute internal tool with sessionId
            await toolManager.executeTool(
                'internal--search_history',
                { query: 'test', mode: 'messages' },
                'test-call-id-2',
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

    describe('Directory Access Integration', () => {
        /**
         * Tests for the directory access permission system.
         *
         * Key behaviors:
         * 1. Working directory: No directory prompt, follows tool config
         * 2. External dir (first access): Directory prompt, skip tool confirmation
         * 3. External dir (after "session" approval): No directory prompt, follows tool config
         * 4. External dir (after "once" approval): Directory prompt every time
         * 5. One prompt max per tool call
         * 6. Path containment: approving /ext covers /ext/sub/file.txt
         */

        let toolManager: ToolManager;
        let approvalManager: ApprovalManager;
        let mockFileSystemService: FileSystemService;
        let pathValidator: PathValidator; // Real PathValidator for testing
        let mockMcpManager: MCPManager;
        let mockAllowedToolsProvider: IAllowedToolsProvider;
        let mockAgentEventBus: AgentEventBus;
        let requestDirectoryAccessSpy: ReturnType<typeof vi.spyOn>;
        let requestToolConfirmationSpy: ReturnType<typeof vi.spyOn>;

        // Mock internal tools provider
        let mockInternalToolsProvider: any;

        // Helper to create ToolManager with specific approval mode
        const createToolManager = (mode: 'manual' | 'auto-approve' | 'auto-deny') => {
            approvalManager = new ApprovalManager(
                {
                    toolConfirmation: {
                        mode,
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false,
                    },
                },
                mockLogger
            );

            // Initialize working directory as session-approved
            approvalManager.initializeWorkingDirectory('/home/user/project');

            // Spy on approval methods
            requestDirectoryAccessSpy = vi.spyOn(approvalManager, 'requestDirectoryAccess');
            requestToolConfirmationSpy = vi.spyOn(approvalManager, 'requestToolConfirmation');

            toolManager = new ToolManager(
                mockMcpManager,
                approvalManager,
                mockAllowedToolsProvider,
                mode,
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                { internalToolsConfig: [], internalToolsServices: {} as any },
                mockLogger
            );

            // Inject mock FileSystemService
            toolManager.setFileSystemService(mockFileSystemService);

            // Mock the internal tools provider to return success for file tools
            const mockTools = {
                read_file: { name: 'read_file', description: 'Read file', parameters: {} },
                write_file: { name: 'write_file', description: 'Write file', parameters: {} },
                edit_file: { name: 'edit_file', description: 'Edit file', parameters: {} },
            };
            mockInternalToolsProvider = {
                getTools: vi.fn().mockReturnValue(mockTools),
                getTool: vi
                    .fn()
                    .mockImplementation(
                        (name: string) => mockTools[name as keyof typeof mockTools]
                    ),
                executeTool: vi.fn().mockResolvedValue({ content: 'mock file content' }),
                initialize: vi.fn().mockResolvedValue(undefined),
            };
            (toolManager as any).internalToolsProvider = mockInternalToolsProvider;

            return toolManager;
        };

        beforeEach(() => {
            mockMcpManager = {
                getAllTools: vi.fn().mockResolvedValue({}),
                executeTool: vi.fn().mockResolvedValue('success'),
                getToolClient: vi.fn().mockReturnValue({}),
                refresh: vi.fn().mockResolvedValue(undefined),
            } as any;

            mockAllowedToolsProvider = {
                isToolAllowed: vi.fn().mockResolvedValue(false),
                allowTool: vi.fn().mockResolvedValue(undefined),
                disallowTool: vi.fn().mockResolvedValue(undefined),
            } as any;

            mockAgentEventBus = {
                on: vi.fn(),
                emit: vi.fn(),
                off: vi.fn(),
                once: vi.fn(),
                removeAllListeners: vi.fn(),
            } as any;

            // Create REAL PathValidator - this tests the actual path containment logic
            // Config: /home/user/project is the only allowed path
            pathValidator = new PathValidator(
                {
                    allowedPaths: ['/home/user/project'],
                    blockedPaths: [],
                    blockedExtensions: [],
                    maxFileSize: 10 * 1024 * 1024,
                    enableBackups: false,
                    backupRetentionDays: 7,
                    workingDirectory: '/home/user/project',
                },
                mockLogger
            );

            // Mock FileSystemService that delegates to REAL implementations
            // This ensures we catch bugs in the actual logic, not hide them with fake mocks
            mockFileSystemService = {
                isPathWithinAllowed: (filePath: string) => {
                    // Delegate to real PathValidator - tests actual behavior
                    return pathValidator.isPathWithinAllowed(filePath);
                },
                getParentDirectory: (filePath: string) => {
                    // Use real path.dirname like FileSystemService does
                    return path.dirname(path.resolve(filePath));
                },
            } as any;

            vi.clearAllMocks();
        });

        // ===== WORKING DIRECTORY CASES (1-4) =====

        describe('Working Directory Cases', () => {
            it('Case 1: Read in working dir, auto-approve mode - 0 prompts', async () => {
                createToolManager('auto-approve');

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/home/user/project/src/file.ts' },
                    'call-1'
                );

                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();
            });

            it('Case 2: Read in working dir, manual mode - 1 tool prompt', async () => {
                createToolManager('manual');
                requestToolConfirmationSpy.mockResolvedValue({
                    approvalId: 'test',
                    status: ApprovalStatus.APPROVED,
                    data: {},
                });

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/home/user/project/src/file.ts' },
                    'call-2'
                );

                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(1);
            });

            it('Case 3: Write in working dir, auto-approve mode - 0 prompts', async () => {
                createToolManager('auto-approve');

                await toolManager.executeTool(
                    'internal--write_file',
                    { file_path: '/home/user/project/src/new.ts' },
                    'call-3'
                );

                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();
            });

            it('Case 4: Write in working dir, manual mode - 1 tool prompt', async () => {
                createToolManager('manual');
                requestToolConfirmationSpy.mockResolvedValue({
                    approvalId: 'test',
                    status: ApprovalStatus.APPROVED,
                    data: {},
                });

                await toolManager.executeTool(
                    'internal--write_file',
                    { file_path: '/home/user/project/src/new.ts' },
                    'call-4'
                );

                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(1);
            });

            it('Case 3b: Edit in working dir, auto-approve mode - 0 prompts', async () => {
                createToolManager('auto-approve');

                await toolManager.executeTool(
                    'internal--edit_file',
                    { file_path: '/home/user/project/src/existing.ts' },
                    'call-3b'
                );

                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();
            });

            it('Case 4b: Edit in working dir, manual mode - 1 tool prompt', async () => {
                createToolManager('manual');
                requestToolConfirmationSpy.mockResolvedValue({
                    approvalId: 'test',
                    status: ApprovalStatus.APPROVED,
                    data: {},
                });

                await toolManager.executeTool(
                    'internal--edit_file',
                    { file_path: '/home/user/project/src/existing.ts' },
                    'call-4b'
                );

                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(1);
            });
        });

        // ===== EXTERNAL DIRECTORY - FIRST ACCESS (5-8) =====

        describe('External Directory - First Access', () => {
            it('Case 5: Read external dir, auto-approve - 1 dir prompt, skip tool prompt', async () => {
                createToolManager('auto-approve');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-1',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project/file.ts' },
                    'call-5'
                );

                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled(); // Skipped
            });

            it('Case 6: Read external dir, manual mode - 1 dir prompt, skip tool prompt', async () => {
                createToolManager('manual');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-2',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project/file.ts' },
                    'call-6'
                );

                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled(); // Skipped on first access
            });

            it('Case 7: Write external dir, auto-approve - 1 dir prompt, skip tool prompt', async () => {
                createToolManager('auto-approve');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-3',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                await toolManager.executeTool(
                    'internal--write_file',
                    { file_path: '/external/project/new.ts' },
                    'call-7'
                );

                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();
            });

            it('Case 8: Write external dir, manual mode - 1 dir prompt, skip tool prompt', async () => {
                createToolManager('manual');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-4',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                await toolManager.executeTool(
                    'internal--write_file',
                    { file_path: '/external/project/new.ts' },
                    'call-8'
                );

                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();
            });

            it('Case 7b: Edit external dir, auto-approve - 1 dir prompt, skip tool prompt', async () => {
                createToolManager('auto-approve');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-5',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                await toolManager.executeTool(
                    'internal--edit_file',
                    { file_path: '/external/project/existing.ts' },
                    'call-7b'
                );

                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();
            });

            it('Case 8b: Edit external dir, manual mode - 1 dir prompt, skip tool prompt', async () => {
                createToolManager('manual');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-6',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                await toolManager.executeTool(
                    'internal--edit_file',
                    { file_path: '/external/project/existing.ts' },
                    'call-8b'
                );

                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();
            });
        });

        // ===== EXTERNAL DIRECTORY - AFTER SESSION APPROVAL (9-12) =====

        describe('External Directory - After Session Approval', () => {
            it('Case 9: Read after session approval, auto-approve - 0 prompts', async () => {
                createToolManager('auto-approve');
                // Pre-approve directory as 'session'
                approvalManager.addApprovedDirectory('/external/project', 'session');

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project/file.ts' },
                    'call-9'
                );

                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();
            });

            it('Case 10: Read after session approval, manual mode - 1 tool prompt', async () => {
                createToolManager('manual');
                approvalManager.addApprovedDirectory('/external/project', 'session');
                requestToolConfirmationSpy.mockResolvedValue({
                    approvalId: 'tool-1',
                    status: ApprovalStatus.APPROVED,
                    data: {},
                });

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project/file.ts' },
                    'call-10'
                );

                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(1);
            });

            it('Case 11: Write after session approval, auto-approve - 0 prompts', async () => {
                createToolManager('auto-approve');
                approvalManager.addApprovedDirectory('/external/project', 'session');

                await toolManager.executeTool(
                    'internal--write_file',
                    { file_path: '/external/project/new.ts' },
                    'call-11'
                );

                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();
            });

            it('Case 12: Write after session approval, manual mode - 1 tool prompt', async () => {
                createToolManager('manual');
                approvalManager.addApprovedDirectory('/external/project', 'session');
                requestToolConfirmationSpy.mockResolvedValue({
                    approvalId: 'tool-2',
                    status: ApprovalStatus.APPROVED,
                    data: {},
                });

                await toolManager.executeTool(
                    'internal--write_file',
                    { file_path: '/external/project/new.ts' },
                    'call-12'
                );

                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(1);
            });
        });

        // ===== EXTERNAL DIRECTORY - AFTER ONCE APPROVAL (13-16) =====

        describe('External Directory - After Once Approval', () => {
            it('Case 13: Read after once approval, auto-approve - 1 dir prompt each time', async () => {
                createToolManager('auto-approve');
                approvalManager.addApprovedDirectory('/external/project', 'once');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-once-1',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: false }, // "once" again
                });

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project/file.ts' },
                    'call-13'
                );

                // Should still prompt because 'once' doesn't skip directory prompt
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();
            });

            it('Case 14: Read after once approval, manual mode - 1 dir prompt each time', async () => {
                createToolManager('manual');
                approvalManager.addApprovedDirectory('/external/project', 'once');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-once-2',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: false },
                });

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project/file.ts' },
                    'call-14'
                );

                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled(); // Skipped due to dir prompt
            });

            it('Case 15: Write after once approval, auto-approve - 1 dir prompt each time', async () => {
                createToolManager('auto-approve');
                approvalManager.addApprovedDirectory('/external/project', 'once');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-once-3',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: false },
                });

                await toolManager.executeTool(
                    'internal--write_file',
                    { file_path: '/external/project/new.ts' },
                    'call-15'
                );

                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();
            });

            it('Case 16: Write after once approval, manual mode - 1 dir prompt each time', async () => {
                createToolManager('manual');
                approvalManager.addApprovedDirectory('/external/project', 'once');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-once-4',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: false },
                });

                await toolManager.executeTool(
                    'internal--write_file',
                    { file_path: '/external/project/new.ts' },
                    'call-16'
                );

                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();
            });
        });

        // ===== MULTI-REQUEST SCENARIOS (17-22) =====

        describe('Multi-Request Scenarios', () => {
            it('Case 17: Multiple files in same external dir - 1st prompts, 2nd+ follows config', async () => {
                createToolManager('manual');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-multi-1',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true }, // Session approval
                });
                requestToolConfirmationSpy.mockResolvedValue({
                    approvalId: 'tool-multi-1',
                    status: ApprovalStatus.APPROVED,
                    data: {},
                });

                // First request: directory prompt
                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project/foo.ts' },
                    'call-17a'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled(); // Skipped on first access

                // Second request: no directory prompt, follows tool config (manual = tool prompt)
                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project/bar.ts' },
                    'call-17b'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1); // Still 1
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(1); // Tool prompt on 2nd
            });

            it('Case 18: Files in different external dirs - each needs approval', async () => {
                createToolManager('auto-approve');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-diff',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project1/file.ts' },
                    'call-18a'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project2/file.ts' },
                    'call-18b'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(2); // Different dir
            });

            it('Case 19: Approve /ext/sub, access /ext/other - needs own approval', async () => {
                createToolManager('auto-approve');
                approvalManager.addApprovedDirectory('/external/sub', 'session');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-other',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                // /ext/sub is approved
                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/sub/file.ts' },
                    'call-19a'
                );
                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();

                // /ext/other is NOT covered by /ext/sub approval
                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/other/file.ts' },
                    'call-19b'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
            });

            it('Case 20: Approve /ext/sub, access /ext/sub/deep/file - covered by parent', async () => {
                createToolManager('auto-approve');
                approvalManager.addApprovedDirectory('/external/sub', 'session');

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/sub/deep/nested/file.ts' },
                    'call-20'
                );

                // Path is within approved directory
                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
            });

            it('Case 21: Upgrade from once to session on second approval', async () => {
                createToolManager('manual');

                // First: "once" approval
                requestDirectoryAccessSpy.mockResolvedValueOnce({
                    approvalId: 'dir-upgrade-1',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: false }, // Once
                });

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project/file1.ts' },
                    'call-21a'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);

                // Second request: still prompts (once doesn't persist)
                requestDirectoryAccessSpy.mockResolvedValueOnce({
                    approvalId: 'dir-upgrade-2',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true }, // Upgrade to session
                });

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project/file2.ts' },
                    'call-21b'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(2);

                // Third request: no prompt (now session-approved)
                requestToolConfirmationSpy.mockResolvedValue({
                    approvalId: 'tool-upgrade',
                    status: ApprovalStatus.APPROVED,
                    data: {},
                });

                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project/file3.ts' },
                    'call-21c'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(2); // No new dir prompt
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(1); // Tool prompt
            });

            it('Case 22: Deny directory access - tool fails with error', async () => {
                createToolManager('auto-approve');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-deny',
                    status: ApprovalStatus.DENIED,
                    data: {},
                });

                const error = await toolManager
                    .executeTool(
                        'internal--read_file',
                        { file_path: '/external/project/file.ts' },
                        'call-22'
                    )
                    .catch((e) => e);

                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect(error.code).toBe(ToolErrorCode.DIRECTORY_ACCESS_DENIED);
            });

            it('Case 23: Multiple edits in same external dir - 1st prompts, 2nd+ follows config', async () => {
                createToolManager('manual');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-multi-edit',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });
                requestToolConfirmationSpy.mockResolvedValue({
                    approvalId: 'tool-multi-edit',
                    status: ApprovalStatus.APPROVED,
                    data: {},
                });

                // First edit: directory prompt
                await toolManager.executeTool(
                    'internal--edit_file',
                    { file_path: '/external/project/file1.ts' },
                    'call-23a'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).not.toHaveBeenCalled();

                // Second edit: no directory prompt, tool prompt (manual mode)
                await toolManager.executeTool(
                    'internal--edit_file',
                    { file_path: '/external/project/file2.ts' },
                    'call-23b'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(1);

                // Third edit: still no directory prompt
                await toolManager.executeTool(
                    'internal--edit_file',
                    { file_path: '/external/project/file3.ts' },
                    'call-23c'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(2);
            });

            it('Case 24: Mixed operations (read, write, edit) in same external dir', async () => {
                createToolManager('manual');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-mixed',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });
                requestToolConfirmationSpy.mockResolvedValue({
                    approvalId: 'tool-mixed',
                    status: ApprovalStatus.APPROVED,
                    data: {},
                });

                // First: read - directory prompt
                await toolManager.executeTool(
                    'internal--read_file',
                    { file_path: '/external/project/config.json' },
                    'call-24a'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);

                // Second: write - no directory prompt
                await toolManager.executeTool(
                    'internal--write_file',
                    { file_path: '/external/project/output.ts' },
                    'call-24b'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(1);

                // Third: edit - no directory prompt
                await toolManager.executeTool(
                    'internal--edit_file',
                    { file_path: '/external/project/existing.ts' },
                    'call-24c'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(2);
            });

            it('Case 25: Write then edit in different external dirs - each needs approval', async () => {
                createToolManager('auto-approve');
                requestDirectoryAccessSpy.mockResolvedValue({
                    approvalId: 'dir-diff-ops',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                // Write to dir1
                await toolManager.executeTool(
                    'internal--write_file',
                    { file_path: '/external/project1/new.ts' },
                    'call-25a'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(1);

                // Edit in dir2 - different directory, needs approval
                await toolManager.executeTool(
                    'internal--edit_file',
                    { file_path: '/external/project2/existing.ts' },
                    'call-25b'
                );
                expect(requestDirectoryAccessSpy).toHaveBeenCalledTimes(2);
            });
        });

        // ===== EDGE CASES =====

        describe('Edge Cases', () => {
            it('should not prompt for non-file tools', async () => {
                createToolManager('manual');
                requestToolConfirmationSpy.mockResolvedValue({
                    approvalId: 'tool-non-file',
                    status: ApprovalStatus.APPROVED,
                    data: {},
                });

                // Tool without file_path arg
                await toolManager.executeTool('mcp--web_search', { query: 'test' }, 'call-edge-1');

                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(1);
            });

            it('should handle missing file_path gracefully', async () => {
                createToolManager('manual');
                requestToolConfirmationSpy.mockResolvedValue({
                    approvalId: 'tool-no-path',
                    status: ApprovalStatus.APPROVED,
                    data: {},
                });

                await toolManager.executeTool(
                    'mcp--read_file',
                    {}, // No file_path
                    'call-edge-2'
                );

                expect(requestDirectoryAccessSpy).not.toHaveBeenCalled();
                expect(requestToolConfirmationSpy).toHaveBeenCalledTimes(1);
            });
        });
    });
});
