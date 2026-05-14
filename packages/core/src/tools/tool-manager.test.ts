import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import {
    ToolManager,
    type RecordedToolApproval,
    type ApprovalRequiredPreparedToolCall,
} from './tool-manager.js';
import { defineTool } from './define-tool.js';
import { createApprovalRequest } from '../approval/factory.js';
import { MCPManager } from '../mcp/manager.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ToolErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { AgentEventBus } from '../events/index.js';
import type { ApprovalManager } from '../approval/manager.js';
import type { AllowedToolsProvider } from './approval/allowed-tools-provider/types.js';
import { ApprovalStatus, ApprovalType } from '../approval/types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { SessionError } from '../session/errors.js';
import { createInMemorySessionToolPreferencesStore } from '../test-utils/session-state-stores.js';
import type { SessionToolPreferences } from './session-tool-preferences-store.js';
import { createAgentRunContext } from '../runtime/run-context.js';
import { InMemoryDextoStores } from '../storage/index.js';
import { createToolExecutionId } from '../storage/tool-executions/types.js';

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

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
    const toolManager = new ToolManager(
        ...args,
        createInMemorySessionToolPreferencesStore(logger),
        new InMemoryDextoStores().getStore('toolExecutions')
    );
    toolManager.setToolExecutionContextFactory((baseContext) => baseContext);
    return toolManager;
}

