import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { ToolManager } from './tool-manager.js';
import { defineTool } from './define-tool.js';
import { MCPManager } from '../mcp/manager.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ToolErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { AgentEventBus } from '../events/index.js';
import type { ApprovalManager } from '../approval/manager.js';
import type { AllowedToolsProvider } from './confirmation/allowed-tools-provider/types.js';
import { ApprovalStatus, ApprovalType } from '../approval/types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

// Mock logger
vi.mock('../logger/index.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('ToolManager - Unit Tests (Pure Logic)', () => {
    let mockMcpManager: MCPManager;
    let mockApprovalManager: ApprovalManager;
    let mockAllowedToolsProvider: AllowedToolsProvider;
    let mockAgentEventBus: AgentEventBus;
    const mockLogger = createMockLogger();

    beforeEach(() => {
        mockMcpManager = {
            getAllTools: vi.fn(),
            executeTool: vi.fn(),
            getToolClient: vi.fn(),
            refresh: vi.fn().mockResolvedValue(undefined),
        } as any;

        mockApprovalManager = {
            requestApproval: vi.fn().mockResolvedValue({
                approvalId: 'test-custom-approval-id',
                status: ApprovalStatus.APPROVED,
                data: { rememberDirectory: false },
            }),
            requestToolApproval: vi.fn().mockResolvedValue({
                approvalId: 'test-approval-id',
                status: ApprovalStatus.APPROVED,
                data: { rememberChoice: false },
            }),
            addApprovedDirectory: vi.fn(),
            autoApprovePendingRequests: vi.fn().mockReturnValue(0),
            matchesPattern: vi.fn().mockReturnValue(false),
            getPendingApprovals: vi.fn().mockReturnValue([]),
            cancelApproval: vi.fn(),
            cancelAllApprovals: vi.fn(),
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

        vi.clearAllMocks();
    });

    describe('Tool Source Detection Logic', () => {
        it('should correctly identify MCP tools', () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            expect(toolManager.getToolSource('mcp--file_read')).toBe('mcp');
            expect(toolManager.getToolSource('mcp--web_search')).toBe('mcp');
        });

        it('should correctly identify local tools', () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [
                    {
                        id: 'search_history',
                        description: 'Search history',
                        inputSchema: z.object({}).strict(),
                        execute: vi.fn(),
                    },
                    {
                        id: 'config_manager',
                        description: 'Config manager',
                        inputSchema: z.object({}).strict(),
                        execute: vi.fn(),
                    },
                ] as any,
                mockLogger
            );

            expect(toolManager.getToolSource('search_history')).toBe('local');
            expect(toolManager.getToolSource('config_manager')).toBe('local');
        });

        it('should identify unknown tools', () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            expect(toolManager.getToolSource('invalid_tool')).toBe('unknown');
            expect(toolManager.getToolSource('file_read')).toBe('unknown'); // No prefix
            expect(toolManager.getToolSource('')).toBe('unknown'); // Empty
        });

        it('should handle edge cases with empty tool names', () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            expect(toolManager.getToolSource('mcp--')).toBe('unknown'); // Prefix but no name
        });
    });

    describe('Tool Name Parsing Logic', () => {
        it('should extract actual tool name from MCP prefix', () => {
            const prefixedName = 'mcp--file_read';
            const actualName = prefixedName.substring('mcp--'.length);
            expect(actualName).toBe('file_read');
        });

        it('should handle complex tool names', () => {
            const complexName = 'mcp--complex_tool_name_with_underscores';
            const actualName = complexName.substring('mcp--'.length);
            expect(actualName).toBe('complex_tool_name_with_underscores');
        });
    });

    describe('Tool Validation Logic', () => {
        it('should return not found for unknown tools', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const error = (await toolManager
                .executeTool('invalid_tool', {}, 'test-call-id')
                .catch((e) => e)) as DextoRuntimeError;
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(ToolErrorCode.TOOL_NOT_FOUND);
            expect(error.scope).toBe(ErrorScope.TOOLS);
            expect(error.type).toBe(ErrorType.NOT_FOUND);
        });

        it('should reject MCP tools with prefix but no name', async () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const mcpError = (await toolManager
                .executeTool('mcp--', {}, 'test-call-id')
                .catch((e) => e)) as DextoRuntimeError;
            expect(mcpError).toBeInstanceOf(DextoRuntimeError);
            expect(mcpError.code).toBe(ToolErrorCode.TOOL_INVALID_ARGS);
            expect(mcpError.scope).toBe(ErrorScope.TOOLS);
            expect(mcpError.type).toBe(ErrorType.USER);

            // Should NOT call the underlying managers
            expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
        });

        it('should return not found when local tool is not registered', async () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const error = (await toolManager
                .executeTool('search_history', {}, 'test-call-id')
                .catch((e) => e)) as DextoRuntimeError;
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(ToolErrorCode.TOOL_NOT_FOUND);
            expect(error.scope).toBe(ErrorScope.TOOLS);
            expect(error.type).toBe(ErrorType.NOT_FOUND);
        });
    });

    describe('Local Tool Execution', () => {
        it('should execute local tools provided to ToolManager', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [
                    {
                        id: 'hello',
                        description: 'Say hello',
                        inputSchema: z
                            .object({
                                name: z.string(),
                            })
                            .strict(),
                        execute: async (input: unknown) =>
                            `Hello, ${(input as { name: string }).name}`,
                    },
                ] as any,
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            const allTools = await toolManager.getAllTools();
            expect(allTools['hello']).toBeDefined();

            const result = await toolManager.executeTool('hello', { name: 'World' }, 'call-1');
            expect(result).toEqual({ result: 'Hello, World' });
        });
    });

    describe('Confirmation Flow Logic', () => {
        it('should emit callDescription on llm:tool-call events when __meta.callDescription is provided', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const tool = defineTool({
                id: 'typed',
                description: 'Typed tool',
                inputSchema: z
                    .object({
                        count: z.number().int(),
                    })
                    .strict(),
                execute: vi.fn().mockResolvedValue('ok'),
            });

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [tool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.executeTool(
                'typed',
                { count: 5, __meta: { callDescription: 'Read test file' } },
                'call-1',
                'session-1'
            );

            expect(mockAgentEventBus.emit).toHaveBeenCalledWith(
                'llm:tool-call',
                expect.objectContaining({
                    toolName: 'typed',
                    args: { count: 5 },
                    callDescription: 'Read test file',
                    callId: 'call-1',
                    sessionId: 'session-1',
                })
            );
        });

        it('should emit callDescription on llm:tool-call events when args.description is provided', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            await toolManager.executeTool(
                'mcp--file_read',
                { path: '/test', description: 'Read test file' },
                'call-1',
                'session-1'
            );

            expect(mockAgentEventBus.emit).toHaveBeenCalledWith(
                'llm:tool-call',
                expect.objectContaining({
                    toolName: 'mcp--file_read',
                    args: { path: '/test', description: 'Read test file' },
                    callDescription: 'Read test file',
                    callId: 'call-1',
                    sessionId: 'session-1',
                })
            );
        });

        it('should validate local tool args before custom approvals and previews', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const approvalOverrideSpy = vi.fn().mockResolvedValue(null);
            const previewSpy = vi.fn().mockResolvedValue(null);

            const tool = defineTool({
                id: 'typed',
                description: 'Typed tool',
                inputSchema: z
                    .object({
                        count: z.coerce.number().int().default(0),
                    })
                    .strict(),
                getApprovalOverride: approvalOverrideSpy,
                generatePreview: previewSpy,
                execute: vi.fn().mockResolvedValue('ok'),
            });

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [tool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.executeTool('typed', { count: '5' }, 'call-1', 'session-1');

            expect(approvalOverrideSpy).toHaveBeenCalledWith(
                { count: 5 },
                expect.objectContaining({ sessionId: 'session-1' })
            );
            expect(previewSpy).toHaveBeenCalledWith(
                { count: 5 },
                expect.objectContaining({ toolCallId: 'call-1', sessionId: 'session-1' })
            );
            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalledWith(
                expect.objectContaining({
                    toolName: 'typed',
                    toolCallId: 'call-1',
                    args: { count: 5 },
                    sessionId: 'session-1',
                })
            );
        });

        it('should include directory access metadata in tool approval and remember directory when approved', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const callOrder: string[] = [];

            const tool = defineTool({
                id: 'fs_like_tool',
                description: 'Filesystem-like tool',
                inputSchema: z
                    .object({
                        file_path: z.string(),
                    })
                    .strict(),
                getApprovalOverride: vi.fn().mockImplementation(async () => {
                    callOrder.push('getApprovalOverride');
                    return {
                        type: ApprovalType.DIRECTORY_ACCESS,
                        metadata: {
                            path: '/tmp/example.txt',
                            parentDir: '/tmp',
                            operation: 'read',
                            toolName: 'fs_like_tool',
                        },
                    };
                }),
                onApprovalGranted: vi.fn().mockImplementation(async () => {
                    callOrder.push('onApprovalGranted');
                }),
                generatePreview: vi.fn().mockImplementation(async () => {
                    callOrder.push('generatePreview');
                    return null;
                }),
                execute: vi.fn().mockImplementation(async () => {
                    callOrder.push('execute');
                    return 'ok';
                }),
            });

            (mockApprovalManager.requestApproval as any).mockImplementation(async () => {
                callOrder.push('requestApproval');
                return {
                    approvalId: 'test-approval-id',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                };
            });

            (mockApprovalManager.addApprovedDirectory as any).mockImplementation(() => {
                callOrder.push('addApprovedDirectory');
            });

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: ['fs_like_tool'], alwaysDeny: [] },
                [tool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            const result = await toolManager.executeTool(
                'fs_like_tool',
                { file_path: '/tmp/example.txt' },
                'call-1',
                'session-1'
            );

            expect(result).toEqual({
                result: 'ok',
                requireApproval: true,
                approvalStatus: 'approved',
            });

            expect(mockAllowedToolsProvider.isToolAllowed).not.toHaveBeenCalled();
            // When getApprovalOverride returns a value, it calls requestApproval directly
            expect(mockApprovalManager.requestApproval).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: ApprovalType.DIRECTORY_ACCESS,
                    metadata: expect.objectContaining({
                        path: '/tmp/example.txt',
                        parentDir: '/tmp',
                        operation: 'read',
                    }),
                })
            );
            expect(mockApprovalManager.addApprovedDirectory).not.toHaveBeenCalled();

            // Directory access goes through getApprovalOverride → requestApproval → onApprovalGranted → execute
            expect(callOrder).toEqual([
                'getApprovalOverride',
                'requestApproval',
                'onApprovalGranted',
                'execute',
            ]);
        });

        it('should request approval via ApprovalManager with correct parameters', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            await toolManager.executeTool(
                'mcp--file_read',
                {
                    path: '/test',
                    __meta: {
                        callDescription: 'Read test file',
                    },
                },
                'call-123',
                'session123'
            );

            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalledWith({
                toolName: 'mcp--file_read',
                toolCallId: 'call-123',
                args: { path: '/test' },
                description: 'Read test file',
                sessionId: 'session123',
            });
        });

        it('should fall back to args.description for approval description when __meta.callDescription is missing', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            await toolManager.executeTool(
                'mcp--file_read',
                { path: '/test', description: 'Read test file' },
                'call-123',
                'session123'
            );

            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalledWith({
                toolName: 'mcp--file_read',
                toolCallId: 'call-123',
                args: { path: '/test', description: 'Read test file' },
                description: 'Read test file',
                sessionId: 'session123',
            });
        });

        it('should emit background event when runInBackground is set', async () => {
            const originalEnv = process.env.DEXTO_BACKGROUND_TASKS_ENABLED;
            process.env.DEXTO_BACKGROUND_TASKS_ENABLED = 'true';
            try {
                mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');
                const emitSpy = vi.fn();
                mockAgentEventBus.emit = emitSpy as typeof mockAgentEventBus.emit;

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'auto-approve',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [],
                    mockLogger
                );

                const response = await toolManager.executeTool(
                    'mcp--file_read',
                    {
                        path: '/test',
                        __meta: {
                            runInBackground: true,
                        },
                    },
                    'call-123',
                    'session-1'
                );

                const result = response.result as {
                    taskId?: string;
                    status?: string;
                    description?: string;
                };
                expect(result.status).toBe('running');
                expect(result.taskId).toBe('call-123');
                expect(emitSpy).toHaveBeenCalledWith(
                    'tool:background',
                    expect.objectContaining({
                        toolName: 'mcp--file_read',
                        toolCallId: 'call-123',
                        sessionId: 'session-1',
                    })
                );
            } finally {
                if (originalEnv === undefined) {
                    delete process.env.DEXTO_BACKGROUND_TASKS_ENABLED;
                } else {
                    process.env.DEXTO_BACKGROUND_TASKS_ENABLED = originalEnv;
                }
            }
        });

        it('should ignore runInBackground when background tasks are disabled', async () => {
            const originalEnv = process.env.DEXTO_BACKGROUND_TASKS_ENABLED;
            process.env.DEXTO_BACKGROUND_TASKS_ENABLED = 'false';
            try {
                mockMcpManager.executeTool = vi.fn().mockResolvedValue('sync-result');
                const emitSpy = vi.fn();
                mockAgentEventBus.emit = emitSpy as typeof mockAgentEventBus.emit;

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'auto-approve',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [],
                    mockLogger
                );

                const response = await toolManager.executeTool(
                    'mcp--file_read',
                    {
                        path: '/test',
                        __meta: {
                            runInBackground: true,
                        },
                    },
                    'call-123',
                    'session-1'
                );

                expect(response.result).toBe('sync-result');
                expect(emitSpy).not.toHaveBeenCalledWith('tool:background', expect.anything());
            } finally {
                if (originalEnv === undefined) {
                    delete process.env.DEXTO_BACKGROUND_TASKS_ENABLED;
                } else {
                    process.env.DEXTO_BACKGROUND_TASKS_ENABLED = originalEnv;
                }
            }
        });

        it('should request approval without sessionId when not provided', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            await toolManager.executeTool('mcp--file_read', { path: '/test' }, 'call-456');

            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalledWith({
                toolName: 'mcp--file_read',
                toolCallId: 'call-456',
                args: { path: '/test' },
            });
        });

        it('should throw execution denied error when approval denied', async () => {
            mockApprovalManager.requestToolApproval = vi.fn().mockResolvedValue({
                approvalId: 'test-approval-id',
                status: ApprovalStatus.DENIED,
            });

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const error = (await toolManager
                .executeTool('mcp--file_read', { path: '/test' }, 'test-call-id', 'session123')
                .catch((e) => e)) as DextoRuntimeError;
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(ToolErrorCode.EXECUTION_DENIED);
            expect(error.scope).toBe(ErrorScope.TOOLS);
            expect(error.type).toBe(ErrorType.FORBIDDEN);

            expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
        });

        it('should proceed with execution when approval granted', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('success');

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const result = await toolManager.executeTool(
                'mcp--file_read',
                { path: '/test' },
                'test-call-id'
            );

            expect(mockMcpManager.executeTool).toHaveBeenCalledWith(
                'file_read',
                { path: '/test' },
                undefined
            );
            expect(result).toEqual({
                result: 'success',
                requireApproval: true,
                approvalStatus: 'approved',
            });
        });

        it('should skip confirmation for tools in allowed list', async () => {
            mockAllowedToolsProvider.isToolAllowed = vi.fn().mockResolvedValue(true);
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('success');

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const result = await toolManager.executeTool(
                'mcp--file_read',
                { path: '/test' },
                'test-call-id'
            );

            expect(mockAllowedToolsProvider.isToolAllowed).toHaveBeenCalledWith(
                'mcp--file_read',
                undefined
            );
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            expect(result).toEqual({ result: 'success' });
        });

        it('should auto-approve when mode is auto-approve', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('success');

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const result = await toolManager.executeTool(
                'mcp--file_read',
                { path: '/test' },
                'test-call-id'
            );

            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            expect(mockMcpManager.executeTool).toHaveBeenCalled();
            expect(result).toEqual({ result: 'success' });
        });

        it('should auto-deny when mode is auto-deny', async () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-deny',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const error = (await toolManager
                .executeTool('mcp--file_read', { path: '/test' }, 'test-call-id')
                .catch((e) => e)) as DextoRuntimeError;

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(ToolErrorCode.EXECUTION_DENIED);
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
        });
    });

    describe('Cache Management Logic', () => {
        it('should cache tool discovery results', async () => {
            const tools = {
                test_tool: { name: 'test_tool', description: 'Test', parameters: {} },
            };
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue(tools);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            // First call
            await toolManager.getAllTools();
            // Second call should use cache
            await toolManager.getAllTools();

            expect(mockMcpManager.getAllTools).toHaveBeenCalledTimes(1);
        });

        it('should invalidate cache on refresh', async () => {
            const tools = {
                test_tool: { name: 'test_tool', description: 'Test', parameters: {} },
            };
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue(tools);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            // First call
            await toolManager.getAllTools();

            // Refresh should invalidate cache
            await toolManager.refresh();

            // Second call should fetch again
            await toolManager.getAllTools();

            expect(mockMcpManager.getAllTools).toHaveBeenCalledTimes(2);
        });
    });

    describe('Tool Statistics Logic', () => {
        it('should calculate statistics correctly', async () => {
            const mcpTools = {
                tool1: { name: 'tool1', description: 'Tool 1', parameters: {} },
                tool2: { name: 'tool2', description: 'Tool 2', parameters: {} },
            };

            mockMcpManager.getAllTools = vi.fn().mockResolvedValue(mcpTools);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const stats = await toolManager.getToolStats();

            expect(stats).toEqual({
                total: 2,
                mcp: 2,
                local: 0,
            });
        });

        it('should handle empty tool sets', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const stats = await toolManager.getToolStats();

            expect(stats).toEqual({
                total: 0,
                mcp: 0,
                local: 0,
            });
        });

        it('should handle MCP errors gracefully in statistics', async () => {
            mockMcpManager.getAllTools = vi.fn().mockRejectedValue(new Error('MCP failed'));

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const stats = await toolManager.getToolStats();

            expect(stats).toEqual({
                total: 0,
                mcp: 0,
                local: 0,
            });
        });
    });

    describe('Tool Existence Checking Logic', () => {
        it('should check MCP tool existence correctly', async () => {
            mockMcpManager.getToolClient = vi.fn().mockReturnValue({});

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const exists = await toolManager.hasTool('mcp--file_read');

            expect(mockMcpManager.getToolClient).toHaveBeenCalledWith('file_read');
            expect(exists).toBe(true);
        });

        it('should return false for non-existent MCP tools', async () => {
            mockMcpManager.getToolClient = vi.fn().mockReturnValue(undefined);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const exists = await toolManager.hasTool('mcp--nonexistent');

            expect(exists).toBe(false);
        });

        it('should return false for tools without proper prefix', async () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            const exists = await toolManager.hasTool('invalid_tool');

            expect(exists).toBe(false);
        });
    });

    describe('Error Propagation Logic', () => {
        it('should propagate MCP tool execution errors', async () => {
            const executionError = new Error('Tool execution failed');
            mockMcpManager.executeTool = vi.fn().mockRejectedValue(executionError);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            await expect(
                toolManager.executeTool('mcp--file_read', { path: '/test' }, 'test-call-id')
            ).rejects.toThrow('Tool execution failed');
        });

        it('should propagate approval manager errors', async () => {
            const approvalError = new Error('Approval request failed');
            mockApprovalManager.requestToolApproval = vi.fn().mockRejectedValue(approvalError);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [], alwaysDeny: [] },
                [],
                mockLogger
            );

            await expect(
                toolManager.executeTool('mcp--file_read', { path: '/test' }, 'test-call-id')
            ).rejects.toThrow('Approval request failed');
        });
    });

    describe('Tool Policies (Allow/Deny Lists)', () => {
        beforeEach(() => {
            // Reset mocks for policy tests
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('success');
            mockAllowedToolsProvider.isToolAllowed = vi.fn().mockResolvedValue(false);
        });

        describe('Precedence Logic', () => {
            it('should deny tools in alwaysDeny list (highest precedence)', async () => {
                const toolPolicies = {
                    alwaysAllow: [],
                    alwaysDeny: ['mcp--filesystem--delete_file'],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                await expect(
                    toolManager.executeTool(
                        'mcp--filesystem--delete_file',
                        { path: '/test' },
                        'test-call-id'
                    )
                ).rejects.toThrow();

                // Should not reach approval manager or execution
                expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
                expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
            });

            it('should deny even if tool is in alwaysAllow list', async () => {
                const toolPolicies = {
                    alwaysAllow: ['mcp--filesystem--delete_file'],
                    alwaysDeny: ['mcp--filesystem--delete_file'], // Deny takes precedence
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                await expect(
                    toolManager.executeTool(
                        'mcp--filesystem--delete_file',
                        { path: '/test' },
                        'test-call-id'
                    )
                ).rejects.toThrow();

                expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
            });

            it('should allow tools in alwaysAllow list without confirmation', async () => {
                const toolPolicies = {
                    alwaysAllow: ['mcp--filesystem--read_file'],
                    alwaysDeny: [],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                const result = await toolManager.executeTool(
                    'mcp--filesystem--read_file',
                    { path: '/test' },
                    'test-call-id'
                );

                expect(result).toEqual({ result: 'success' });
                expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
                expect(mockMcpManager.executeTool).toHaveBeenCalledWith(
                    'filesystem--read_file',
                    {
                        path: '/test',
                    },
                    undefined
                );
            });

            it('should check dynamic allowed list after static policies', async () => {
                mockAllowedToolsProvider.isToolAllowed = vi.fn().mockResolvedValue(true);

                const toolPolicies = {
                    alwaysAllow: [],
                    alwaysDeny: [],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                const result = await toolManager.executeTool(
                    'mcp--filesystem--read_file',
                    { path: '/test' },
                    'test-call-id'
                );

                expect(result).toEqual({ result: 'success' });
                expect(mockAllowedToolsProvider.isToolAllowed).toHaveBeenCalledWith(
                    'mcp--filesystem--read_file',
                    undefined
                );
                expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            });

            it('should fall back to approval mode when no policies match', async () => {
                mockApprovalManager.requestToolApproval = vi.fn().mockResolvedValue({
                    approvalId: 'test-approval',
                    status: 'approved',
                    data: {},
                });

                const toolPolicies = {
                    alwaysAllow: ['ask_user'],
                    alwaysDeny: ['mcp--filesystem--delete_file'],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                const result = await toolManager.executeTool(
                    'mcp--filesystem--read_file',
                    { path: '/test' },
                    'test-call-id'
                );

                expect(result).toEqual({
                    result: 'success',
                    requireApproval: true,
                    approvalStatus: 'approved',
                });
                expect(mockApprovalManager.requestToolApproval).toHaveBeenCalled();
            });
        });

        describe('Auto-approve with Deny List', () => {
            it('should deny tools in alwaysDeny even with auto-approve mode', async () => {
                const toolPolicies = {
                    alwaysAllow: [],
                    alwaysDeny: ['mcp--filesystem--delete_file'],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'auto-approve',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                await expect(
                    toolManager.executeTool(
                        'mcp--filesystem--delete_file',
                        { path: '/test' },
                        'test-call-id'
                    )
                ).rejects.toThrow();

                expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
            });

            it('should auto-approve tools not in deny list', async () => {
                const toolPolicies = {
                    alwaysAllow: [],
                    alwaysDeny: ['mcp--filesystem--delete_file'],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'auto-approve',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                const result = await toolManager.executeTool(
                    'mcp--filesystem--read_file',
                    { path: '/test' },
                    'test-call-id'
                );

                expect(result).toEqual({ result: 'success' });
                expect(mockMcpManager.executeTool).toHaveBeenCalled();
            });
        });

        describe('Auto-deny with Allow List', () => {
            it('should allow tools in alwaysAllow even with auto-deny mode', async () => {
                const toolPolicies = {
                    alwaysAllow: ['mcp--filesystem--read_file'],
                    alwaysDeny: [],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'auto-deny',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                const result = await toolManager.executeTool(
                    'mcp--filesystem--read_file',
                    { path: '/test' },
                    'test-call-id'
                );

                expect(result).toEqual({ result: 'success' });
                expect(mockMcpManager.executeTool).toHaveBeenCalled();
            });

            it('should auto-deny tools not in allow list', async () => {
                const toolPolicies = {
                    alwaysAllow: ['mcp--filesystem--read_file'],
                    alwaysDeny: [],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'auto-deny',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                await expect(
                    toolManager.executeTool(
                        'mcp--filesystem--write_file',
                        { path: '/test' },
                        'test-call-id'
                    )
                ).rejects.toThrow();

                expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
            });
        });

        describe('No Policies Configured', () => {
            it('should work normally when no policies are provided', async () => {
                mockApprovalManager.requestToolApproval = vi.fn().mockResolvedValue({
                    approvalId: 'test-approval',
                    status: 'approved',
                    data: {},
                });

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] }, // No policies
                    [],
                    mockLogger
                );

                const result = await toolManager.executeTool(
                    'mcp--filesystem--read_file',
                    { path: '/test' },
                    'test-call-id'
                );

                expect(result).toEqual({
                    result: 'success',
                    requireApproval: true,
                    approvalStatus: 'approved',
                });
                expect(mockApprovalManager.requestToolApproval).toHaveBeenCalled();
            });

            it('should work normally when empty policies are provided', async () => {
                mockApprovalManager.requestToolApproval = vi.fn().mockResolvedValue({
                    approvalId: 'test-approval',
                    status: 'approved',
                    data: {},
                });

                const toolPolicies = {
                    alwaysAllow: [],
                    alwaysDeny: [],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                const result = await toolManager.executeTool(
                    'mcp--filesystem--read_file',
                    { path: '/test' },
                    'test-call-id'
                );

                expect(result).toEqual({
                    result: 'success',
                    requireApproval: true,
                    approvalStatus: 'approved',
                });
                expect(mockApprovalManager.requestToolApproval).toHaveBeenCalled();
            });
        });

        describe('Local Tools with Policies', () => {
            it('should respect policies for local tools', async () => {
                const toolPolicies = {
                    alwaysAllow: ['ask_user'],
                    alwaysDeny: [],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [
                        {
                            id: 'ask_user',
                            description: 'Ask user',
                            inputSchema: z.object({}).strict(),
                            execute: vi.fn().mockResolvedValue('ok'),
                        },
                    ] as any,
                    mockLogger
                );
                toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

                const result = await toolManager.executeTool('ask_user', {}, 'test-call-id');

                expect(result).toEqual({ result: 'ok' });
                expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            });
        });

        describe('Dual Matching (Exact + Suffix)', () => {
            beforeEach(() => {
                mockMcpManager.executeTool = vi.fn().mockResolvedValue('success');
                mockAllowedToolsProvider.isToolAllowed = vi.fn().mockResolvedValue(false);
            });

            it('should match exact tool names in allow list', async () => {
                const toolPolicies = {
                    alwaysAllow: ['mcp--read_file'],
                    alwaysDeny: [],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                const result = await toolManager.executeTool(
                    'mcp--read_file',
                    { path: '/test' },
                    'test-call-id'
                );

                expect(result).toEqual({ result: 'success' });
                expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            });

            it('should match qualified names with suffix matching in allow list', async () => {
                const toolPolicies = {
                    alwaysAllow: ['mcp--read_file'], // Simple policy
                    alwaysDeny: [],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                // Tool with server prefix should match simple policy
                const result = await toolManager.executeTool(
                    'mcp--filesystem--read_file',
                    { path: '/test' },
                    'test-call-id'
                );

                expect(result).toEqual({ result: 'success' });
                expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
                expect(mockMcpManager.executeTool).toHaveBeenCalledWith(
                    'filesystem--read_file',
                    {
                        path: '/test',
                    },
                    undefined
                );
            });

            it('should match exact tool names in deny list', async () => {
                const toolPolicies = {
                    alwaysAllow: [],
                    alwaysDeny: ['mcp--delete_file'],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                await expect(
                    toolManager.executeTool('mcp--delete_file', { path: '/test' }, 'test-call-id')
                ).rejects.toThrow();

                expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
            });

            it('should match qualified names with suffix matching in deny list', async () => {
                const toolPolicies = {
                    alwaysAllow: [],
                    alwaysDeny: ['mcp--delete_file'], // Simple policy
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                // Tool with server prefix should match simple policy
                await expect(
                    toolManager.executeTool(
                        'mcp--filesystem--delete_file',
                        { path: '/test' },
                        'test-call-id'
                    )
                ).rejects.toThrow();

                expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
            });

            it('should not match unrelated tools with similar names', async () => {
                mockApprovalManager.requestToolApproval = vi.fn().mockResolvedValue({
                    approvalId: 'test-approval',
                    status: 'approved',
                    data: {},
                });

                const toolPolicies = {
                    alwaysAllow: ['mcp--read_file'],
                    alwaysDeny: [],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                // This should NOT match because it doesn't end with --read_file
                const result = await toolManager.executeTool(
                    'mcp--read_file_metadata',
                    {},
                    'test-call-id'
                );

                expect(result).toEqual({
                    result: 'success',
                    requireApproval: true,
                    approvalStatus: 'approved',
                });
                // Should require approval since it doesn't match the policy
                expect(mockApprovalManager.requestToolApproval).toHaveBeenCalled();
            });

            it('should only apply suffix matching to MCP tools, not internal tools', async () => {
                mockApprovalManager.requestToolApproval = vi.fn().mockResolvedValue({
                    approvalId: 'test-approval',
                    status: 'approved',
                    data: {},
                });

                const toolPolicies = {
                    // Policy for a simple tool name
                    alwaysAllow: ['mcp--read_file'],
                    alwaysDeny: [],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                // MCP tool with suffix should match (suffix matching works)
                await toolManager.executeTool('mcp--filesystem--read_file', {}, 'test-call-id');
                expect(mockMcpManager.executeTool).toHaveBeenLastCalledWith(
                    'filesystem--read_file',
                    {},
                    undefined
                );
                expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();

                // But if an internal tool had a similar pattern, it shouldn't match via suffix
                // (This is conceptual - internal tools don't have server prefixes in practice)
                // The point is that suffix matching logic only applies to mcp-- prefixed patterns
            });

            it('should handle multiple policies with mixed matching', async () => {
                mockApprovalManager.requestToolApproval = vi.fn().mockResolvedValue({
                    approvalId: 'test-approval',
                    status: 'approved',
                    data: {},
                });

                const toolPolicies = {
                    alwaysAllow: ['mcp--read_file', 'mcp--list_directory', 'ask_user'],
                    alwaysDeny: ['mcp--delete_file', 'mcp--execute_script'],
                };

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    toolPolicies,
                    [],
                    mockLogger
                );

                // Test various matching scenarios
                await toolManager.executeTool('mcp--read_file', {}, 'test-call-id');
                expect(mockMcpManager.executeTool).toHaveBeenLastCalledWith(
                    'read_file',
                    {},
                    undefined
                );

                await toolManager.executeTool('mcp--filesystem--read_file', {}, 'test-call-id');
                expect(mockMcpManager.executeTool).toHaveBeenLastCalledWith(
                    'filesystem--read_file',
                    {},
                    undefined
                );

                await toolManager.executeTool('mcp--server2--list_directory', {}, 'test-call-id');
                expect(mockMcpManager.executeTool).toHaveBeenLastCalledWith(
                    'server2--list_directory',
                    {},
                    undefined
                );

                // Deny should still work
                await expect(
                    toolManager.executeTool('mcp--filesystem--delete_file', {}, 'test-call-id')
                ).rejects.toThrow();

                // None of these should have triggered approval
                expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            });
        });
    });

    describe('Session Auto-Approve Tools (Skill allowed-tools)', () => {
        describe('Basic CRUD Operations', () => {
            it('should set and get session auto-approve tools', () => {
                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [],
                    mockLogger
                );

                const sessionId = 'test-session-123';
                const tools = ['bash_exec', 'mcp--read_file'];

                toolManager.setSessionAutoApproveTools(sessionId, tools);

                expect(toolManager.hasSessionAutoApproveTools(sessionId)).toBe(true);
                expect(toolManager.getSessionAutoApproveTools(sessionId)).toEqual(tools);
            });

            it('should normalize local tool aliases when setting auto-approve tools', () => {
                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [
                        {
                            id: 'bash_exec',
                            aliases: ['bash'],
                            description: 'Test bash tool',
                            inputSchema: z.object({}).strict(),
                            execute: () => null,
                        },
                    ],
                    mockLogger
                );

                const sessionId = 'test-session-123';
                toolManager.setSessionAutoApproveTools(sessionId, ['BASH']);

                expect(toolManager.getSessionAutoApproveTools(sessionId)).toEqual(['bash_exec']);
            });

            it('should return false/undefined for non-existent sessions', () => {
                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [],
                    mockLogger
                );

                expect(toolManager.hasSessionAutoApproveTools('non-existent')).toBe(false);
                expect(toolManager.getSessionAutoApproveTools('non-existent')).toBeUndefined();
            });

            it('should clear session auto-approve tools', () => {
                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [],
                    mockLogger
                );

                const sessionId = 'test-session-123';
                toolManager.setSessionAutoApproveTools(sessionId, ['bash_exec']);

                expect(toolManager.hasSessionAutoApproveTools(sessionId)).toBe(true);

                toolManager.clearSessionAutoApproveTools(sessionId);

                expect(toolManager.hasSessionAutoApproveTools(sessionId)).toBe(false);
                expect(toolManager.getSessionAutoApproveTools(sessionId)).toBeUndefined();
            });

            it('should handle multiple sessions independently', () => {
                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [],
                    mockLogger
                );

                const session1 = 'session-1';
                const session2 = 'session-2';

                toolManager.setSessionAutoApproveTools(session1, ['bash_exec']);
                toolManager.setSessionAutoApproveTools(session2, [
                    'mcp--read_file',
                    'mcp--write_file',
                ]);

                expect(toolManager.getSessionAutoApproveTools(session1)).toEqual(['bash_exec']);
                expect(toolManager.getSessionAutoApproveTools(session2)).toEqual([
                    'mcp--read_file',
                    'mcp--write_file',
                ]);

                // Clearing one session should not affect the other
                toolManager.clearSessionAutoApproveTools(session1);

                expect(toolManager.hasSessionAutoApproveTools(session1)).toBe(false);
                expect(toolManager.hasSessionAutoApproveTools(session2)).toBe(true);
            });

            it('should overwrite existing tools when setting again', () => {
                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [],
                    mockLogger
                );

                const sessionId = 'test-session';
                toolManager.setSessionAutoApproveTools(sessionId, ['tool1']);
                toolManager.setSessionAutoApproveTools(sessionId, ['tool2', 'tool3']);

                expect(toolManager.getSessionAutoApproveTools(sessionId)).toEqual([
                    'tool2',
                    'tool3',
                ]);
            });

            it('should clear auto-approvals when setting empty array', () => {
                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [],
                    mockLogger
                );

                const sessionId = 'test-session';

                // First set some tools
                toolManager.setSessionAutoApproveTools(sessionId, ['bash_exec']);
                expect(toolManager.hasSessionAutoApproveTools(sessionId)).toBe(true);

                // Setting empty array should clear auto-approvals
                toolManager.setSessionAutoApproveTools(sessionId, []);

                expect(toolManager.hasSessionAutoApproveTools(sessionId)).toBe(false);
                expect(toolManager.getSessionAutoApproveTools(sessionId)).toBeUndefined();
            });
        });

        describe('Auto-Approve Precedence', () => {
            it('should auto-approve tools in session auto-approve list', async () => {
                (mockMcpManager.getAllTools as ReturnType<typeof vi.fn>).mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'A test tool',
                        inputSchema: {},
                    },
                });
                (mockMcpManager.executeTool as ReturnType<typeof vi.fn>).mockResolvedValue(
                    'success'
                );

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual', // Manual mode - normally requires approval
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [],
                    mockLogger
                );

                const sessionId = 'test-session';
                toolManager.setSessionAutoApproveTools(sessionId, ['mcp--test_tool']);

                // Execute tool with sessionId
                await toolManager.executeTool('mcp--test_tool', {}, 'call-1', sessionId);

                // Should NOT have requested approval (auto-approved by session config)
                expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
                expect(mockMcpManager.executeTool).toHaveBeenCalledWith('test_tool', {}, sessionId);
            });

            it('should still require approval for tools NOT in session auto-approve list', async () => {
                (mockMcpManager.getAllTools as ReturnType<typeof vi.fn>).mockResolvedValue({
                    allowed_tool: {
                        name: 'allowed_tool',
                        description: 'Allowed tool',
                        inputSchema: {},
                    },
                    other_tool: {
                        name: 'other_tool',
                        description: 'Other tool',
                        inputSchema: {},
                    },
                });
                (mockMcpManager.executeTool as ReturnType<typeof vi.fn>).mockResolvedValue(
                    'success'
                );

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [],
                    mockLogger
                );

                const sessionId = 'test-session';
                toolManager.setSessionAutoApproveTools(sessionId, ['mcp--allowed_tool']);

                // Execute a tool NOT in the auto-approve list
                await toolManager.executeTool('mcp--other_tool', {}, 'call-1', sessionId);

                // Should have requested approval
                expect(mockApprovalManager.requestToolApproval).toHaveBeenCalled();
            });

            it('should respect alwaysDeny even if tool is in session auto-approve', async () => {
                (mockMcpManager.getAllTools as ReturnType<typeof vi.fn>).mockResolvedValue({
                    dangerous_tool: {
                        name: 'dangerous_tool',
                        description: 'A dangerous tool',
                        inputSchema: {},
                    },
                });

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: ['mcp--dangerous_tool'] }, // In deny list (full qualified name)
                    [],
                    mockLogger
                );

                const sessionId = 'test-session';
                toolManager.setSessionAutoApproveTools(sessionId, ['mcp--dangerous_tool']);

                // Should throw because alwaysDeny takes precedence
                await expect(
                    toolManager.executeTool('mcp--dangerous_tool', {}, 'call-1', sessionId)
                ).rejects.toThrow();

                expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
            });

            it('should not auto-approve if sessionId does not match', async () => {
                (mockMcpManager.getAllTools as ReturnType<typeof vi.fn>).mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'A test tool',
                        inputSchema: {},
                    },
                });
                (mockMcpManager.executeTool as ReturnType<typeof vi.fn>).mockResolvedValue(
                    'success'
                );

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [],
                    mockLogger
                );

                // Set auto-approve for session-1
                toolManager.setSessionAutoApproveTools('session-1', ['mcp--test_tool']);

                // Execute with different session
                await toolManager.executeTool('mcp--test_tool', {}, 'call-1', 'session-2');

                // Should have requested approval (different session)
                expect(mockApprovalManager.requestToolApproval).toHaveBeenCalled();
            });

            it('should not auto-approve when no sessionId provided', async () => {
                (mockMcpManager.getAllTools as ReturnType<typeof vi.fn>).mockResolvedValue({
                    test_tool: {
                        name: 'test_tool',
                        description: 'A test tool',
                        inputSchema: {},
                    },
                });
                (mockMcpManager.executeTool as ReturnType<typeof vi.fn>).mockResolvedValue(
                    'success'
                );

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [], alwaysDeny: [] },
                    [],
                    mockLogger
                );

                toolManager.setSessionAutoApproveTools('session-1', ['mcp--test_tool']);

                // Execute without sessionId
                await toolManager.executeTool('mcp--test_tool', {}, 'call-1');

                // Should have requested approval (no sessionId means no session auto-approve)
                expect(mockApprovalManager.requestToolApproval).toHaveBeenCalled();
            });
        });
    });
});
