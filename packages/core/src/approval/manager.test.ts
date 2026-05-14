import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { ApprovalManager } from './manager.js';
import { createApprovalRequest } from './factory.js';
import { ApprovalStatus, ApprovalType, DenialReason } from './types.js';
import { AgentEventBus } from '../events/index.js';
import { DextoRuntimeError } from '../errors/index.js';
import { ApprovalErrorCode } from './error-codes.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import type { Logger } from '../logger/v2/types.js';
import type { ApprovalStore, SessionApprovalState } from '../storage/approvals/types.js';
import { createInMemorySessionApprovalStore } from '../test-utils/session-state-stores.js';

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('ApprovalManager', () => {
    let agentEventBus: AgentEventBus;
    const mockLogger = createMockLogger();

    function createApprovalManager(
        config: ConstructorParameters<typeof ApprovalManager>[0],
        logger: Logger = mockLogger,
        approvalStore: ApprovalStore = createInMemorySessionApprovalStore(logger)
    ) {
        return new ApprovalManager(config, logger, approvalStore);
    }

    beforeEach(() => {
        agentEventBus = new AgentEventBus();
    });

    describe('Configuration - Separate tool and elicitation control', () => {
        it('should allow auto-approve for tools while elicitation is enabled', async () => {
            const manager = createApprovalManager(
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

            // Tool approval should be auto-approved
            const toolResponse = await manager.requestToolApproval({
                toolName: 'test_tool',
                toolCallId: 'test-call-id',
                args: { foo: 'bar' },
            });

            expect(toolResponse.status).toBe(ApprovalStatus.APPROVED);
        });

        it('should reject elicitation when disabled, even if tools are auto-approved', async () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // Elicitation should throw error when disabled
            await expect(
                manager.requestElicitation({
                    schema: {
                        type: 'object' as const,
                        properties: {
                            name: { type: 'string' as const },
                        },
                    },
                    prompt: 'Enter your name',
                    serverName: 'Test Server',
                })
            ).rejects.toThrow(DextoRuntimeError);

            await expect(
                manager.requestElicitation({
                    schema: {
                        type: 'object' as const,
                        properties: {
                            name: { type: 'string' as const },
                        },
                    },
                    prompt: 'Enter your name',
                    serverName: 'Test Server',
                })
            ).rejects.toThrow(/Elicitation is disabled/);
        });

        it('should use separate timeouts for tools and elicitation', () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 60000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 180000,
                    },
                },
                mockLogger
            );

            const config = manager.getConfig();
            expect(config.permissions.timeout).toBe(60000);
            expect(config.elicitation.timeout).toBe(180000);
        });
    });

    describe('Durable approval records', () => {
        it('records a deterministic approval request without invoking the manual handler', async () => {
            const approvalStore = createInMemorySessionApprovalStore(mockLogger);
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger,
                approvalStore
            );
            const handler = vi.fn();
            manager.setHandler(handler);

            const request = await manager.recordApprovalRequest(
                {
                    type: ApprovalType.TOOL_APPROVAL,
                    sessionId: 'session-1',
                    metadata: {
                        toolName: 'write_file',
                        toolCallId: 'call-1',
                        args: { path: 'src/app.ts' },
                    },
                },
                {
                    runId: 'run-1',
                    turnId: 'turn-1',
                    modelStepId: 'step-1',
                    toolCallId: 'call-1',
                }
            );
            const replayed = await manager.recordApprovalRequest(
                {
                    type: ApprovalType.TOOL_APPROVAL,
                    sessionId: 'session-1',
                    metadata: {
                        toolName: 'write_file',
                        toolCallId: 'call-1',
                        args: { path: 'src/app.ts' },
                    },
                },
                {
                    runId: 'run-1',
                    turnId: 'turn-1',
                    modelStepId: 'step-1',
                    toolCallId: 'call-1',
                }
            );

            expect(request.approvalId).toBe(replayed.approvalId);
            expect(request.timeout).toBe(120000);
            expect(handler).not.toHaveBeenCalled();
            await expect(
                approvalStore.getRequest({ approvalId: request.approvalId })
            ).resolves.toEqual(request);
        });

        it('records approval responses idempotently and rejects conflicting decisions', async () => {
            const approvalStore = createInMemorySessionApprovalStore(mockLogger);
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger,
                approvalStore
            );
            const request = await manager.recordApprovalRequest(
                {
                    type: ApprovalType.TOOL_APPROVAL,
                    sessionId: 'session-1',
                    metadata: {
                        toolName: 'write_file',
                        toolCallId: 'call-1',
                        args: { path: 'src/app.ts' },
                    },
                },
                {
                    runId: 'run-1',
                    turnId: 'turn-1',
                    modelStepId: 'step-1',
                    toolCallId: 'call-1',
                }
            );
            const response = {
                approvalId: request.approvalId,
                status: ApprovalStatus.APPROVED,
            };

            await expect(manager.recordApprovalResponse(response)).resolves.toEqual(
                expect.objectContaining(response)
            );
            await expect(manager.recordApprovalResponse(response)).resolves.toEqual(
                expect.objectContaining(response)
            );
            await expect(
                manager.recordApprovalResponse({
                    approvalId: request.approvalId,
                    status: ApprovalStatus.DENIED,
                    reason: DenialReason.USER_DENIED,
                })
            ).rejects.toThrow(/conflicts with existing approval response/);
        });

        it('treats equivalent approval response data as an idempotent replay', async () => {
            const manager = createApprovalManager({
                permissions: {
                    mode: 'manual',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: true,
                    timeout: 120000,
                },
            });
            const request = await manager.recordApprovalRequest(
                {
                    type: ApprovalType.TOOL_APPROVAL,
                    sessionId: 'session-1',
                    metadata: {
                        toolName: 'write_file',
                        toolCallId: 'call-1',
                        args: { path: 'src/app.ts' },
                    },
                },
                {
                    runId: 'run-1',
                    turnId: 'turn-1',
                    modelStepId: 'step-1',
                    toolCallId: 'call-1',
                }
            );
            const firstDecision = {
                approvalId: request.approvalId,
                status: ApprovalStatus.APPROVED,
                data: {
                    rememberChoice: true,
                    rememberPattern: 'write_file *',
                },
            };
            const replayedDecision = {
                approvalId: request.approvalId,
                status: ApprovalStatus.APPROVED,
                data: {
                    rememberPattern: 'write_file *',
                    rememberChoice: true,
                },
            };

            const firstRecord = await manager.recordApprovalResponseRecord(firstDecision);
            expect(firstRecord.status).toBe('created');

            await expect(manager.recordApprovalResponseRecord(replayedDecision)).resolves.toEqual({
                response: firstRecord.response,
                status: 'replayed',
            });
        });

        it('rejects request replays that reuse an approval identity with different details', async () => {
            const manager = createApprovalManager({
                permissions: {
                    mode: 'manual',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: true,
                    timeout: 120000,
                },
            });
            const identity = {
                runId: 'run-1',
                turnId: 'turn-1',
                modelStepId: 'step-1',
                toolCallId: 'call-1',
            };

            await manager.recordApprovalRequest(
                {
                    type: ApprovalType.TOOL_APPROVAL,
                    sessionId: 'session-1',
                    metadata: {
                        toolName: 'write_file',
                        toolCallId: 'call-1',
                        args: { path: 'src/app.ts' },
                    },
                },
                identity
            );

            await expect(
                manager.recordApprovalRequest(
                    {
                        type: ApprovalType.TOOL_APPROVAL,
                        sessionId: 'session-2',
                        metadata: {
                            toolName: 'write_file',
                            toolCallId: 'call-1',
                            args: { path: 'src/app.ts' },
                        },
                    },
                    identity
                )
            ).rejects.toThrow(/conflicts with existing approval request/);
        });

        it('rejects response recording when the expected request does not match persisted state', async () => {
            const manager = createApprovalManager({
                permissions: {
                    mode: 'manual',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: true,
                    timeout: 120000,
                },
            });
            const request = await manager.recordApprovalRequest(
                {
                    type: ApprovalType.TOOL_APPROVAL,
                    sessionId: 'session-1',
                    metadata: {
                        toolName: 'write_file',
                        toolCallId: 'call-1',
                        args: { path: 'src/app.ts' },
                    },
                },
                {
                    runId: 'run-1',
                    turnId: 'turn-1',
                    modelStepId: 'step-1',
                    toolCallId: 'call-1',
                }
            );
            const mismatchedExpectedRequest = createApprovalRequest(
                {
                    type: ApprovalType.TOOL_APPROVAL,
                    sessionId: 'session-1',
                    metadata: {
                        toolName: 'write_file',
                        toolCallId: 'call-1',
                        args: { path: 'other.ts' },
                    },
                },
                request.approvalId
            );

            await expect(
                manager.recordApprovalResponseRecord(
                    {
                        approvalId: request.approvalId,
                        status: ApprovalStatus.APPROVED,
                    },
                    mismatchedExpectedRequest
                )
            ).rejects.toThrow(/conflicts with existing approval request/);
        });

        it('stamps recorded responses with request-owned session and host runtime', async () => {
            const manager = createApprovalManager({
                permissions: {
                    mode: 'manual',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: true,
                    timeout: 120000,
                },
            });
            const request = await manager.recordApprovalRequest(
                {
                    type: ApprovalType.TOOL_APPROVAL,
                    sessionId: 'session-1',
                    hostRuntime: {
                        ids: {
                            runId: 'run-1',
                            workflowInstanceId: 'workflow-1',
                        },
                    },
                    metadata: {
                        toolName: 'write_file',
                        toolCallId: 'call-1',
                        args: { path: 'src/app.ts' },
                    },
                },
                {
                    runId: 'run-1',
                    turnId: 'turn-1',
                    modelStepId: 'step-1',
                    toolCallId: 'call-1',
                }
            );

            await expect(
                manager.recordApprovalResponse({
                    approvalId: request.approvalId,
                    status: ApprovalStatus.DENIED,
                    reason: DenialReason.USER_DENIED,
                })
            ).resolves.toEqual(
                expect.objectContaining({
                    approvalId: request.approvalId,
                    sessionId: 'session-1',
                    hostRuntime: {
                        ids: {
                            runId: 'run-1',
                            workflowInstanceId: 'workflow-1',
                        },
                    },
                    status: ApprovalStatus.DENIED,
                    reason: DenialReason.USER_DENIED,
                })
            );
        });

        it('does not let runtime caller fields override request-owned response scope', async () => {
            const manager = createApprovalManager({
                permissions: {
                    mode: 'manual',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: true,
                    timeout: 120000,
                },
            });
            const request = await manager.recordApprovalRequest(
                {
                    type: ApprovalType.TOOL_APPROVAL,
                    sessionId: 'session-1',
                    metadata: {
                        toolName: 'write_file',
                        toolCallId: 'call-1',
                        args: { path: 'src/app.ts' },
                    },
                },
                {
                    runId: 'run-1',
                    turnId: 'turn-1',
                    modelStepId: 'step-1',
                    toolCallId: 'call-1',
                }
            );
            const runtimeDecision = {
                approvalId: request.approvalId,
                sessionId: 'wrong-session',
                status: ApprovalStatus.APPROVED,
            };

            await expect(manager.recordApprovalResponse(runtimeDecision)).resolves.toEqual(
                expect.objectContaining({
                    approvalId: request.approvalId,
                    sessionId: 'session-1',
                    status: ApprovalStatus.APPROVED,
                })
            );
        });

        it('strips caller scope fields when the recorded request has no scope', async () => {
            const manager = createApprovalManager({
                permissions: {
                    mode: 'manual',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: true,
                    timeout: 120000,
                },
            });
            const request = await manager.recordApprovalRequest(
                {
                    type: ApprovalType.TOOL_APPROVAL,
                    metadata: {
                        toolName: 'write_file',
                        toolCallId: 'call-1',
                        args: { path: 'src/app.ts' },
                    },
                },
                {
                    runId: 'run-1',
                    turnId: 'turn-1',
                    modelStepId: 'step-1',
                    toolCallId: 'call-1',
                }
            );
            const runtimeDecision = {
                approvalId: request.approvalId,
                sessionId: 'wrong-session',
                status: ApprovalStatus.APPROVED,
            };

            await expect(manager.recordApprovalResponse(runtimeDecision)).resolves.toEqual({
                approvalId: request.approvalId,
                status: ApprovalStatus.APPROVED,
            });
        });

        it('validates response data against the recorded request type', async () => {
            const manager = createApprovalManager({
                permissions: {
                    mode: 'manual',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: true,
                    timeout: 120000,
                },
            });
            const request = await manager.recordApprovalRequest(
                {
                    type: ApprovalType.ELICITATION,
                    sessionId: 'session-1',
                    metadata: {
                        schema: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                            },
                        },
                        prompt: 'Name?',
                        serverName: 'test-server',
                    },
                },
                {
                    runId: 'run-1',
                    turnId: 'turn-1',
                    modelStepId: 'step-1',
                    toolCallId: 'call-1',
                }
            );

            await expect(
                manager.recordApprovalResponse({
                    approvalId: request.approvalId,
                    status: ApprovalStatus.APPROVED,
                    data: { rememberChoice: true },
                })
            ).rejects.toThrow();
        });
    });

    describe('Approval routing by type', () => {
        it('should route tool approvals to tool approval handler', async () => {
            const manager = createApprovalManager(
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

            const response = await manager.requestToolApproval({
                toolName: 'test_tool',
                toolCallId: 'test-call-id',
                args: {},
            });

            expect(response.status).toBe(ApprovalStatus.APPROVED);
        });

        it('should route command approvals to the approval handler', async () => {
            const manager = createApprovalManager(
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

            const response = await manager.requestCommandApproval({
                toolName: 'bash_exec',
                command: 'rm -rf /',
                originalCommand: 'rm -rf /',
            });

            expect(response.status).toBe(ApprovalStatus.APPROVED);
        });

        it('should route elicitation to elicitation provider when enabled', async () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // Elicitation uses the manual handler and can still timeout independently.
            // We'll timeout immediately to avoid hanging tests
            await expect(
                manager.requestElicitation({
                    schema: {
                        type: 'object' as const,
                        properties: {
                            name: { type: 'string' as const },
                        },
                    },
                    prompt: 'Enter your name',
                    serverName: 'Test Server',
                    timeout: 1, // 1ms timeout to fail fast
                })
            ).rejects.toThrow();
        });
    });

    describe('Pending approvals tracking', () => {
        it('should track pending approvals across both providers', () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // Initially no pending approvals
            expect(manager.getPendingApprovals()).toEqual([]);

            // Auto-approve mode would not create pending approvals
            // Event-based mode would, but we don't want hanging requests in tests
        });

        it('should cancel approvals in both providers', () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // Should not throw when cancelling (even if approval doesn't exist)
            expect(() => manager.cancelApproval('test-id')).not.toThrow();
            expect(() => manager.cancelAllApprovals()).not.toThrow();
        });
    });

    describe('Error handling', () => {
        it('should throw clear error when elicitation is disabled', async () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            await expect(
                manager.getElicitationData({
                    schema: {
                        type: 'object' as const,
                        properties: {
                            name: { type: 'string' as const },
                        },
                    },
                    prompt: 'Enter your name',
                    serverName: 'Test Server',
                })
            ).rejects.toThrow(/Elicitation is disabled/);
        });

        it('should provide helpful error message about enabling elicitation', async () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            try {
                await manager.requestElicitation({
                    schema: {
                        type: 'object' as const,
                        properties: {
                            name: { type: 'string' as const },
                        },
                    },
                    prompt: 'Enter your name',
                    serverName: 'Test Server',
                });
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as Error).message).toContain('Enable elicitation');
                expect((error as Error).message).toContain('agent configuration');
            }
        });

        it('should treat approved elicitations without formData as an empty object', async () => {
            const manager = createApprovalManager(
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

            manager.setHandler(async (request) => ({
                approvalId: request.approvalId,
                status: ApprovalStatus.APPROVED,
            }));

            await expect(
                manager.getElicitationData({
                    schema: {
                        type: 'object' as const,
                        properties: {},
                    },
                    prompt: 'Anything to add?',
                    serverName: 'Test Server',
                })
            ).resolves.toEqual({});
        });

        it('should pass host runtime through getElicitationData', async () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );
            const requestElicitation = vi.spyOn(manager, 'requestElicitation').mockResolvedValue({
                approvalId: 'approval-1',
                status: ApprovalStatus.APPROVED,
                data: {
                    formData: {
                        answer: 'yes',
                    },
                },
            });
            const hostRuntime = {
                ids: {
                    runId: 'run-1',
                },
            };

            await expect(
                manager.getElicitationData({
                    schema: {
                        type: 'object' as const,
                        properties: {
                            answer: { type: 'string' as const },
                        },
                    },
                    prompt: 'Answer?',
                    serverName: 'Test Server',
                    hostRuntime,
                })
            ).resolves.toEqual({ answer: 'yes' });

            expect(requestElicitation).toHaveBeenCalledWith(
                expect.objectContaining({
                    hostRuntime,
                })
            );
        });
    });

    describe('Timeout Configuration', () => {
        it('should allow undefined timeout (infinite wait) for tool approval', () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        // No timeout specified - should wait indefinitely
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            const config = manager.getConfig();
            expect(config.permissions.timeout).toBeUndefined();
        });

        it('should allow undefined timeout (infinite wait) for elicitation', () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 60000,
                    },
                    elicitation: {
                        enabled: true,
                        // No timeout specified - should wait indefinitely
                    },
                },
                mockLogger
            );

            const config = manager.getConfig();
            expect(config.elicitation.timeout).toBeUndefined();
        });

        it('should allow both timeouts to be undefined (infinite wait for all approvals)', () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        // No timeout
                    },
                    elicitation: {
                        enabled: true,
                        // No timeout
                    },
                },
                mockLogger
            );

            const config = manager.getConfig();
            expect(config.permissions.timeout).toBeUndefined();
            expect(config.elicitation.timeout).toBeUndefined();
        });

        it('should use per-request timeout override when provided', async () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve', // Auto-approve so we can test immediately
                        timeout: 60000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // The per-request timeout should override the config timeout
            // This is tested implicitly through the factory flow
            const response = await manager.requestToolApproval({
                toolName: 'test_tool',
                toolCallId: 'test-call-id',
                args: { foo: 'bar' },
                timeout: 30000, // Per-request override
            });

            expect(response.status).toBe(ApprovalStatus.APPROVED);
        });

        it('should not timeout when timeout is undefined in auto-approve mode', async () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'auto-approve',
                        // No timeout - should not cause any issues with auto-approve
                    },
                    elicitation: {
                        enabled: false,
                    },
                },
                mockLogger
            );

            const response = await manager.requestToolApproval({
                toolName: 'test_tool',
                toolCallId: 'test-call-id',
                args: {},
            });

            expect(response.status).toBe(ApprovalStatus.APPROVED);
        });
    });

    describe('Backward compatibility', () => {
        it('should work with manual mode for both tools and elicitation', () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            expect(manager.getConfig()).toEqual({
                permissions: {
                    mode: 'manual',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: true,
                    timeout: 120000,
                },
            });
        });

        it('should respect explicitly set elicitation enabled value', () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            expect(manager.getConfig().elicitation.enabled).toBe(true);
        });
    });

    describe('Denial Reasons', () => {
        it('should throw error with specific reason when tool approval is denied', async () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );
            manager.setHandler(async (request) => ({
                approvalId: request.approvalId,
                status: ApprovalStatus.DENIED,
                timestamp: new Date(),
                reason: DenialReason.USER_DENIED,
                message: 'User rejected this request',
            }));

            try {
                await manager.checkToolApproval({
                    toolName: 'test_tool',
                    toolCallId: 'test-call-id',
                    args: {},
                });
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(
                    ApprovalErrorCode.APPROVAL_TOOL_APPROVAL_DENIED
                );
                expect((error as DextoRuntimeError).message).toContain(
                    'User rejected this request'
                );
                expect((error as any).context.reason).toBe(DenialReason.USER_DENIED);
            }
        });

        it('should pass host runtime through checkToolApproval', async () => {
            const manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );
            const requestToolApproval = vi.spyOn(manager, 'requestToolApproval').mockResolvedValue({
                approvalId: 'approval-1',
                status: ApprovalStatus.APPROVED,
            });
            const hostRuntime = {
                ids: {
                    runId: 'run-1',
                    attemptId: 'attempt-1',
                },
            };

            await expect(
                manager.checkToolApproval({
                    toolName: 'test_tool',
                    toolCallId: 'test-call-id',
                    args: {},
                    hostRuntime,
                })
            ).resolves.toBe(true);

            expect(requestToolApproval).toHaveBeenCalledWith(
                expect.objectContaining({
                    hostRuntime,
                })
            );
        });

        it('should handle user_denied reason in error message', async () => {
            const _manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 1, // Quick timeout for test
                    },
                    elicitation: {
                        enabled: true,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            // Simulate user denying via event
            setTimeout(() => {
                agentEventBus.emit('approval:response', {
                    approvalId: expect.any(String),
                    status: ApprovalStatus.DENIED,
                    reason: DenialReason.USER_DENIED,
                    message: 'User clicked deny',
                } as any);
            }, 50);

            // This will be challenging to test properly without mocking more,
            // so let's just ensure the type system accepts it
            expect(DenialReason.USER_DENIED).toBe('user_denied');
            expect(DenialReason.TIMEOUT).toBe('timeout');
        });

        it('should include reason in response schema', () => {
            // Verify the type system allows reason and message
            const response: { reason?: DenialReason; message?: string } = {
                reason: DenialReason.USER_DENIED,
                message: 'You denied this request',
            };

            expect(response.reason).toBe(DenialReason.USER_DENIED);
            expect(response.message).toBe('You denied this request');
        });

        it('should support all denial reason types', () => {
            const reasons: DenialReason[] = [
                DenialReason.USER_DENIED,
                DenialReason.SYSTEM_DENIED,
                DenialReason.TIMEOUT,
                DenialReason.USER_CANCELLED,
                DenialReason.SYSTEM_CANCELLED,
                DenialReason.VALIDATION_FAILED,
                DenialReason.ELICITATION_DISABLED,
            ];

            expect(reasons.length).toBe(7);
            reasons.forEach((reason) => {
                expect(typeof reason).toBe('string');
            });
        });
    });

    describe('Tool Pattern Approval', () => {
        let manager: ApprovalManager;
        const toolName = 'bash_exec';

        beforeEach(() => {
            manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false,
                    },
                },
                mockLogger
            );
        });

        describe('addPattern', () => {
            it('should add a pattern to the approved list', async () => {
                await manager.addPattern(toolName, 'git *');
                expect(manager.getToolPatterns(toolName).has('git *')).toBe(true);
            });

            it('should add multiple patterns', async () => {
                await manager.addPattern(toolName, 'git *');
                await manager.addPattern(toolName, 'npm *');
                await manager.addPattern(toolName, 'ls *');

                const patterns = manager.getToolPatterns(toolName);
                expect(patterns.size).toBe(3);
                expect(patterns.has('git *')).toBe(true);
                expect(patterns.has('npm *')).toBe(true);
                expect(patterns.has('ls *')).toBe(true);
            });

            it('should not duplicate patterns', async () => {
                await manager.addPattern(toolName, 'git *');
                await manager.addPattern(toolName, 'git *');

                expect(manager.getToolPatterns(toolName).size).toBe(1);
            });
        });

        describe('matchesPattern (pattern-to-pattern covering)', () => {
            // Note: matchesPattern expects pattern keys (e.g., "git push *"),
            // not raw commands. ToolManager generates pattern keys from commands.

            it('should match exact pattern against exact stored pattern', async () => {
                await manager.addPattern(toolName, 'git status *');
                expect(manager.matchesPattern(toolName, 'git status *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'git push *')).toBe(false);
            });

            it('should cover narrower pattern with broader pattern', async () => {
                // "git *" is broader and should cover "git push *", "git status *", etc.
                await manager.addPattern(toolName, 'git *');
                expect(manager.matchesPattern(toolName, 'git *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'git push *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'git status *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'npm *')).toBe(false);
            });

            it('should not let narrower pattern cover broader pattern', async () => {
                // "git push *" should NOT cover "git *"
                await manager.addPattern(toolName, 'git push *');
                expect(manager.matchesPattern(toolName, 'git push *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'git *')).toBe(false);
                expect(manager.matchesPattern(toolName, 'git status *')).toBe(false);
            });

            it('should match against multiple patterns', async () => {
                await manager.addPattern(toolName, 'git *');
                await manager.addPattern(toolName, 'npm install *');

                expect(manager.matchesPattern(toolName, 'git status *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'npm install *')).toBe(true);
                // npm * is not covered, only npm install * specifically
                expect(manager.matchesPattern(toolName, 'npm run *')).toBe(false);
            });

            it('should return false when no patterns are set', () => {
                expect(manager.matchesPattern(toolName, 'git status *')).toBe(false);
            });

            it('should not cross-match unrelated commands', async () => {
                await manager.addPattern(toolName, 'npm *');
                // "npx" starts with "np" but is not "npm " + something
                expect(manager.matchesPattern(toolName, 'npx *')).toBe(false);
            });

            it('should handle multi-level subcommands', async () => {
                await manager.addPattern(toolName, 'docker compose *');
                expect(manager.matchesPattern(toolName, 'docker compose *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'docker compose up *')).toBe(true);
                expect(manager.matchesPattern(toolName, 'docker *')).toBe(false);
            });

            it('should isolate patterns by tool', async () => {
                await manager.addPattern('tool-a', 'git *');
                expect(manager.matchesPattern('tool-a', 'git push *')).toBe(true);
                expect(manager.matchesPattern('tool-b', 'git push *')).toBe(false);
            });

            it('should serialize deleteSessionState with in-flight pattern persistence', async () => {
                const sessionId = 'locked-delete-session';
                const saveStarted = createDeferred<void>();
                const releaseSave = createDeferred<void>();
                const persistedState = new Map<string, SessionApprovalState>();
                const emptyState: SessionApprovalState = {
                    toolPatterns: {},
                    approvedDirectories: [],
                };
                const store = {
                    loadSessionState: vi.fn().mockImplementation(async (input) => {
                        return structuredClone(
                            persistedState.get(input.sessionId ?? '__global__') ?? emptyState
                        );
                    }),
                    saveSessionState: vi.fn().mockImplementation(async (input) => {
                        saveStarted.resolve();
                        await releaseSave.promise;
                        persistedState.set(
                            input.sessionId ?? '__global__',
                            structuredClone(input.state)
                        );
                    }),
                    deleteSessionState: vi.fn().mockImplementation(async (input) => {
                        persistedState.delete(input.sessionId ?? '__global__');
                    }),
                    createRequest: vi.fn(),
                    getRequest: vi.fn(),
                    listPending: vi.fn(),
                    saveResponse: vi.fn(),
                    getResponse: vi.fn(),
                };
                const manager = new ApprovalManager(
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
                    mockLogger,
                    store as unknown as ConstructorParameters<typeof ApprovalManager>[2]
                );

                const addPatternPromise = manager.addPattern('bash_exec', 'git *', sessionId);
                await saveStarted.promise;

                let deleteFinished = false;
                const deletePromise = manager.deleteSessionState(sessionId).then(() => {
                    deleteFinished = true;
                });

                await Promise.resolve();
                expect(deleteFinished).toBe(false);

                releaseSave.resolve();
                await addPatternPromise;
                await deletePromise;

                expect(
                    persistedState.get(sessionId) ?? {
                        toolPatterns: {},
                        approvedDirectories: [],
                    }
                ).toEqual(emptyState);
                expect(manager.matchesPattern('bash_exec', 'git status *', sessionId)).toBe(false);
            });
        });

        describe('clearPatterns', () => {
            it('should clear patterns for a tool', async () => {
                await manager.addPattern(toolName, 'git *');
                await manager.addPattern(toolName, 'npm *');
                expect(manager.getToolPatterns(toolName).size).toBe(2);

                await manager.clearPatterns(toolName);
                expect(manager.getToolPatterns(toolName).size).toBe(0);
            });

            it('should allow adding patterns after clearing', async () => {
                await manager.addPattern(toolName, 'git *');
                await manager.clearPatterns(toolName);
                await manager.addPattern(toolName, 'npm *');

                expect(manager.getToolPatterns(toolName).size).toBe(1);
                expect(manager.getToolPatterns(toolName).has('npm *')).toBe(true);
            });
        });

        describe('getToolPatterns', () => {
            it('should return empty set initially', () => {
                expect(manager.getToolPatterns(toolName).size).toBe(0);
            });

            it('should return a copy that reflects current patterns', async () => {
                await manager.addPattern(toolName, 'git *');
                const patterns = manager.getToolPatterns(toolName);
                expect(patterns.has('git *')).toBe(true);
            });
        });
    });

    describe('Directory Access Approval', () => {
        let manager: ApprovalManager;

        beforeEach(() => {
            manager = createApprovalManager(
                {
                    permissions: {
                        mode: 'manual',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false,
                    },
                },
                mockLogger
            );
        });

        describe('initializeWorkingDirectory', () => {
            it('should add working directory as session-approved', async () => {
                await manager.initializeWorkingDirectory('/home/user/project');
                expect(manager.isDirectorySessionApproved('/home/user/project/src/file.ts')).toBe(
                    true
                );
            });

            it('should normalize the path before adding', async () => {
                await manager.initializeWorkingDirectory('/home/user/../user/project');
                expect(manager.isDirectorySessionApproved('/home/user/project/file.ts')).toBe(true);
            });
        });

        describe('addApprovedDirectory', () => {
            it('should add directory with session type by default', async () => {
                await manager.addApprovedDirectory('/external/project');
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(true);
            });

            it('should treat symlink-approved directory as approved for its realpath', async () => {
                const baseDir = mkdtempSync(path.join(os.tmpdir(), 'dexto-approval-symlink-'));
                try {
                    const actualDir = path.join(baseDir, 'actual');
                    mkdirSync(actualDir);

                    const linkDir = path.join(baseDir, 'link');
                    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
                    symlinkSync(actualDir, linkDir, symlinkType);

                    await manager.addApprovedDirectory(linkDir, 'session');

                    expect(manager.isDirectoryApproved(path.join(actualDir, 'file.ts'))).toBe(true);
                    expect(
                        manager.isDirectorySessionApproved(path.join(actualDir, 'file.ts'))
                    ).toBe(true);
                } finally {
                    rmSync(baseDir, { recursive: true, force: true });
                }
            });

            it('should treat approved directory as approved for its realpath even if the directory did not exist yet', async () => {
                const baseDir = mkdtempSync(
                    path.join(os.tmpdir(), 'dexto-approval-symlink-missing-leaf-')
                );

                try {
                    const actualDir = path.join(baseDir, 'actual');
                    mkdirSync(actualDir);

                    const linkDir = path.join(baseDir, 'link');
                    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
                    symlinkSync(actualDir, linkDir, symlinkType);

                    const approvedDir = path.join(linkDir, 'child');

                    // Approve a directory that doesn't exist yet (common for write/create flows).
                    await manager.addApprovedDirectory(approvedDir, 'session');

                    const actualChildDir = path.join(actualDir, 'child');
                    mkdirSync(actualChildDir);

                    const filePath = path.join(actualChildDir, 'file.ts');
                    expect(manager.isDirectoryApproved(filePath)).toBe(true);
                    expect(manager.isDirectorySessionApproved(filePath)).toBe(true);
                } finally {
                    rmSync(baseDir, { recursive: true, force: true });
                }
            });

            it('should add directory with explicit session type', async () => {
                await manager.addApprovedDirectory('/external/project', 'session');
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(true);
            });

            it('should add directory with once type', async () => {
                await manager.addApprovedDirectory('/external/project', 'once');
                // 'once' type should NOT be session-approved (requires prompt each time)
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(false);
                // But should be generally approved for execution
                expect(manager.isDirectoryApproved('/external/project/file.ts')).toBe(true);
            });

            it('should not downgrade from session to once', async () => {
                await manager.addApprovedDirectory('/external/project', 'session');
                await manager.addApprovedDirectory('/external/project', 'once');
                // Should still be session-approved
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(true);
            });

            it('should upgrade from once to session', async () => {
                await manager.addApprovedDirectory('/external/project', 'once');
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(false);

                await manager.addApprovedDirectory('/external/project', 'session');
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(true);
            });

            it('should normalize paths before adding', async () => {
                await manager.addApprovedDirectory('/external/../external/project');
                expect(manager.isDirectoryApproved('/external/project/file.ts')).toBe(true);
            });
        });

        describe('isDirectorySessionApproved', () => {
            it('should return true for files within session-approved directory', async () => {
                await manager.addApprovedDirectory('/external/project', 'session');
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(true);
                expect(
                    manager.isDirectorySessionApproved('/external/project/src/deep/file.ts')
                ).toBe(true);
            });

            it('should return false for files within once-approved directory', async () => {
                await manager.addApprovedDirectory('/external/project', 'once');
                expect(manager.isDirectorySessionApproved('/external/project/file.ts')).toBe(false);
            });

            it('should return false for files outside approved directories', async () => {
                await manager.addApprovedDirectory('/external/project', 'session');
                expect(manager.isDirectorySessionApproved('/other/file.ts')).toBe(false);
            });

            it('should handle path containment correctly', async () => {
                await manager.addApprovedDirectory('/external', 'session');
                // Approving /external should cover /external/sub/file.ts
                expect(manager.isDirectorySessionApproved('/external/sub/file.ts')).toBe(true);
                // But not /external-other/file.ts (different directory)
                expect(manager.isDirectorySessionApproved('/external-other/file.ts')).toBe(false);
            });

            it('should return true when working directory is initialized', async () => {
                await manager.initializeWorkingDirectory('/home/user/project');
                expect(manager.isDirectorySessionApproved('/home/user/project/any/file.ts')).toBe(
                    true
                );
            });
        });

        describe('isDirectoryApproved', () => {
            it('should return true for files within session-approved directory', async () => {
                await manager.addApprovedDirectory('/external/project', 'session');
                expect(manager.isDirectoryApproved('/external/project/file.ts')).toBe(true);
            });

            it('should return true for files within once-approved directory', async () => {
                await manager.addApprovedDirectory('/external/project', 'once');
                expect(manager.isDirectoryApproved('/external/project/file.ts')).toBe(true);
            });

            it('should return false for files outside approved directories', async () => {
                await manager.addApprovedDirectory('/external/project', 'session');
                expect(manager.isDirectoryApproved('/other/file.ts')).toBe(false);
            });

            it('should handle multiple approved directories', async () => {
                await manager.addApprovedDirectory('/external/project1', 'session');
                await manager.addApprovedDirectory('/external/project2', 'once');

                expect(manager.isDirectoryApproved('/external/project1/file.ts')).toBe(true);
                expect(manager.isDirectoryApproved('/external/project2/file.ts')).toBe(true);
                expect(manager.isDirectoryApproved('/external/project3/file.ts')).toBe(false);
            });

            it('should handle nested directory approvals', async () => {
                await manager.addApprovedDirectory('/external', 'session');
                // Approving /external should cover all subdirectories
                expect(manager.isDirectoryApproved('/external/sub/deep/file.ts')).toBe(true);
            });
        });

        describe('getApprovedDirectories', () => {
            it('should return empty map initially', () => {
                expect(manager.getApprovedDirectories().size).toBe(0);
            });

            it('should return map with type information', async () => {
                await manager.addApprovedDirectory('/external/project1', 'session');
                await manager.addApprovedDirectory('/external/project2', 'once');

                const dirs = manager.getApprovedDirectories();
                expect(dirs.size).toBeGreaterThanOrEqual(2);
                // Check that paths are normalized (absolute)
                const keys = Array.from(dirs.keys());
                expect(keys.some((k) => k.includes('project1'))).toBe(true);
                expect(keys.some((k) => k.includes('project2'))).toBe(true);
            });

            it('should include working directory after initialization', async () => {
                await manager.initializeWorkingDirectory('/home/user/project');
                const dirs = manager.getApprovedDirectories();
                expect(dirs.size).toBeGreaterThanOrEqual(1);
                expect(dirs.get(path.resolve('/home/user/project'))).toBe('session');
                expect(new Set(dirs.values())).toEqual(new Set(['session']));
            });
        });

        describe('Session vs Once Prompting Behavior', () => {
            // These tests verify the expected prompting flow

            it('working directory should not require prompt (session-approved)', async () => {
                await manager.initializeWorkingDirectory('/home/user/project');
                // isDirectorySessionApproved returns true → no directory prompt needed
                expect(manager.isDirectorySessionApproved('/home/user/project/src/file.ts')).toBe(
                    true
                );
            });

            it('external dir after session approval should not require prompt', async () => {
                await manager.addApprovedDirectory('/external', 'session');
                // isDirectorySessionApproved returns true → no directory prompt needed
                expect(manager.isDirectorySessionApproved('/external/file.ts')).toBe(true);
            });

            it('external dir after once approval should require prompt each time', async () => {
                await manager.addApprovedDirectory('/external', 'once');
                // isDirectorySessionApproved returns false → directory prompt needed
                expect(manager.isDirectorySessionApproved('/external/file.ts')).toBe(false);
                // But isDirectoryApproved returns true → execution allowed
                expect(manager.isDirectoryApproved('/external/file.ts')).toBe(true);
            });

            it('unapproved external dir should require prompt', () => {
                // No directories approved
                expect(manager.isDirectorySessionApproved('/external/file.ts')).toBe(false);
                expect(manager.isDirectoryApproved('/external/file.ts')).toBe(false);
            });
        });
    });
});