function createRecordedToolApproval(
    prepared: ApprovalRequiredPreparedToolCall,
    approvalId: string
): RecordedToolApproval {
    return {
        prepared,
        request: createApprovalRequest(prepared.requestDetails, approvalId),
    };
}

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
            recordApprovalRequest: vi.fn().mockImplementation(async (details) => ({
                approvalId: 'recorded-approval-id',
                timestamp: new Date('2026-05-11T00:00:00.000Z'),
                ...details,
            })),
            recordApprovalResponse: vi.fn().mockResolvedValue({
                approvalId: 'recorded-approval-id',
                status: ApprovalStatus.APPROVED,
                data: { rememberChoice: false },
            }),
            recordApprovalResponseRecord: vi.fn().mockImplementation(async (decision) => ({
                status: 'created',
                response: {
                    approvalId: decision.approvalId,
                    status: decision.status,
                    ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
                    ...(decision.message !== undefined ? { message: decision.message } : {}),
                    ...(decision.data !== undefined ? { data: decision.data } : {}),
                },
            })),
            requestApprovalDecision: vi.fn().mockImplementation(async (request) => {
                const response = await mockApprovalManager.requestToolApproval({
                    ...request.metadata,
                    ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
                    ...(request.hostRuntime !== undefined
                        ? { hostRuntime: request.hostRuntime }
                        : {}),
                });
                return {
                    ...response,
                    approvalId: request.approvalId,
                };
            }),
            addApprovedDirectory: vi.fn(),
            isDirectorySessionApproved: vi.fn().mockReturnValue(false),
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
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            expect(toolManager.getToolSource('mcp--file_read')).toBe('mcp');
            expect(toolManager.getToolSource('mcp--web_search')).toBe('mcp');
        });

        it('should correctly identify local tools', () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            expect(toolManager.getToolSource('invalid_tool')).toBe('unknown');
            expect(toolManager.getToolSource('file_read')).toBe('unknown'); // No prefix
            expect(toolManager.getToolSource('')).toBe('unknown'); // Empty
        });

        it('should handle edge cases with empty tool names', () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            expect(toolManager.getToolSource('mcp--')).toBe('unknown'); // Prefix but no name
        });
    });

    describe('Tool Execution Preparation', () => {
        it('prepares a local tool as ready without executing it in auto-approve mode', async () => {
            const execute = vi.fn().mockResolvedValue('should not run');
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'typed',
                        description: 'Typed tool',
                        inputSchema: z.object({ count: z.number() }).strict(),
                        execute,
                    }),
                ],
                mockLogger
            );

            const prepared = await toolManager.prepareToolCall({
                toolName: 'typed',
                input: { count: 5 },
                toolCallId: 'call-1',
                sessionId: 'session-1',
            });

            expect(prepared).toEqual(
                expect.objectContaining({
                    kind: 'ready',
                    call: expect.objectContaining({
                        toolName: 'typed',
                        toolCallId: 'call-1',
                        input: { count: 5 },
                        source: 'local',
                    }),
                })
            );
            expect(execute).not.toHaveBeenCalled();
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
        });

        it('prepares a local tool as approval-required in manual mode without requesting approval', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute: vi.fn(),
                    }),
                ],
                mockLogger
            );

            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-2',
                sessionId: 'session-1',
            });

            expect(prepared).toEqual(
                expect.objectContaining({
                    kind: 'approval-required',
                    call: expect.objectContaining({
                        toolName: 'write_file',
                        input: { path: 'src/app.ts' },
                    }),
                    requestDetails: expect.objectContaining({
                        type: ApprovalType.TOOL_APPROVAL,
                        sessionId: 'session-1',
                        metadata: expect.objectContaining({
                            toolName: 'write_file',
                            toolCallId: 'call-2',
                            args: { path: 'src/app.ts' },
                        }),
                    }),
                })
            );
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
        });

        it('uses the run context session for approval preparation', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute: vi.fn(),
                    }),
                ],
                mockLogger
            );

            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-run-context',
                runContext: createAgentRunContext({ sessionId: 'run-session' }),
            });

            expect(prepared.kind).toBe('approval-required');
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }
            expect(prepared.requestDetails.sessionId).toBe('run-session');
            expect(mockAllowedToolsProvider.isToolAllowed).toHaveBeenCalledWith(
                'write_file',
                'run-session'
            );
        });

        it('prepares directory access approvals with preview data without granting access', async () => {
            const execute = vi.fn();
            const preview = vi.fn().mockResolvedValue({
                type: 'diff',
                unified: 'diff --git a/x b/x',
                filename: '/tmp/example.txt',
                additions: 1,
                deletions: 0,
            });
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'fs_like_tool',
                        description: 'Filesystem-like tool',
                        inputSchema: z.object({ file_path: z.string() }).strict(),
                        approval: {
                            override: vi.fn().mockReturnValue({
                                type: ApprovalType.DIRECTORY_ACCESS,
                                metadata: {
                                    path: '/tmp/example.txt',
                                    parentDir: '/tmp',
                                    operation: 'write',
                                    toolName: 'fs_like_tool',
                                },
                            }),
                        },
                        presentation: { preview },
                        execute,
                    }),
                ],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            const prepared = await toolManager.prepareToolCall({
                toolName: 'fs_like_tool',
                input: { file_path: '/tmp/example.txt' },
                toolCallId: 'call-dir',
                sessionId: 'session-1',
            });

            expect(prepared.kind).toBe('approval-required');
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }
            expect(prepared.requestDetails).toEqual(
                expect.objectContaining({
                    type: ApprovalType.TOOL_APPROVAL,
                    sessionId: 'session-1',
                    metadata: expect.objectContaining({
                        toolName: 'fs_like_tool',
                        toolCallId: 'call-dir',
                        args: { file_path: '/tmp/example.txt' },
                        directoryAccess: expect.objectContaining({
                            parentDir: '/tmp',
                            operation: 'write',
                        }),
                        displayPreview: expect.objectContaining({
                            type: 'diff',
                            filename: '/tmp/example.txt',
                        }),
                        presentationSnapshot: expect.any(Object),
                    }),
                })
            );
            expect(preview).toHaveBeenCalledWith(
                { file_path: '/tmp/example.txt' },
                expect.objectContaining({
                    sessionId: 'session-1',
                    toolCallId: 'call-dir',
                })
            );
            expect(execute).not.toHaveBeenCalled();
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            expect(mockApprovalManager.addApprovedDirectory).not.toHaveBeenCalled();
        });

        it('prepares custom approval overrides as mandatory even when policy would allow the tool', async () => {
            const execute = vi.fn();
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: ['custom_gate'] },
                [
                    defineTool({
                        id: 'custom_gate',
                        description: 'Custom gated tool',
                        inputSchema: z.object({ value: z.string() }).strict(),
                        approval: {
                            override: vi.fn().mockReturnValue({
                                type: ApprovalType.CUSTOM,
                                metadata: { reason: 'external-policy' },
                            }),
                        },
                        execute,
                    }),
                ],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            const prepared = await toolManager.prepareToolCall({
                toolName: 'custom_gate',
                input: { value: 'x' },
                toolCallId: 'call-custom',
                sessionId: 'session-1',
            });

            expect(prepared).toEqual(
                expect.objectContaining({
                    kind: 'approval-required',
                    requestDetails: expect.objectContaining({
                        type: ApprovalType.CUSTOM,
                        sessionId: 'session-1',
                        metadata: { reason: 'external-policy' },
                    }),
                })
            );
            expect(execute).not.toHaveBeenCalled();
            expect(mockApprovalManager.requestApproval).not.toHaveBeenCalled();
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
        });

        it('prepares invalid local input as a model-visible invalid-input result', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'typed',
                        description: 'Typed tool',
                        inputSchema: z.object({ count: z.number() }).strict(),
                        execute: vi.fn(),
                    }),
                ],
                mockLogger
            );

            const prepared = await toolManager.prepareToolCall({
                toolName: 'typed',
                input: { count: 'wrong' },
                toolCallId: 'call-3',
                sessionId: 'session-1',
            });

            expect(prepared.kind).toBe('terminal');
            if (prepared.kind !== 'terminal') {
                throw new Error('Expected invalid-input prepared');
            }
            expect(prepared.reason).toBe('invalid-input');
            expect(prepared.modelVisibleResult.result).toEqual(
                expect.objectContaining({
                    error: expect.stringContaining('Invalid arguments'),
                })
            );
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
        });

        it('prepares unknown tools as model-visible unknown-tool results', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            const prepared = await toolManager.prepareToolCall({
                toolName: 'missing',
                input: {},
                toolCallId: 'call-4',
            });

            expect(prepared.kind).toBe('terminal');
            if (prepared.kind !== 'terminal') {
                throw new Error('Expected unknown-tool prepared');
            }
            expect(prepared.reason).toBe('unknown-tool');
            expect(prepared.modelVisibleResult.result).toEqual(
                expect.objectContaining({
                    error: expect.stringContaining("Tool 'missing' not found"),
                })
            );
            expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
        });

        it('prepares discovered MCP tools without executing them', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({
                read_file: {
                    name: 'read_file',
                    description: 'Read file',
                    parameters: {
                        type: 'object',
                        properties: { path: { type: 'string' } },
                        required: ['path'],
                        additionalProperties: false,
                    },
                },
            });
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            const prepared = await toolManager.prepareToolCall({
                toolName: 'mcp--read_file',
                input: { path: '/tmp/file.txt' },
                toolCallId: 'call-5',
                sessionId: 'session-1',
            });

            expect(prepared).toEqual(
                expect.objectContaining({
                    kind: 'ready',
                    call: expect.objectContaining({
                        toolName: 'mcp--read_file',
                        source: 'mcp',
                        input: { path: '/tmp/file.txt' },
                    }),
                })
            );
            expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
        });

        it('records a prepared approval request with stable turn identity', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute: vi.fn(),
                    }),
                ],
                mockLogger
            );
            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-record',
                sessionId: 'session-1',
            });

            expect(prepared.kind).toBe('approval-required');
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }

            await expect(
                toolManager.recordApprovalRequest(prepared, {
                    runId: 'run-1',
                    turnId: 'turn-1',
                    modelStepId: 'step-1',
                })
            ).resolves.toEqual(
                expect.objectContaining({
                    prepared,
                    request: expect.objectContaining({
                        approvalId: 'recorded-approval-id',
                        type: ApprovalType.TOOL_APPROVAL,
                        sessionId: 'session-1',
                    }),
                })
            );
            expect(mockApprovalManager.recordApprovalRequest).toHaveBeenCalledWith(
                prepared.requestDetails,
                {
                    runId: 'run-1',
                    turnId: 'turn-1',
                    modelStepId: 'step-1',
                    toolCallId: 'call-record',
                }
            );
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
        });

        it('applies an approved recorded decision and returns a ready tool call', async () => {
            const execute = vi.fn();
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger
            );
            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-apply',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }
            mockApprovalManager.recordApprovalResponseRecord = vi.fn().mockResolvedValue({
                status: 'created',
                response: {
                    approvalId: '00000000-0000-4000-8000-000000000001',
                    sessionId: 'session-1',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberChoice: true },
                },
            });
            const recorded = createRecordedToolApproval(
                prepared,
                '00000000-0000-4000-8000-000000000001'
            );

            await expect(
                toolManager.applyApprovalDecision(recorded, {
                    approvalId: '00000000-0000-4000-8000-000000000001',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberChoice: true },
                })
            ).resolves.toEqual({
                kind: 'ready',
                call: {
                    ...prepared.call,
                    approval: {
                        requireApproval: true,
                        approvalStatus: 'approved',
                    },
                },
                response: expect.objectContaining({
                    approvalId: '00000000-0000-4000-8000-000000000001',
                    status: ApprovalStatus.APPROVED,
                }),
            });
            expect(mockAllowedToolsProvider.allowTool).toHaveBeenCalledWith(
                'write_file',
                'session-1'
            );
            expect(mockApprovalManager.recordApprovalResponseRecord).toHaveBeenCalledWith(
                {
                    approvalId: '00000000-0000-4000-8000-000000000001',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberChoice: true },
                },
                recorded.request
            );
            expect(execute).not.toHaveBeenCalled();
        });

        it('applies a denied recorded decision as one model-visible terminal result', async () => {
            const execute = vi.fn();
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger
            );
            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-denied-decision',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }
            mockApprovalManager.recordApprovalResponseRecord = vi.fn().mockResolvedValue({
                status: 'created',
                response: {
                    approvalId: '00000000-0000-4000-8000-000000000002',
                    sessionId: 'session-1',
                    status: ApprovalStatus.DENIED,
                    reason: 'user_denied',
                    message: 'No writes right now',
                },
            });
            const recorded = createRecordedToolApproval(
                prepared,
                '00000000-0000-4000-8000-000000000002'
            );

            await expect(
                toolManager.applyApprovalDecision(recorded, {
                    approvalId: '00000000-0000-4000-8000-000000000002',
                    status: ApprovalStatus.DENIED,
                    reason: 'user_denied',
                    message: 'No writes right now',
                })
            ).resolves.toEqual({
                kind: 'terminal',
                modelVisibleResult: expect.objectContaining({
                    requireApproval: true,
                    approvalStatus: 'rejected',
                    result: expect.objectContaining({
                        error: expect.stringContaining('No writes right now'),
                    }),
                }),
                response: expect.objectContaining({
                    approvalId: '00000000-0000-4000-8000-000000000002',
                    status: ApprovalStatus.DENIED,
                }),
            });
            expect(execute).not.toHaveBeenCalled();
            expect(mockAllowedToolsProvider.allowTool).not.toHaveBeenCalled();
        });

        it('applies a timed-out recorded decision as one model-visible terminal result', async () => {
            const execute = vi.fn();
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger
            );
            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-timeout-decision',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }
            mockApprovalManager.recordApprovalResponseRecord = vi.fn().mockResolvedValue({
                status: 'created',
                response: {
                    approvalId: '00000000-0000-4000-8000-000000000003',
                    sessionId: 'session-1',
                    status: ApprovalStatus.CANCELLED,
                    reason: 'timeout',
                    timeoutMs: 120000,
                },
            });
            const recorded = createRecordedToolApproval(
                prepared,
                '00000000-0000-4000-8000-000000000003'
            );

            await expect(
                toolManager.applyApprovalDecision(recorded, {
                    approvalId: '00000000-0000-4000-8000-000000000003',
                    status: ApprovalStatus.CANCELLED,
                    reason: 'timeout',
                    timeoutMs: 120000,
                })
            ).resolves.toEqual({
                kind: 'terminal',
                modelVisibleResult: expect.objectContaining({
                    requireApproval: true,
                    approvalStatus: 'rejected',
                    result: {
                        error: "Tool 'write_file' was not executed because approval timed out after 120000ms.",
                    },
                }),
                response: expect.objectContaining({
                    approvalId: '00000000-0000-4000-8000-000000000003',
                    status: ApprovalStatus.CANCELLED,
                }),
            });
            expect(execute).not.toHaveBeenCalled();
            expect(mockAllowedToolsProvider.allowTool).not.toHaveBeenCalled();
        });

        it('applies a cancelled recorded decision as one model-visible terminal result', async () => {
            const execute = vi.fn();
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger
            );
            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-cancelled-decision',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }
            mockApprovalManager.recordApprovalResponseRecord = vi.fn().mockResolvedValue({
                status: 'created',
                response: {
                    approvalId: '00000000-0000-4000-8000-000000000008',
                    sessionId: 'session-1',
                    status: ApprovalStatus.CANCELLED,
                    reason: 'user_cancelled',
                    message: 'Stopped by user',
                },
            });
            const recorded = createRecordedToolApproval(
                prepared,
                '00000000-0000-4000-8000-000000000008'
            );

            await expect(
                toolManager.applyApprovalDecision(recorded, {
                    approvalId: '00000000-0000-4000-8000-000000000008',
                    status: ApprovalStatus.CANCELLED,
                    reason: 'user_cancelled',
                    message: 'Stopped by user',
                })
            ).resolves.toEqual({
                kind: 'terminal',
                modelVisibleResult: expect.objectContaining({
                    requireApproval: true,
                    approvalStatus: 'rejected',
                    result: {
                        error: "Tool 'write_file' was not executed because approval was cancelled: Stopped by user.",
                    },
                }),
                response: expect.objectContaining({
                    approvalId: '00000000-0000-4000-8000-000000000008',
                    status: ApprovalStatus.CANCELLED,
                }),
            });
            expect(execute).not.toHaveBeenCalled();
            expect(mockAllowedToolsProvider.allowTool).not.toHaveBeenCalled();
        });

        it('rejects applying an approval response to a different prepared tool call', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute: vi.fn(),
                    }),
                ],
                mockLogger
            );
            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-mismatch',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }
            mockApprovalManager.recordApprovalResponseRecord = vi.fn().mockResolvedValue({
                status: 'created',
                response: {
                    approvalId: '00000000-0000-4000-8000-000000000004',
                    sessionId: 'session-1',
                    status: ApprovalStatus.APPROVED,
                },
            });

            await expect(
                toolManager.applyApprovalDecision(
                    {
                        prepared,
                        request: createApprovalRequest(
                            {
                                type: ApprovalType.TOOL_APPROVAL,
                                sessionId: 'session-1',
                                metadata: {
                                    toolName: 'write_file',
                                    toolCallId: 'other-call',
                                    args: { path: 'other.ts' },
                                },
                            },
                            '00000000-0000-4000-8000-000000000004'
                        ),
                    },
                    {
                        approvalId: '00000000-0000-4000-8000-000000000004',
                        status: ApprovalStatus.APPROVED,
                    }
                )
            ).rejects.toThrow(/Recorded approval request does not match/);
            expect(mockApprovalManager.recordApprovalResponseRecord).not.toHaveBeenCalled();
        });

        it('rejects applying a decision for a different approval before recording it', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute: vi.fn(),
                    }),
                ],
                mockLogger
            );
            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-decision-mismatch',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }
            const recorded = createRecordedToolApproval(
                prepared,
                '00000000-0000-4000-8000-000000000005'
            );

            await expect(
                toolManager.applyApprovalDecision(recorded, {
                    approvalId: '00000000-0000-4000-8000-000000000006',
                    status: ApprovalStatus.APPROVED,
                })
            ).rejects.toThrow(/Approval decision does not match/);
            expect(mockApprovalManager.recordApprovalResponseRecord).not.toHaveBeenCalled();
        });

        it('rejects mismatched approval granted-effects requests before recording a decision', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute: vi.fn(),
                    }),
                ],
                mockLogger
            );
            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-granted-mismatch',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }
            const mismatchedPreparation = {
                ...prepared,
                onGrantedRequestDetails: {
                    type: ApprovalType.DIRECTORY_ACCESS,
                    sessionId: 'session-1',
                    metadata: {
                        path: '/tmp/other.ts',
                        parentDir: '/tmp',
                        operation: 'write',
                        toolName: 'write_file',
                    },
                },
            };

            await expect(
                toolManager.applyApprovalDecision(
                    {
                        prepared: mismatchedPreparation,
                        request: createApprovalRequest(
                            mismatchedPreparation.requestDetails,
                            '00000000-0000-4000-8000-000000000007'
                        ),
                    },
                    {
                        approvalId: '00000000-0000-4000-8000-000000000007',
                        status: ApprovalStatus.APPROVED,
                    }
                )
            ).rejects.toThrow(/granted-effects request does not match/);
            expect(mockApprovalManager.recordApprovalResponseRecord).not.toHaveBeenCalled();
        });

        it('applies approved replayed decisions because execution idempotency owns dedupe', async () => {
            const execute = vi.fn();
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger
            );
            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-replayed-decision',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }
            mockApprovalManager.recordApprovalResponseRecord = vi.fn().mockResolvedValue({
                status: 'replayed',
                response: {
                    approvalId: '00000000-0000-4000-8000-000000000007',
                    sessionId: 'session-1',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberChoice: true },
                },
            });
            const recorded = createRecordedToolApproval(
                prepared,
                '00000000-0000-4000-8000-000000000007'
            );

            await expect(
                toolManager.applyApprovalDecision(recorded, {
                    approvalId: '00000000-0000-4000-8000-000000000007',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberChoice: true },
                })
            ).resolves.toEqual({
                kind: 'ready',
                call: {
                    ...prepared.call,
                    approval: {
                        requireApproval: true,
                        approvalStatus: 'approved',
                    },
                },
                response: expect.objectContaining({
                    approvalId: '00000000-0000-4000-8000-000000000007',
                    status: ApprovalStatus.APPROVED,
                }),
            });
            expect(mockAllowedToolsProvider.allowTool).toHaveBeenCalledWith(
                'write_file',
                'session-1'
            );
            expect(execute).not.toHaveBeenCalled();
        });

        it('applies directory approval onGranted effects with the original directory request', async () => {
            const onGranted = vi.fn();
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'fs_like_tool',
                        description: 'Filesystem-like tool',
                        inputSchema: z.object({ file_path: z.string() }).strict(),
                        approval: {
                            override: vi.fn().mockReturnValue({
                                type: ApprovalType.DIRECTORY_ACCESS,
                                metadata: {
                                    path: '/tmp/example.txt',
                                    parentDir: '/tmp',
                                    operation: 'write',
                                    toolName: 'fs_like_tool',
                                },
                            }),
                            onGranted,
                        },
                        execute: vi.fn(),
                    }),
                ],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);
            const prepared = await toolManager.prepareToolCall({
                toolName: 'fs_like_tool',
                input: { file_path: '/tmp/example.txt' },
                toolCallId: 'call-dir-apply',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }
            mockApprovalManager.recordApprovalResponseRecord = vi.fn().mockResolvedValue({
                status: 'created',
                response: {
                    approvalId: '00000000-0000-4000-8000-000000000005',
                    sessionId: 'session-1',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                },
            });
            const recorded = createRecordedToolApproval(
                prepared,
                '00000000-0000-4000-8000-000000000005'
            );

            await toolManager.applyApprovalDecision(recorded, {
                approvalId: '00000000-0000-4000-8000-000000000005',
                status: ApprovalStatus.APPROVED,
                data: { rememberDirectory: true },
            });

            expect(onGranted).toHaveBeenCalledWith(
                expect.objectContaining({ status: ApprovalStatus.APPROVED }),
                expect.objectContaining({
                    sessionId: 'session-1',
                    toolCallId: 'call-dir-apply',
                }),
                expect.objectContaining({
                    type: ApprovalType.DIRECTORY_ACCESS,
                    metadata: expect.objectContaining({
                        parentDir: '/tmp',
                        operation: 'write',
                    }),
                })
            );
            expect(mockApprovalManager.autoApprovePendingRequests).toHaveBeenCalledWith(
                expect.any(Function),
                { rememberDirectory: false }
            );
        });

        it('executes a prepared local tool call without re-validating or requesting approval', async () => {
            const inputSchema = z.object({ count: z.coerce.number() }).strict();
            const safeParse = vi.spyOn(inputSchema, 'safeParse');
            const execute = vi.fn().mockResolvedValue({ ok: true });
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'typed',
                        description: 'Typed tool',
                        inputSchema,
                        execute,
                    }),
                ],
                mockLogger
            );
            const prepared = await toolManager.prepareToolCall({
                toolName: 'typed',
                input: { count: '5' },
                toolCallId: 'call-prepared-local',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'ready') {
                throw new Error('Expected ready prepared call');
            }

            await expect(toolManager.executePreparedToolCall(prepared.call)).resolves.toEqual(
                expect.objectContaining({
                    result: { ok: true },
                    presentationSnapshot: expect.objectContaining({
                        header: expect.objectContaining({
                            title: 'Typed',
                        }),
                    }),
                })
            );
            expect(safeParse).toHaveBeenCalledTimes(1);
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            expect(mockApprovalManager.requestApproval).not.toHaveBeenCalled();
            expect(mockApprovalManager.recordApprovalRequest).not.toHaveBeenCalled();
            expect(mockApprovalManager.recordApprovalResponseRecord).not.toHaveBeenCalled();
            expect(execute).toHaveBeenCalledWith(
                { count: 5 },
                expect.objectContaining({ toolCallId: 'call-prepared-local' })
            );
        });

        it('executes a prepared MCP tool call through the normalized MCP name', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({
                'filesystem--read_file': {
                    description: 'Read file',
                    parameters: {
                        type: 'object',
                        properties: { path: { type: 'string' } },
                        required: ['path'],
                    },
                },
            });
            mockMcpManager.executeTool = vi.fn().mockResolvedValue({ content: 'hello' });
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );
            const prepared = await toolManager.prepareToolCall({
                toolName: 'mcp--filesystem--read_file',
                input: { path: '/tmp/file.txt' },
                toolCallId: 'call-prepared-mcp',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'ready') {
                throw new Error('Expected ready prepared call');
            }

            await expect(
                toolManager.executePreparedToolCall(prepared.call, { sessionId: 'session-1' })
            ).resolves.toEqual(
                expect.objectContaining({
                    result: { content: 'hello' },
                })
            );
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            expect(mockMcpManager.executeTool).toHaveBeenCalledWith(
                'filesystem--read_file',
                { path: '/tmp/file.txt' },
                'session-1'
            );
        });

        it('preserves approved approval metadata in prepared execution results', async () => {
            const execute = vi.fn().mockResolvedValue('written');
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger
            );
            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-prepared-approved',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'approval-required') {
                throw new Error('Expected approval-required prepared call');
            }
            mockApprovalManager.recordApprovalResponseRecord = vi.fn().mockResolvedValue({
                status: 'created',
                response: {
                    approvalId: '00000000-0000-4000-8000-000000000009',
                    sessionId: 'session-1',
                    status: ApprovalStatus.APPROVED,
                },
            });
            const recorded = createRecordedToolApproval(
                prepared,
                '00000000-0000-4000-8000-000000000009'
            );
            const application = await toolManager.applyApprovalDecision(recorded, {
                approvalId: '00000000-0000-4000-8000-000000000009',
                status: ApprovalStatus.APPROVED,
            });
            if (application.kind !== 'ready') {
                throw new Error('Expected ready approval application');
            }

            await expect(toolManager.executePreparedToolCall(application.call)).resolves.toEqual(
                expect.objectContaining({
                    result: 'written',
                    requireApproval: true,
                    approvalStatus: 'approved',
                })
            );
        });

        it('replays a completed prepared tool execution without running the tool again', async () => {
            const execute = vi.fn().mockResolvedValueOnce('created');
            const toolExecutionStore = new InMemoryDextoStores().getStore('toolExecutions');
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger,
                createInMemorySessionToolPreferencesStore(mockLogger),
                toolExecutionStore
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);
            const executionIdentity = {
                runId: 'run-1',
                turnId: 'turn-1',
                modelStepId: 'step-1',
                toolCallId: 'call-prepared-replay',
            };
            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-prepared-replay',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'ready') {
                throw new Error('Expected ready prepared call');
            }

            const first = await toolManager.executePreparedToolCall(prepared.call, {
                executionIdentity,
            });
            const replayed = await toolManager.executePreparedToolCall(prepared.call, {
                executionIdentity,
            });

            expect(first).toEqual(replayed);
            expect(execute).toHaveBeenCalledTimes(1);
            await expect(
                toolExecutionStore.get({
                    executionId: createToolExecutionId(executionIdentity),
                })
            ).resolves.toEqual(
                expect.objectContaining({
                    status: 'completed',
                    input: { path: 'src/app.ts' },
                    modelOutput: 'created',
                })
            );
        });

        it('rejects prepared execution replay when the stored input differs', async () => {
            const execute = vi.fn().mockResolvedValue('created');
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger
            );
            const executionIdentity = {
                runId: 'run-1',
                turnId: 'turn-1',
                modelStepId: 'step-1',
                toolCallId: 'call-prepared-mismatch',
            };
            const first = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-prepared-mismatch',
                sessionId: 'session-1',
            });
            const second = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/other.ts' },
                toolCallId: 'call-prepared-mismatch',
                sessionId: 'session-1',
            });
            if (first.kind !== 'ready' || second.kind !== 'ready') {
                throw new Error('Expected ready prepared calls');
            }

            await toolManager.executePreparedToolCall(first.call, { executionIdentity });

            await expect(
                toolManager.executePreparedToolCall(second.call, { executionIdentity })
            ).rejects.toThrow(/does not match the current tool call/);
        });

        it('returns and replays a model-visible failed result for prepared execution failures', async () => {
            const execute = vi.fn().mockRejectedValueOnce(new Error('disk full'));
            const toolExecutionStore = new InMemoryDextoStores().getStore('toolExecutions');
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger,
                createInMemorySessionToolPreferencesStore(mockLogger),
                toolExecutionStore
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);
            const executionIdentity = {
                runId: 'run-1',
                turnId: 'turn-1',
                modelStepId: 'step-1',
                toolCallId: 'call-prepared-failed',
            };
            const prepared = await toolManager.prepareToolCall({
                toolName: 'write_file',
                input: { path: 'src/app.ts' },
                toolCallId: 'call-prepared-failed',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'ready') {
                throw new Error('Expected ready prepared call');
            }

            const first = await toolManager.executePreparedToolCall(prepared.call, {
                executionIdentity,
            });
            const replayed = await toolManager.executePreparedToolCall(prepared.call, {
                executionIdentity,
            });

            expect(first).toEqual({
                result: { error: 'disk full' },
                presentationSnapshot: prepared.call.presentationSnapshot,
            });
            expect(replayed).toEqual(first);
            expect(execute).toHaveBeenCalledTimes(1);
            await expect(
                toolExecutionStore.get({
                    executionId: createToolExecutionId(executionIdentity),
                })
            ).resolves.toEqual(
                expect.objectContaining({
                    status: 'failed',
                    input: { path: 'src/app.ts' },
                    error: 'disk full',
                })
            );
        });

        it('runs before and after hooks around prepared local execution', async () => {
            const execute = vi.fn().mockResolvedValue('raw-result');
            const hookManager = {
                executeHooks: vi.fn().mockImplementation(async (hookName, payload) => {
                    if (hookName === 'beforeToolCall') {
                        return { ...payload, args: { name: 'hooked' } };
                    }
                    if (hookName === 'afterToolResult') {
                        return { ...payload, result: 'hooked-result' };
                    }
                    return payload;
                }),
            };
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'hello',
                        description: 'Say hello',
                        inputSchema: z.object({ name: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger
            );
            toolManager.setHookSupport(hookManager as any, {} as any, {} as any);
            const prepared = await toolManager.prepareToolCall({
                toolName: 'hello',
                input: { name: 'original' },
                toolCallId: 'call-prepared-hooks',
                sessionId: 'session-1',
            });
            if (prepared.kind !== 'ready') {
                throw new Error('Expected ready prepared call');
            }

            await expect(toolManager.executePreparedToolCall(prepared.call)).resolves.toEqual(
                expect.objectContaining({
                    result: 'hooked-result',
                })
            );
            expect(execute).toHaveBeenCalledWith(
                { name: 'hooked' },
                expect.objectContaining({ toolCallId: 'call-prepared-hooks' })
            );
            expect(hookManager.executeHooks).toHaveBeenCalledWith(
                'beforeToolCall',
                expect.objectContaining({
                    toolName: 'hello',
                    args: { name: 'original' },
                }),
                expect.objectContaining({ toolManager })
            );
            expect(hookManager.executeHooks).toHaveBeenCalledWith(
                'afterToolResult',
                expect.objectContaining({
                    toolName: 'hello',
                    result: 'raw-result',
                    success: true,
                }),
                expect.objectContaining({ toolManager })
            );
        });

        it('emits a background event for prepared calls when background execution is enabled', async () => {
            const originalEnv = process.env.DEXTO_BACKGROUND_TASKS_ENABLED;
            process.env.DEXTO_BACKGROUND_TASKS_ENABLED = 'true';
            try {
                mockMcpManager.getAllTools = vi.fn().mockResolvedValue({
                    read_file: {
                        description: 'Read file',
                        parameters: {
                            type: 'object',
                            properties: { path: { type: 'string' } },
                            required: ['path'],
                        },
                    },
                });
                const background = createDeferred<string>();
                mockMcpManager.executeTool = vi.fn().mockReturnValue(background.promise);
                const emitSpy = vi.fn();
                mockAgentEventBus.emit = emitSpy as typeof mockAgentEventBus.emit;
                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'auto-approve',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
                    [],
                    mockLogger
                );
                const prepared = await toolManager.prepareToolCall({
                    toolName: 'mcp--read_file',
                    input: {
                        path: '/tmp/file.txt',
                        __meta: {
                            runInBackground: true,
                            timeoutMs: 5000,
                        },
                    },
                    toolCallId: 'call-prepared-background',
                    sessionId: 'session-1',
                });
                if (prepared.kind !== 'ready') {
                    throw new Error('Expected ready prepared call');
                }

                const response = await toolManager.executePreparedToolCall(prepared.call, {
                    sessionId: 'session-1',
                });

                expect(response.result).toEqual({
                    taskId: 'call-prepared-background',
                    status: 'running',
                    description: 'MCP tool read_file',
                });
                const backgroundEvent = emitSpy.mock.calls.find(
                    ([eventName]) => eventName === 'tool:background'
                );
                expect(backgroundEvent).toEqual([
                    'tool:background',
                    expect.objectContaining({
                        toolName: 'mcp--read_file',
                        toolCallId: 'call-prepared-background',
                        sessionId: 'session-1',
                        timeoutMs: 5000,
                        promise: background.promise,
                    }),
                ]);
                background.resolve('background-result');
                await expect(background.promise).resolves.toBe('background-result');
            } finally {
                if (originalEnv === undefined) {
                    delete process.env.DEXTO_BACKGROUND_TASKS_ENABLED;
                } else {
                    process.env.DEXTO_BACKGROUND_TASKS_ENABLED = originalEnv;
                }
            }
        });
    });

    describe('Contributor Context', () => {
        it('includes session context when a session id is provided', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            const context = await toolManager.buildContributorContext({
                sessionId: 'session-123',
            });

            expect(context.session).toEqual({ id: 'session-123' });
        });

        it('preserves session context when contributor overrides add environment data', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            toolManager.setContributorContextFactory(() => ({
                environment: {
                    cwd: '/workspace',
                    platform: 'linux',
                },
            }));

            const context = await toolManager.buildContributorContext({
                sessionId: 'session-456',
            });

            expect(context.session).toEqual({ id: 'session-456' });
            expect(context.environment).toEqual({
                cwd: '/workspace',
                platform: 'linux',
            });
        });

        it('includes session prompt contributors when session manager support is configured', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            toolManager.setHookSupport(
                {} as any,
                {
                    getSessionSystemPromptContributors: vi.fn().mockResolvedValue([
                        {
                            id: 'peer-origin',
                            priority: 0,
                            content: 'Reply to the originating peer.',
                        },
                    ]),
                } as any,
                {} as any
            );

            const context = await toolManager.buildContributorContext({
                sessionId: 'session-789',
            });

            expect(context.session).toEqual({
                id: 'session-789',
                systemPromptContributors: [
                    {
                        id: 'peer-origin',
                        priority: 0,
                        content: 'Reply to the originating peer.',
                    },
                ],
            });
        });

        it('gracefully ignores missing sessions when building contributor context', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            toolManager.setHookSupport(
                {} as any,
                {
                    getSessionSystemPromptContributors: vi
                        .fn()
                        .mockRejectedValue(SessionError.notFound('missing-session')),
                } as any,
                {} as any
            );

            const context = await toolManager.buildContributorContext({
                sessionId: 'missing-session',
            });

            expect(context.session).toEqual({ id: 'missing-session' });
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Session not found while building contributor context',
                {
                    sessionId: 'missing-session',
                }
            );
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

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
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

        it('should reject invalid local tool args as validation failures', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'typed',
                        description: 'Typed tool',
                        inputSchema: z.object({ count: z.number() }).strict(),
                        execute: vi.fn(),
                    }),
                ],
                mockLogger
            );

            const error = (await toolManager
                .executeTool('typed', { count: 'wrong' }, 'test-call-id')
                .catch((e) => e)) as DextoRuntimeError;

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(ToolErrorCode.VALIDATION_FAILED);
            expect(error.scope).toBe(ErrorScope.TOOLS);
            expect(error.type).toBe(ErrorType.USER);
            expect(mockApprovalManager.recordApprovalRequest).not.toHaveBeenCalled();
        });
    });

    describe('Local Tool Execution', () => {
        it('should execute local tools provided to ToolManager', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
            expect(result).toEqual(expect.objectContaining({ result: 'Hello, World' }));
        });

        it('replays a completed durable execution without invoking the tool body again', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});
            const execute = vi.fn().mockResolvedValue('created file');
            const toolExecutionStore = new InMemoryDextoStores().getStore('toolExecutions');
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger,
                createInMemorySessionToolPreferencesStore(mockLogger),
                toolExecutionStore
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);
            const executionIdentity = {
                runId: 'run-1',
                turnId: 'turn-1',
                modelStepId: 'step-1',
                toolCallId: 'call-1',
            };

            const first = await toolManager.executeTool(
                'write_file',
                { path: 'snake/index.html' },
                'call-1',
                { sessionId: 'session-1', executionIdentity }
            );
            const replayed = await toolManager.executeTool(
                'write_file',
                { path: 'snake/index.html' },
                'call-1',
                { sessionId: 'session-1', executionIdentity }
            );

            expect(execute).toHaveBeenCalledTimes(1);
            expect(first).toEqual(expect.objectContaining({ result: 'created file' }));
            expect(replayed).toEqual(first);
            const toolCallEvents = (mockAgentEventBus.emit as any).mock.calls.filter(
                ([eventName]: [string]) => eventName === 'llm:tool-call'
            );
            expect(toolCallEvents).toHaveLength(2);
            await expect(
                toolExecutionStore.get({ executionId: createToolExecutionId(executionIdentity) })
            ).resolves.toEqual(
                expect.objectContaining({
                    status: 'completed',
                    modelOutput: 'created file',
                })
            );
        });

        it('replays a completed durable execution before manual approval can prompt again', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});
            const execute = vi.fn().mockResolvedValue('should not run');
            const toolExecutionStore = new InMemoryDextoStores().getStore('toolExecutions');
            const executionIdentity = {
                runId: 'run-1',
                turnId: 'turn-1',
                modelStepId: 'step-1',
                toolCallId: 'call-1',
            };
            const startedAt = new Date('2026-05-11T00:00:00.000Z');
            await toolExecutionStore.start({
                record: {
                    executionId: createToolExecutionId(executionIdentity),
                    identity: executionIdentity,
                    input: { path: 'snake/index.html' },
                    toolName: 'write_file',
                    status: 'running',
                    startedAt,
                    updatedAt: startedAt,
                },
            });
            await toolExecutionStore.complete({
                executionId: createToolExecutionId(executionIdentity),
                completedAt: new Date('2026-05-11T00:00:01.000Z'),
                result: {
                    result: 'created file',
                    requireApproval: true,
                    approvalStatus: 'approved',
                },
            });
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger,
                createInMemorySessionToolPreferencesStore(mockLogger),
                toolExecutionStore
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await expect(
                toolManager.executeTool('write_file', { path: 'snake/index.html' }, 'call-1', {
                    sessionId: 'session-1',
                    executionIdentity,
                })
            ).resolves.toEqual({
                result: 'created file',
                requireApproval: true,
                approvalStatus: 'approved',
            });
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            expect(mockApprovalManager.recordApprovalRequest).not.toHaveBeenCalled();
            expect(mockApprovalManager.requestApprovalDecision).not.toHaveBeenCalled();
            expect(mockApprovalManager.recordApprovalResponseRecord).not.toHaveBeenCalled();
            expect(execute).not.toHaveBeenCalled();
        });

        it('rejects a durable replay when the current tool call does not match the record', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});
            const execute = vi.fn().mockResolvedValue('should not run');
            const toolExecutionStore = new InMemoryDextoStores().getStore('toolExecutions');
            const executionIdentity = {
                runId: 'run-1',
                turnId: 'turn-1',
                modelStepId: 'step-1',
                toolCallId: 'call-1',
            };
            const startedAt = new Date('2026-05-11T00:00:00.000Z');
            await toolExecutionStore.start({
                record: {
                    executionId: createToolExecutionId(executionIdentity),
                    identity: executionIdentity,
                    input: { path: 'snake/index.html' },
                    toolName: 'write_file',
                    status: 'running',
                    startedAt,
                    updatedAt: startedAt,
                },
            });
            await toolExecutionStore.complete({
                executionId: createToolExecutionId(executionIdentity),
                completedAt: new Date('2026-05-11T00:00:01.000Z'),
                result: { result: 'created file' },
            });
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger,
                createInMemorySessionToolPreferencesStore(mockLogger),
                toolExecutionStore
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await expect(
                toolManager.executeTool('write_file', { path: 'other/index.html' }, 'call-1', {
                    sessionId: 'session-1',
                    executionIdentity,
                })
            ).rejects.toThrow('Tool execution record does not match');
            expect(execute).not.toHaveBeenCalled();
        });

        it('derives durable execution identity from host runtime ids', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});
            const execute = vi.fn().mockResolvedValue('listed files');
            const toolExecutionStore = new InMemoryDextoStores().getStore('toolExecutions');
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'list_files',
                        description: 'List files',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger,
                createInMemorySessionToolPreferencesStore(mockLogger),
                toolExecutionStore
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);
            const runContext = createAgentRunContext({
                sessionId: 'session-1',
                hostRuntime: {
                    ids: {
                        runId: 'run-1',
                        turnId: 'turn-1',
                        modelStepId: 'step-1',
                        attemptId: 'attempt-a',
                    },
                },
            });

            await toolManager.executeTool('list_files', { path: '.' }, 'call-1', {
                runContext,
            });

            await expect(
                toolExecutionStore.get({
                    executionId: createToolExecutionId({
                        runId: 'run-1',
                        turnId: 'turn-1',
                        modelStepId: 'step-1',
                        toolCallId: 'call-1',
                    }),
                })
            ).resolves.toEqual(expect.objectContaining({ status: 'completed' }));
        });

        it('does not execute when a durable execution record is already running', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});
            const execute = vi.fn().mockResolvedValue('should not run');
            const toolExecutionStore = new InMemoryDextoStores().getStore('toolExecutions');
            const startedAt = new Date('2026-05-11T00:00:00.000Z');
            await toolExecutionStore.start({
                record: {
                    executionId: createToolExecutionId({
                        runId: 'run-1',
                        turnId: 'turn-1',
                        modelStepId: 'step-1',
                        toolCallId: 'call-1',
                    }),
                    identity: {
                        runId: 'run-1',
                        turnId: 'turn-1',
                        modelStepId: 'step-1',
                        toolCallId: 'call-1',
                    },
                    input: { path: 'snake/index.html' },
                    toolName: 'write_file',
                    status: 'running',
                    startedAt,
                    updatedAt: startedAt,
                },
            });
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger,
                createInMemorySessionToolPreferencesStore(mockLogger),
                toolExecutionStore
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await expect(
                toolManager.executeTool('write_file', { path: 'snake/index.html' }, 'call-1', {
                    sessionId: 'session-1',
                    executionIdentity: {
                        runId: 'run-1',
                        turnId: 'turn-1',
                        modelStepId: 'step-1',
                        toolCallId: 'call-1',
                    },
                })
            ).rejects.toThrow('Tool execution already running');
            expect(execute).not.toHaveBeenCalled();
        });

        it('marks a durable execution failed when a pre-execution hook throws', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});
            const execute = vi.fn().mockResolvedValue('should not run');
            const toolExecutionStore = new InMemoryDextoStores().getStore('toolExecutions');
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger,
                createInMemorySessionToolPreferencesStore(mockLogger),
                toolExecutionStore
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);
            toolManager.setHookSupport(
                {
                    executeHooks: vi.fn().mockRejectedValue(new Error('hook blocked')),
                } as any,
                {} as any,
                {} as any
            );
            const executionIdentity = {
                runId: 'run-1',
                turnId: 'turn-1',
                modelStepId: 'step-1',
                toolCallId: 'call-1',
            };

            await expect(
                toolManager.executeTool('write_file', { path: 'snake/index.html' }, 'call-1', {
                    sessionId: 'session-1',
                    executionIdentity,
                })
            ).rejects.toThrow('hook blocked');
            expect(execute).not.toHaveBeenCalled();
            await expect(
                toolExecutionStore.get({ executionId: createToolExecutionId(executionIdentity) })
            ).resolves.toEqual(
                expect.objectContaining({
                    status: 'failed',
                    error: 'hook blocked',
                })
            );
        });

        it('marks a durable execution failed when manual approval is denied', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});
            mockApprovalManager.requestToolApproval = vi.fn().mockResolvedValue({
                approvalId: 'test-approval-id',
                status: ApprovalStatus.DENIED,
            });
            const execute = vi.fn().mockResolvedValue('should not run');
            const toolExecutionStore = new InMemoryDextoStores().getStore('toolExecutions');
            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute,
                    }),
                ],
                mockLogger,
                createInMemorySessionToolPreferencesStore(mockLogger),
                toolExecutionStore
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);
            const executionIdentity = {
                runId: 'run-1',
                turnId: 'turn-1',
                modelStepId: 'step-1',
                toolCallId: 'call-1',
            };

            await expect(
                toolManager.executeTool('write_file', { path: 'snake/index.html' }, 'call-1', {
                    sessionId: 'session-1',
                    executionIdentity,
                })
            ).rejects.toThrow("Tool 'write_file' execution was denied by the user");
            expect(execute).not.toHaveBeenCalled();
            await expect(
                toolExecutionStore.get({ executionId: createToolExecutionId(executionIdentity) })
            ).resolves.toEqual(
                expect.objectContaining({
                    status: 'failed',
                    error: "Tool 'write_file' execution was denied by the user",
                })
            );
            expect(mockApprovalManager.recordApprovalResponseRecord).toHaveBeenCalledWith(
                expect.objectContaining({
                    approvalId: 'recorded-approval-id',
                    status: ApprovalStatus.DENIED,
                }),
                expect.objectContaining({
                    approvalId: 'recorded-approval-id',
                    metadata: expect.objectContaining({
                        toolName: 'write_file',
                        toolCallId: 'call-1',
                        args: { path: 'snake/index.html' },
                    }),
                })
            );
        });
    });

    describe('Approval Flow Logic', () => {
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

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [tool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.executeTool(
                'typed',
                { count: 5, __meta: { callDescription: 'Read test file' } },
                'call-1',
                { sessionId: 'session-1' }
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

        it('should emit __meta as generic tool-call metadata while stripping it from args', async () => {
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

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [tool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            const result = await toolManager.executeTool(
                'typed',
                {
                    count: 5,
                    __meta: {
                        callDescription: 'Read test file',
                        reactiveUi: {
                            type: 'open',
                            surface: 'browser',
                        },
                    },
                },
                'call-1',
                { sessionId: 'session-1' }
            );

            expect(mockAgentEventBus.emit).toHaveBeenCalledWith(
                'llm:tool-call',
                expect.objectContaining({
                    toolName: 'typed',
                    args: { count: 5 },
                    meta: {
                        callDescription: 'Read test file',
                        reactiveUi: {
                            type: 'open',
                            surface: 'browser',
                        },
                    },
                    callDescription: 'Read test file',
                    callId: 'call-1',
                    sessionId: 'session-1',
                })
            );
            expect(result).toEqual(
                expect.objectContaining({
                    meta: {
                        callDescription: 'Read test file',
                        reactiveUi: {
                            type: 'open',
                            surface: 'browser',
                        },
                    },
                })
            );
        });

        it('should emit callDescription on llm:tool-call events when args.description is provided', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            await toolManager.executeTool(
                'mcp--file_read',
                { path: '/test', description: 'Read test file' },
                'call-1',
                { sessionId: 'session-1' }
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
                approval: {
                    override: approvalOverrideSpy,
                },
                presentation: {
                    preview: previewSpy,
                },
                execute: vi.fn().mockResolvedValue('ok'),
            });

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [tool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.executeTool('typed', { count: '5' }, 'call-1', {
                sessionId: 'session-1',
            });

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

        it('should reject positional sessionId and abortSignal arguments', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});
            const executeSpy = vi.fn().mockResolvedValue('ok');

            const tool = defineTool({
                id: 'typed',
                description: 'Typed tool',
                inputSchema: z
                    .object({
                        count: z.coerce.number().int().default(0),
                    })
                    .strict(),
                execute: executeSpy,
            });

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [tool],
                mockLogger
            );
            const controller = new AbortController();

            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);
            const executeToolWithRuntimeArgs = toolManager.executeTool.bind(
                toolManager
            ) as unknown as (...args: unknown[]) => Promise<unknown>;

            await expect(
                executeToolWithRuntimeArgs(
                    'typed',
                    { count: '5' },
                    'call-legacy',
                    'session-legacy',
                    controller.signal
                )
            ).rejects.toThrow('Tool execution invocation must be an object');
            expect(executeSpy).not.toHaveBeenCalled();
        });

        it('should propagate host runtime through explicit run context during tool execution', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});
            const executeSpy = vi.fn().mockResolvedValue('ok');

            const tool = defineTool({
                id: 'typed',
                description: 'Typed tool',
                inputSchema: z
                    .object({
                        count: z.coerce.number().int().default(0),
                    })
                    .strict(),
                execute: executeSpy,
            });

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [tool],
                mockLogger
            );
            const runContext = {
                sessionId: 'session-1',
                hostRuntime: {
                    ids: {
                        runId: 'run-1',
                        attemptId: 'attempt-1',
                    },
                },
                telemetryContext: {} as any,
            };

            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.executeTool('typed', { count: '5' }, 'call-1', {
                runContext,
            });

            expect(executeSpy).toHaveBeenCalledWith(
                { count: 5 },
                expect.objectContaining({
                    sessionId: 'session-1',
                    runContext,
                    hostRuntime: runContext.hostRuntime,
                })
            );
            expect(mockAgentEventBus.emit).toHaveBeenCalledWith(
                'llm:tool-call',
                expect.objectContaining({
                    sessionId: 'session-1',
                    hostRuntime: runContext.hostRuntime,
                })
            );
            expect(mockAgentEventBus.emit).toHaveBeenCalledWith(
                'tool:running',
                expect.objectContaining({
                    sessionId: 'session-1',
                    hostRuntime: runContext.hostRuntime,
                })
            );
            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalledWith(
                expect.objectContaining({
                    sessionId: 'session-1',
                    hostRuntime: runContext.hostRuntime,
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
                approval: {
                    override: vi.fn().mockImplementation(async () => {
                        callOrder.push('approval.override');
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
                    onGranted: vi.fn().mockImplementation(async () => {
                        callOrder.push('approval.onGranted');
                    }),
                },
                presentation: {
                    preview: vi.fn().mockImplementation(async () => {
                        callOrder.push('presentation.preview');
                        return {
                            type: 'diff',
                            unified: 'diff --git a/x b/x',
                            filename: '/tmp/example.txt',
                            additions: 1,
                            deletions: 0,
                        };
                    }),
                },
                execute: vi.fn().mockImplementation(async () => {
                    callOrder.push('execute');
                    return 'ok';
                }),
            });

            (mockApprovalManager.requestToolApproval as any).mockImplementation(async () => {
                callOrder.push('requestToolApproval');
                return {
                    approvalId: 'test-approval-id',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                };
            });

            (mockApprovalManager.addApprovedDirectory as any).mockImplementation(() => {
                callOrder.push('addApprovedDirectory');
            });

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: ['fs_like_tool'] },
                [tool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            const result = await toolManager.executeTool(
                'fs_like_tool',
                { file_path: '/tmp/example.txt' },
                'call-1',
                { sessionId: 'session-1' }
            );

            expect(result).toEqual(
                expect.objectContaining({
                    result: 'ok',
                    requireApproval: true,
                    approvalStatus: 'approved',
                })
            );

            expect(mockAllowedToolsProvider.isToolAllowed).not.toHaveBeenCalled();
            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalledWith(
                expect.objectContaining({
                    toolName: 'fs_like_tool',
                    toolCallId: 'call-1',
                    sessionId: 'session-1',
                    args: { file_path: '/tmp/example.txt' },
                    displayPreview: expect.objectContaining({
                        type: 'diff',
                        filename: '/tmp/example.txt',
                    }),
                    directoryAccess: {
                        path: '/tmp/example.txt',
                        parentDir: '/tmp',
                        operation: 'read',
                        toolName: 'fs_like_tool',
                    },
                })
            );
            expect(mockApprovalManager.addApprovedDirectory).not.toHaveBeenCalled();

            // Directory access goes through approval.override → presentation.preview → requestToolApproval
            // → approval.onGranted → execute
            expect(callOrder).toEqual([
                'approval.override',
                'presentation.preview',
                'requestToolApproval',
                'approval.onGranted',
                'execute',
            ]);
        });

        it('should preserve host runtime from a directory access approval override when run context is absent', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const hostRuntime = {
                ids: {
                    runId: 'run-1',
                    attemptId: 'attempt-1',
                },
            };
            const tool = defineTool({
                id: 'fs_like_tool',
                description: 'Filesystem-like tool',
                inputSchema: z
                    .object({
                        file_path: z.string(),
                    })
                    .strict(),
                approval: {
                    override: vi.fn().mockResolvedValue({
                        type: ApprovalType.DIRECTORY_ACCESS,
                        metadata: {
                            path: '/tmp/example.txt',
                            parentDir: '/tmp',
                            operation: 'read',
                            toolName: 'fs_like_tool',
                        },
                        hostRuntime,
                    }),
                },
                execute: vi.fn().mockResolvedValue('ok'),
            });

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: ['fs_like_tool'] },
                [tool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.executeTool(
                'fs_like_tool',
                { file_path: '/tmp/example.txt' },
                'call-1',
                { sessionId: 'session-1' }
            );

            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalledWith(
                expect.objectContaining({
                    hostRuntime,
                })
            );
        });

        it('should auto-approve pending directory access prompts when rememberDirectory is selected', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const tool = defineTool({
                id: 'fs_like_tool',
                description: 'Filesystem-like tool',
                inputSchema: z
                    .object({
                        file_path: z.string(),
                    })
                    .strict(),
                approval: {
                    override: vi.fn().mockResolvedValue({
                        type: ApprovalType.DIRECTORY_ACCESS,
                        metadata: {
                            path: '/tmp/example.txt',
                            parentDir: '/tmp',
                            operation: 'read',
                            toolName: 'fs_like_tool',
                        },
                    }),
                    onGranted: vi.fn(),
                },
                execute: vi.fn().mockResolvedValue('ok'),
            });

            (mockApprovalManager.requestToolApproval as any).mockResolvedValue({
                approvalId: 'test-approval-id',
                status: ApprovalStatus.APPROVED,
                data: { rememberDirectory: true },
            });

            (mockApprovalManager.isDirectorySessionApproved as any).mockImplementation(
                (dir: string) => dir === '/tmp'
            );

            (mockApprovalManager.autoApprovePendingRequests as any).mockImplementation(
                (predicate: (request: any) => boolean, responseData?: Record<string, unknown>) => {
                    expect(responseData).toEqual({ rememberDirectory: false });

                    const requests: any[] = [
                        {
                            type: ApprovalType.TOOL_APPROVAL,
                            sessionId: 'session-1',
                            metadata: {
                                toolName: 'fs_like_tool',
                                toolCallId: 'call-2',
                                args: { file_path: '/tmp/example2.txt' },
                                directoryAccess: {
                                    path: '/tmp/example2.txt',
                                    parentDir: '/tmp',
                                    operation: 'read',
                                    toolName: 'fs_like_tool',
                                },
                            },
                        },
                        {
                            type: ApprovalType.TOOL_APPROVAL,
                            sessionId: 'session-1',
                            metadata: {
                                toolName: 'other_tool',
                                toolCallId: 'call-2',
                                args: {},
                                directoryAccess: {
                                    path: '/tmp/example2.txt',
                                    parentDir: '/tmp',
                                    operation: 'read',
                                    toolName: 'other_tool',
                                },
                            },
                        },
                        {
                            type: ApprovalType.TOOL_APPROVAL,
                            sessionId: 'session-2',
                            metadata: {
                                toolName: 'fs_like_tool',
                                toolCallId: 'call-2',
                                args: {},
                                directoryAccess: {
                                    path: '/tmp/example2.txt',
                                    parentDir: '/tmp',
                                    operation: 'read',
                                    toolName: 'fs_like_tool',
                                },
                            },
                        },
                        {
                            type: ApprovalType.TOOL_APPROVAL,
                            sessionId: 'session-1',
                            metadata: {
                                toolName: 'fs_like_tool',
                                toolCallId: 'call-3',
                                args: {},
                            },
                        },
                        {
                            type: ApprovalType.TOOL_APPROVAL,
                            sessionId: 'session-1',
                            metadata: {
                                toolName: 'fs_like_tool',
                                toolCallId: 'call-4',
                                args: {},
                                directoryAccess: {
                                    path: '/var/example2.txt',
                                    parentDir: '/var',
                                    operation: 'read',
                                    toolName: 'fs_like_tool',
                                },
                            },
                        },
                    ];

                    const matched = requests.filter(predicate);
                    expect(matched).toHaveLength(1);
                    return matched.length;
                }
            );

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: ['fs_like_tool'] },
                [tool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.executeTool(
                'fs_like_tool',
                { file_path: '/tmp/example.txt' },
                'call-1',
                { sessionId: 'session-1' }
            );

            expect(mockApprovalManager.autoApprovePendingRequests).toHaveBeenCalledTimes(1);
        });

        it('should request approval via ApprovalManager with correct parameters', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
                { sessionId: 'session123' }
            );

            expect(mockApprovalManager.recordApprovalRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: ApprovalType.TOOL_APPROVAL,
                    sessionId: 'session123',
                    metadata: expect.objectContaining({
                        toolName: 'mcp--file_read',
                        toolCallId: 'call-123',
                        args: { path: '/test' },
                        description: 'Read test file',
                        presentationSnapshot: expect.objectContaining({ version: 1 }),
                    }),
                }),
                {
                    runId: 'session123',
                    turnId: 'direct',
                    modelStepId: 'direct',
                    toolCallId: 'call-123',
                }
            );
            expect(mockApprovalManager.requestApprovalDecision).toHaveBeenCalledWith(
                expect.objectContaining({
                    approvalId: 'recorded-approval-id',
                    sessionId: 'session123',
                    metadata: expect.objectContaining({
                        toolName: 'mcp--file_read',
                        toolCallId: 'call-123',
                    }),
                })
            );
            expect(mockApprovalManager.recordApprovalResponseRecord).toHaveBeenCalledWith(
                expect.objectContaining({
                    approvalId: 'recorded-approval-id',
                    status: ApprovalStatus.APPROVED,
                }),
                expect.objectContaining({
                    approvalId: 'recorded-approval-id',
                    sessionId: 'session123',
                })
            );
            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalledWith(
                expect.objectContaining({
                    toolName: 'mcp--file_read',
                    toolCallId: 'call-123',
                    args: { path: '/test' },
                    description: 'Read test file',
                    sessionId: 'session123',
                    presentationSnapshot: expect.objectContaining({ version: 1 }),
                })
            );
        });

        it('should include suggestedPatterns in tool approval when tool provides suggestions', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const tool = defineTool({
                id: 'bash_like_tool',
                description: 'Bash-like tool with patterns',
                inputSchema: z
                    .object({
                        command: z.string(),
                    })
                    .strict(),
                approval: {
                    patternKey: () => 'git:*',
                    suggestPatterns: () => ['git status', 'git diff'],
                },
                execute: vi.fn().mockResolvedValue('ok'),
            });

            (mockApprovalManager.requestToolApproval as any).mockResolvedValue({
                approvalId: 'test-approval-id',
                status: ApprovalStatus.APPROVED,
            });

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [tool],
                mockLogger
            );
            toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            await toolManager.executeTool('bash_like_tool', { command: 'git status' }, 'call-1', {
                sessionId: 'session-1',
            });

            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalledWith(
                expect.objectContaining({
                    toolName: 'bash_like_tool',
                    toolCallId: 'call-1',
                    sessionId: 'session-1',
                    args: { command: 'git status' },
                    suggestedPatterns: ['git status', 'git diff'],
                })
            );
        });

        it('should fall back to args.description for approval description when __meta.callDescription is missing', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            await toolManager.executeTool(
                'mcp--file_read',
                { path: '/test', description: 'Read test file' },
                'call-123',
                { sessionId: 'session123' }
            );

            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalledWith(
                expect.objectContaining({
                    toolName: 'mcp--file_read',
                    toolCallId: 'call-123',
                    args: { path: '/test', description: 'Read test file' },
                    description: 'Read test file',
                    sessionId: 'session123',
                    presentationSnapshot: expect.objectContaining({ version: 1 }),
                })
            );
        });

        it('should emit background event when runInBackground is set', async () => {
            const originalEnv = process.env.DEXTO_BACKGROUND_TASKS_ENABLED;
            process.env.DEXTO_BACKGROUND_TASKS_ENABLED = 'true';
            try {
                mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');
                const emitSpy = vi.fn();
                mockAgentEventBus.emit = emitSpy as typeof mockAgentEventBus.emit;

                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'auto-approve',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
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
                    { sessionId: 'session-1' }
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
                const toolExecutionStore = new InMemoryDextoStores().getStore('toolExecutions');

                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'auto-approve',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
                    [],
                    mockLogger,
                    createInMemorySessionToolPreferencesStore(mockLogger),
                    toolExecutionStore
                );
                const executionIdentity = {
                    runId: 'run-1',
                    turnId: 'turn-1',
                    modelStepId: 'step-1',
                    toolCallId: 'call-123',
                };

                const response = await toolManager.executeTool(
                    'mcp--file_read',
                    {
                        path: '/test',
                        __meta: {
                            runInBackground: true,
                        },
                    },
                    'call-123',
                    { sessionId: 'session-1', executionIdentity }
                );

                expect(response.result).toBe('sync-result');
                expect(emitSpy).not.toHaveBeenCalledWith('tool:background', expect.anything());
                await expect(
                    toolExecutionStore.get({
                        executionId: createToolExecutionId(executionIdentity),
                    })
                ).resolves.toEqual(
                    expect.objectContaining({
                        status: 'completed',
                        modelOutput: 'sync-result',
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

        it('should request approval without sessionId when not provided', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            await toolManager.executeTool('mcp--file_read', { path: '/test' }, 'call-456');

            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalledWith(
                expect.objectContaining({
                    toolName: 'mcp--file_read',
                    toolCallId: 'call-456',
                    args: { path: '/test' },
                    presentationSnapshot: expect.objectContaining({ version: 1 }),
                })
            );
        });

        it('should pass runContext through MCP execution', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );
            const runContext = {
                sessionId: 'session-1',
                hostRuntime: {
                    ids: {
                        runId: 'run-1',
                        attemptId: 'attempt-1',
                    },
                },
                telemetryContext: {} as any,
            };

            await toolManager.executeTool('mcp--file_read', { path: '/test' }, 'call-789', {
                runContext,
            });

            expect(mockMcpManager.executeTool).toHaveBeenCalledWith(
                'file_read',
                { path: '/test' },
                'session-1',
                runContext
            );
        });

        it('should throw execution denied error when approval denied', async () => {
            mockApprovalManager.requestToolApproval = vi.fn().mockResolvedValue({
                approvalId: 'test-approval-id',
                status: ApprovalStatus.DENIED,
            });

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            const error = (await toolManager
                .executeTool('mcp--file_read', { path: '/test' }, 'test-call-id', {
                    sessionId: 'session123',
                })
                .catch((e) => e)) as DextoRuntimeError;
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(ToolErrorCode.EXECUTION_DENIED);
            expect(error.scope).toBe(ErrorScope.TOOLS);
            expect(error.type).toBe(ErrorType.FORBIDDEN);

            expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
        });

        it('should proceed with execution when approval granted', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('success');

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
            expect(result).toEqual(
                expect.objectContaining({
                    result: 'success',
                    requireApproval: true,
                    approvalStatus: 'approved',
                })
            );
        });

        it('should skip confirmation for tools in allowed list', async () => {
            mockAllowedToolsProvider.isToolAllowed = vi.fn().mockResolvedValue(true);
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('success');

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
            expect(result).toEqual(expect.objectContaining({ result: 'success' }));
        });

        it('should auto-approve when mode is auto-approve', async () => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('success');

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
            expect(result).toEqual(expect.objectContaining({ result: 'success' }));
        });
    });

    describe('Cache Management Logic', () => {
        it('uses dynamic tool descriptions when provided', async () => {
            const getDescription = vi.fn().mockReturnValue('Dynamic description');
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    {
                        id: 'dynamic_tool',
                        description: 'Static description',
                        getDescription,
                        inputSchema: z.object({}).strict(),
                        execute: vi.fn(),
                    },
                ] as any,
                mockLogger
            );

            toolManager.setToolExecutionContextFactory((baseContext) => ({
                ...baseContext,
                agent: {} as any,
                services: {} as any,
            }));

            const tools = await toolManager.getAllTools();

            expect(tools['dynamic_tool']?.description).toBe('Dynamic description');
            expect(getDescription).toHaveBeenCalledTimes(1);
        });

        it('should cache tool discovery results', async () => {
            const tools = {
                test_tool: { name: 'test_tool', description: 'Test', parameters: {} },
            };
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue(tools);

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            // First call
            await toolManager.getAllTools();
            // Second call should use cache
            await toolManager.getAllTools();

            expect(mockMcpManager.getAllTools).toHaveBeenCalledTimes(1);
        });

        it('refreshes dynamic local tool descriptions even when the tool cache is warm', async () => {
            const getDescription = vi
                .fn()
                .mockResolvedValueOnce('Workspace agents: review-agent')
                .mockResolvedValueOnce('Workspace agents: explore-agent');
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    {
                        id: 'spawn_agent',
                        description: 'Static description',
                        getDescription,
                        inputSchema: z.object({}).strict(),
                        execute: vi.fn(),
                    },
                ] as any,
                mockLogger
            );

            toolManager.setToolExecutionContextFactory((baseContext) => ({
                ...baseContext,
                agent: {} as any,
                services: {} as any,
            }));

            const firstDescription = (await toolManager.getAllTools())['spawn_agent']?.description;
            const secondDescription = (await toolManager.getAllTools())['spawn_agent']?.description;

            expect(firstDescription).toBe('Workspace agents: review-agent');
            expect(secondDescription).toBe('Workspace agents: explore-agent');
            expect(mockMcpManager.getAllTools).toHaveBeenCalledTimes(1);
            expect(getDescription).toHaveBeenCalledTimes(2);
        });

        it('falls back to the static description when a dynamic description becomes blank', async () => {
            const getDescription = vi
                .fn()
                .mockResolvedValueOnce('Workspace agents: review-agent')
                .mockResolvedValueOnce('   ');
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [
                    {
                        id: 'spawn_agent',
                        description: 'Static description',
                        getDescription,
                        inputSchema: z.object({}).strict(),
                        execute: vi.fn(),
                    },
                ] as any,
                mockLogger
            );

            toolManager.setToolExecutionContextFactory((baseContext) => ({
                ...baseContext,
                agent: {} as any,
                services: {} as any,
            }));

            const firstDescription = (await toolManager.getAllTools())['spawn_agent']?.description;
            const secondDescription = (await toolManager.getAllTools())['spawn_agent']?.description;

            expect(firstDescription).toBe('Workspace agents: review-agent');
            expect(secondDescription).toBe('Static description');
        });

        it('should invalidate cache on refresh', async () => {
            const tools = {
                test_tool: { name: 'test_tool', description: 'Test', parameters: {} },
            };
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue(tools);

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
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

        it('invalidates cache when the workspace changes', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});
            let workspaceChangedListener:
                | ((payload: {
                      workspace: {
                          id: string;
                          path: string;
                          createdAt: number;
                          lastActiveAt: number;
                      } | null;
                  }) => void)
                | undefined;
            mockAgentEventBus.on = vi.fn((eventName, listener) => {
                if (eventName === 'workspace:changed') {
                    workspaceChangedListener = listener as typeof workspaceChangedListener;
                }
                return mockAgentEventBus;
            }) as any;

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            await toolManager.setWorkspaceManager({
                getWorkspace: vi.fn().mockResolvedValue({
                    id: 'workspace-1',
                    path: '/tmp/workspace-one',
                    createdAt: 1,
                    lastActiveAt: 1,
                }),
            } as any);

            await toolManager.getAllTools();

            expect(workspaceChangedListener).toBeTypeOf('function');

            workspaceChangedListener?.({
                workspace: {
                    id: 'workspace-2',
                    path: '/tmp/workspace-two',
                    createdAt: 2,
                    lastActiveAt: 2,
                },
            });

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

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
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

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
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

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
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

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            const exists = await toolManager.hasTool('mcp--file_read');

            expect(mockMcpManager.getToolClient).toHaveBeenCalledWith('file_read');
            expect(exists).toBe(true);
        });

        it('should return false for non-existent MCP tools', async () => {
            mockMcpManager.getToolClient = vi.fn().mockReturnValue(undefined);

            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            const exists = await toolManager.hasTool('mcp--nonexistent');

            expect(exists).toBe(false);
        });

        it('should return false for tools without proper prefix', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
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
            const toolExecutionStore = new InMemoryDextoStores().getStore('toolExecutions');

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger,
                createInMemorySessionToolPreferencesStore(mockLogger),
                toolExecutionStore
            );
            const executionIdentity = {
                runId: 'run-1',
                turnId: 'turn-1',
                modelStepId: 'step-1',
                toolCallId: 'test-call-id',
            };

            await expect(
                toolManager.executeTool('mcp--file_read', { path: '/test' }, 'test-call-id', {
                    sessionId: 'session-1',
                    executionIdentity,
                })
            ).rejects.toThrow('Tool execution failed');
            await expect(
                toolExecutionStore.get({ executionId: createToolExecutionId(executionIdentity) })
            ).resolves.toEqual(
                expect.objectContaining({
                    status: 'failed',
                    error: 'Tool execution failed',
                })
            );
        });

        it('should propagate approval manager errors', async () => {
            const approvalError = new Error('Approval request failed');
            mockApprovalManager.requestToolApproval = vi.fn().mockRejectedValue(approvalError);
            const toolExecutionStore = new InMemoryDextoStores().getStore('toolExecutions');

            const toolManager = new ToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger,
                createInMemorySessionToolPreferencesStore(mockLogger),
                toolExecutionStore
            );
            const executionIdentity = {
                runId: 'run-1',
                turnId: 'turn-1',
                modelStepId: 'step-1',
                toolCallId: 'test-call-id',
            };

            await expect(
                toolManager.executeTool('mcp--file_read', { path: '/test' }, 'test-call-id', {
                    sessionId: 'session-1',
                    executionIdentity,
                })
            ).rejects.toThrow('Approval request failed');
            await expect(
                toolExecutionStore.get({ executionId: createToolExecutionId(executionIdentity) })
            ).resolves.toEqual(
                expect.objectContaining({
                    status: 'failed',
                    error: 'Approval request failed',
                })
            );
        });
    });

    describe('Tool Policies (Allow Lists)', () => {
        beforeEach(() => {
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('success');
            mockAllowedToolsProvider.isToolAllowed = vi.fn().mockResolvedValue(false);
        });

        it('allows tools in alwaysAllow without approval', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: ['mcp--filesystem--read_file'] },
                [],
                mockLogger
            );

            const result = await toolManager.executeTool(
                'mcp--filesystem--read_file',
                { path: '/test' },
                'test-call-id'
            );

            expect(result).toEqual(expect.objectContaining({ result: 'success' }));
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            expect(mockMcpManager.executeTool).toHaveBeenCalledWith(
                'filesystem--read_file',
                { path: '/test' },
                undefined
            );
        });

        it('checks dynamic allowed tools after the static allow list', async () => {
            mockAllowedToolsProvider.isToolAllowed = vi.fn().mockResolvedValue(true);
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            const result = await toolManager.executeTool(
                'mcp--filesystem--read_file',
                { path: '/test' },
                'test-call-id'
            );

            expect(result).toEqual(expect.objectContaining({ result: 'success' }));
            expect(mockAllowedToolsProvider.isToolAllowed).toHaveBeenCalledWith(
                'mcp--filesystem--read_file',
                undefined
            );
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
        });

        it('falls back to approval mode when no allow policy matches', async () => {
            mockApprovalManager.requestToolApproval = vi.fn().mockResolvedValue({
                approvalId: 'test-approval',
                status: 'approved',
                data: {},
            });
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: ['ask_user'] },
                [],
                mockLogger
            );

            const result = await toolManager.executeTool(
                'mcp--filesystem--read_file',
                { path: '/test' },
                'test-call-id'
            );

            expect(result).toEqual(
                expect.objectContaining({
                    result: 'success',
                    requireApproval: true,
                    approvalStatus: 'approved',
                })
            );
            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalled();
        });

        it('auto-approve mode still executes tools when no allow policy matches', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'auto-approve',
                mockAgentEventBus,
                { alwaysAllow: [] },
                [],
                mockLogger
            );

            const result = await toolManager.executeTool(
                'mcp--filesystem--write_file',
                { path: '/test' },
                'test-call-id'
            );

            expect(result).toEqual(expect.objectContaining({ result: 'success' }));
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
            expect(mockMcpManager.executeTool).toHaveBeenCalled();
        });

        it('applies allow policies to local tools', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: ['ask_user'] },
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

            expect(result).toEqual(expect.objectContaining({ result: 'ok' }));
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
        });

        it('matches exact and qualified MCP tool names in allow policies', async () => {
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: ['mcp--read_file', 'mcp--list_directory'] },
                [],
                mockLogger
            );

            await toolManager.executeTool('mcp--read_file', { path: '/test' }, 'call-1');
            expect(mockMcpManager.executeTool).toHaveBeenLastCalledWith(
                'read_file',
                { path: '/test' },
                undefined
            );

            await toolManager.executeTool(
                'mcp--filesystem--read_file',
                { path: '/test' },
                'call-2'
            );
            expect(mockMcpManager.executeTool).toHaveBeenLastCalledWith(
                'filesystem--read_file',
                { path: '/test' },
                undefined
            );

            await toolManager.executeTool('mcp--server2--list_directory', {}, 'call-3');
            expect(mockMcpManager.executeTool).toHaveBeenLastCalledWith(
                'server2--list_directory',
                {},
                undefined
            );
            expect(mockApprovalManager.requestToolApproval).not.toHaveBeenCalled();
        });

        it('does not match unrelated tools with similar names', async () => {
            mockApprovalManager.requestToolApproval = vi.fn().mockResolvedValue({
                approvalId: 'test-approval',
                status: 'approved',
                data: {},
            });
            const toolManager = createToolManager(
                mockMcpManager,
                mockApprovalManager,
                mockAllowedToolsProvider,
                'manual',
                mockAgentEventBus,
                { alwaysAllow: ['mcp--read_file'] },
                [],
                mockLogger
            );

            const result = await toolManager.executeTool(
                'mcp--read_file_metadata',
                {},
                'test-call-id'
            );

            expect(result).toEqual(
                expect.objectContaining({
                    result: 'success',
                    requireApproval: true,
                    approvalStatus: 'approved',
                })
            );
            expect(mockApprovalManager.requestToolApproval).toHaveBeenCalled();
        });
    });

    describe('Session Auto-Approve Tools (Skill allowed-tools)', () => {
        describe('Basic CRUD Operations', () => {
            it('should set and get session auto-approve tools', () => {
                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
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
                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
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
                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
                    [],
                    mockLogger
                );

                expect(toolManager.hasSessionAutoApproveTools('non-existent')).toBe(false);
                expect(toolManager.getSessionAutoApproveTools('non-existent')).toBeUndefined();
            });

            it('should clear session auto-approve tools', () => {
                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
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
                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
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
                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
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
                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
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

            it('should not keep an empty user auto-approve key when restored state has no tools', async () => {
                const emptyPreferencesStore = {
                    load: vi.fn().mockResolvedValue({
                        userAutoApproveTools: [],
                        disabledTools: [],
                    } satisfies SessionToolPreferences),
                    save: vi.fn().mockResolvedValue(undefined),
                    delete: vi.fn().mockResolvedValue(undefined),
                };
                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
                    [],
                    mockLogger,
                    emptyPreferencesStore as unknown as ConstructorParameters<
                        typeof ToolManager
                    >[8],
                    new InMemoryDextoStores().getStore('toolExecutions')
                );

                await toolManager.restoreSessionState('restored-session');

                expect(toolManager.hasSessionUserAutoApproveTools('restored-session')).toBe(false);
                expect(
                    toolManager.getSessionUserAutoApproveTools('restored-session')
                ).toBeUndefined();
            });

            it('should serialize deleteSessionState with in-flight preference persistence', async () => {
                const sessionId = 'locked-delete-session';
                const saveStarted = createDeferred<void>();
                const releaseSave = createDeferred<void>();
                const persistedPreferences = new Map<string, SessionToolPreferences>();
                const emptyPreferences: SessionToolPreferences = {
                    userAutoApproveTools: [],
                    disabledTools: [],
                };
                const controlledStore = {
                    load: vi.fn().mockImplementation(async (requestedSessionId: string) => {
                        return structuredClone(
                            persistedPreferences.get(requestedSessionId) ?? emptyPreferences
                        );
                    }),
                    save: vi
                        .fn()
                        .mockImplementation(
                            async (
                                requestedSessionId: string,
                                preferences: SessionToolPreferences
                            ) => {
                                saveStarted.resolve();
                                await releaseSave.promise;
                                persistedPreferences.set(
                                    requestedSessionId,
                                    structuredClone(preferences)
                                );
                            }
                        ),
                    delete: vi.fn().mockImplementation(async (requestedSessionId: string) => {
                        persistedPreferences.delete(requestedSessionId);
                    }),
                };
                const toolManager = new ToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
                    [],
                    mockLogger,
                    controlledStore as unknown as ConstructorParameters<typeof ToolManager>[8],
                    new InMemoryDextoStores().getStore('toolExecutions')
                );

                const setDisabledPromise = toolManager.setSessionDisabledTools(sessionId, [
                    'bash_exec',
                ]);
                await saveStarted.promise;

                let deleteFinished = false;
                const deletePromise = toolManager.deleteSessionState(sessionId).then(() => {
                    deleteFinished = true;
                });

                await Promise.resolve();
                expect(deleteFinished).toBe(false);

                releaseSave.resolve();
                await setDisabledPromise;
                await deletePromise;

                expect(
                    persistedPreferences.get(sessionId) ?? {
                        userAutoApproveTools: [],
                        disabledTools: [],
                    }
                ).toEqual(emptyPreferences);
                expect(toolManager.getDisabledTools(sessionId)).toEqual([]);
            });

            it('should merge tools when adding to session auto-approve list', () => {
                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
                    [],
                    mockLogger
                );

                const sessionId = 'test-session';
                toolManager.setSessionAutoApproveTools(sessionId, ['tool1']);
                toolManager.addSessionAutoApproveTools(sessionId, ['tool2', 'tool1']);

                expect(toolManager.getSessionAutoApproveTools(sessionId)).toEqual([
                    'tool1',
                    'tool2',
                ]);
            });

            it('should normalize aliases and ignore duplicates when adding auto-approve tools', () => {
                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
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

                const sessionId = 'test-session';
                toolManager.setSessionAutoApproveTools(sessionId, ['bash_exec']);
                toolManager.addSessionAutoApproveTools(sessionId, ['BASH', 'bash_exec']);

                expect(toolManager.getSessionAutoApproveTools(sessionId)).toEqual(['bash_exec']);
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

                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual', // Manual mode - normally requires approval
                    mockAgentEventBus,
                    { alwaysAllow: [] },
                    [],
                    mockLogger
                );

                const sessionId = 'test-session';
                toolManager.setSessionAutoApproveTools(sessionId, ['mcp--test_tool']);

                // Execute tool with sessionId
                await toolManager.executeTool('mcp--test_tool', {}, 'call-1', { sessionId });

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

                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
                    [],
                    mockLogger
                );

                const sessionId = 'test-session';
                toolManager.setSessionAutoApproveTools(sessionId, ['mcp--allowed_tool']);

                // Execute a tool NOT in the auto-approve list
                await toolManager.executeTool('mcp--other_tool', {}, 'call-1', { sessionId });

                // Should have requested approval
                expect(mockApprovalManager.requestToolApproval).toHaveBeenCalled();
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

                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
                    [],
                    mockLogger
                );

                // Set auto-approve for session-1
                toolManager.setSessionAutoApproveTools('session-1', ['mcp--test_tool']);

                // Execute with different session
                await toolManager.executeTool('mcp--test_tool', {}, 'call-1', {
                    sessionId: 'session-2',
                });

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

                const toolManager = createToolManager(
                    mockMcpManager,
                    mockApprovalManager,
                    mockAllowedToolsProvider,
                    'manual',
                    mockAgentEventBus,
                    { alwaysAllow: [] },
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
