import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ApprovalRequest, ApprovalResponse } from '@dexto/core';
import { ApprovalType, ApprovalStatus, DenialReason } from '@dexto/core';
import { createManualApprovalHandler } from './manual-approval-handler.js';
import type { ApprovalCoordinator } from './approval-coordinator.js';

describe('createManualApprovalHandler', () => {
    let mockCoordinator: ApprovalCoordinator;
    let listeners: Map<string, ((response: ApprovalResponse) => void)[]>;

    beforeEach(() => {
        listeners = new Map();

        mockCoordinator = {
            on: vi.fn((event: string, listener: (response: ApprovalResponse) => void) => {
                const eventListeners = listeners.get(event) || [];
                eventListeners.push(listener);
                listeners.set(event, eventListeners);
            }),
            off: vi.fn((event: string, listener: (response: ApprovalResponse) => void) => {
                const eventListeners = listeners.get(event) || [];
                const index = eventListeners.indexOf(listener);
                if (index > -1) {
                    eventListeners.splice(index, 1);
                }
            }),
            emitRequest: vi.fn(),
            emitResponse: vi.fn(),
        } as unknown as ApprovalCoordinator;
    });

    describe('Timeout Configuration', () => {
        it('should not timeout when timeout is undefined (infinite wait)', async () => {
            const handler = createManualApprovalHandler(mockCoordinator);

            const request: ApprovalRequest = {
                approvalId: 'test-infinite-1',
                type: ApprovalType.TOOL_CONFIRMATION,
                timestamp: new Date(),
                // No timeout - should wait indefinitely
                metadata: {
                    toolName: 'test_tool',
                    toolCallId: 'test-call-id',
                    args: {},
                },
            };

            // Start the approval request (won't resolve until we emit a response)
            const approvalPromise = handler(request);

            // Verify the request was emitted
            expect(mockCoordinator.emitRequest).toHaveBeenCalledWith(request);

            // Wait a bit to ensure no timeout occurred
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Manually resolve by emitting a response
            const eventListeners = listeners.get('approval:response') || [];
            eventListeners.forEach((listener) => {
                listener({
                    approvalId: 'test-infinite-1',
                    status: ApprovalStatus.APPROVED,
                });
            });

            const response = await approvalPromise;
            expect(response.status).toBe(ApprovalStatus.APPROVED);
        });

        it('should timeout when timeout is specified', async () => {
            const handler = createManualApprovalHandler(mockCoordinator);

            const request: ApprovalRequest = {
                approvalId: 'test-timeout-1',
                type: ApprovalType.TOOL_CONFIRMATION,
                timestamp: new Date(),
                timeout: 50, // 50ms timeout
                metadata: {
                    toolName: 'test_tool',
                    toolCallId: 'test-call-id',
                    args: {},
                },
            };

            const response = await handler(request);

            expect(response.status).toBe(ApprovalStatus.CANCELLED);
            expect(response.reason).toBe(DenialReason.TIMEOUT);
            expect(response.message).toContain('timed out');
            expect(response.timeoutMs).toBe(50);
        });

        it('should emit timeout response to coordinator when timeout occurs', async () => {
            const handler = createManualApprovalHandler(mockCoordinator);

            const request: ApprovalRequest = {
                approvalId: 'test-timeout-emit',
                type: ApprovalType.TOOL_CONFIRMATION,
                timestamp: new Date(),
                timeout: 50,
                metadata: {
                    toolName: 'test_tool',
                    toolCallId: 'test-call-id',
                    args: {},
                },
            };

            await handler(request);

            // Verify coordinator received the timeout response
            expect(mockCoordinator.emitResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    approvalId: 'test-timeout-emit',
                    status: ApprovalStatus.CANCELLED,
                    reason: DenialReason.TIMEOUT,
                })
            );
        });

        it('should clear timeout when response is received before timeout', async () => {
            vi.useFakeTimers();
            const handler = createManualApprovalHandler(mockCoordinator);

            const request: ApprovalRequest = {
                approvalId: 'test-clear-timeout',
                type: ApprovalType.TOOL_CONFIRMATION,
                timestamp: new Date(),
                timeout: 5000, // 5 second timeout
                metadata: {
                    toolName: 'test_tool',
                    toolCallId: 'test-call-id',
                    args: {},
                },
            };

            const approvalPromise = handler(request);

            // Emit response before timeout
            const eventListeners = listeners.get('approval:response') || [];
            eventListeners.forEach((listener) => {
                listener({
                    approvalId: 'test-clear-timeout',
                    status: ApprovalStatus.APPROVED,
                });
            });

            const response = await approvalPromise;
            expect(response.status).toBe(ApprovalStatus.APPROVED);

            // Advance time past the timeout - should not cause any issues
            vi.advanceTimersByTime(6000);

            vi.useRealTimers();
        });

        it('should handle elicitation with no timeout (infinite wait)', async () => {
            const handler = createManualApprovalHandler(mockCoordinator);

            const request: ApprovalRequest = {
                approvalId: 'test-elicitation-infinite',
                type: ApprovalType.ELICITATION,
                timestamp: new Date(),
                // No timeout for elicitation
                metadata: {
                    schema: { type: 'object' as const, properties: {} },
                    prompt: 'Enter data',
                    serverName: 'TestServer',
                },
            };

            const approvalPromise = handler(request);

            // Wait briefly
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Resolve the elicitation
            const eventListeners = listeners.get('approval:response') || [];
            eventListeners.forEach((listener) => {
                listener({
                    approvalId: 'test-elicitation-infinite',
                    status: ApprovalStatus.APPROVED,
                    data: { formData: { name: 'test' } },
                });
            });

            const response = await approvalPromise;
            expect(response.status).toBe(ApprovalStatus.APPROVED);
        });
    });

    describe('Cancellation Support', () => {
        it('should support cancelling pending approvals', async () => {
            const handler = createManualApprovalHandler(mockCoordinator);

            const request: ApprovalRequest = {
                approvalId: 'test-cancel-1',
                type: ApprovalType.TOOL_CONFIRMATION,
                timestamp: new Date(),
                metadata: {
                    toolName: 'test_tool',
                    toolCallId: 'test-call-id',
                    args: {},
                },
            };

            const approvalPromise = handler(request);

            // Cancel the approval
            handler.cancel?.('test-cancel-1');

            const response = await approvalPromise;
            expect(response.status).toBe(ApprovalStatus.CANCELLED);
            expect(response.reason).toBe(DenialReason.SYSTEM_CANCELLED);
        });

        it('should track pending approvals', () => {
            const handler = createManualApprovalHandler(mockCoordinator);

            const request1: ApprovalRequest = {
                approvalId: 'pending-1',
                type: ApprovalType.TOOL_CONFIRMATION,
                timestamp: new Date(),
                metadata: { toolName: 'tool1', toolCallId: 'test-call-id-1', args: {} },
            };

            const request2: ApprovalRequest = {
                approvalId: 'pending-2',
                type: ApprovalType.TOOL_CONFIRMATION,
                timestamp: new Date(),
                metadata: { toolName: 'tool2', toolCallId: 'test-call-id-2', args: {} },
            };

            // Start both requests (don't await)
            handler(request1);
            handler(request2);

            const pending = handler.getPending?.() || [];
            expect(pending).toContain('pending-1');
            expect(pending).toContain('pending-2');
        });

        it('should cancel all pending approvals', async () => {
            const handler = createManualApprovalHandler(mockCoordinator);

            const request1: ApprovalRequest = {
                approvalId: 'cancel-all-1',
                type: ApprovalType.TOOL_CONFIRMATION,
                timestamp: new Date(),
                metadata: { toolName: 'tool1', toolCallId: 'test-call-id-1', args: {} },
            };

            const request2: ApprovalRequest = {
                approvalId: 'cancel-all-2',
                type: ApprovalType.TOOL_CONFIRMATION,
                timestamp: new Date(),
                metadata: { toolName: 'tool2', toolCallId: 'test-call-id-2', args: {} },
            };

            const promise1 = handler(request1);
            const promise2 = handler(request2);

            // Cancel all
            handler.cancelAll?.();

            const [response1, response2] = await Promise.all([promise1, promise2]);

            expect(response1.status).toBe(ApprovalStatus.CANCELLED);
            expect(response2.status).toBe(ApprovalStatus.CANCELLED);
        });
    });

    describe('Response Handling', () => {
        it('should only handle responses for matching approvalId', async () => {
            const handler = createManualApprovalHandler(mockCoordinator);

            const request: ApprovalRequest = {
                approvalId: 'test-match-1',
                type: ApprovalType.TOOL_CONFIRMATION,
                timestamp: new Date(),
                metadata: { toolName: 'test_tool', toolCallId: 'test-call-id', args: {} },
            };

            const approvalPromise = handler(request);

            // Emit response for different approvalId - should be ignored
            const eventListeners = listeners.get('approval:response') || [];
            eventListeners.forEach((listener) => {
                listener({
                    approvalId: 'different-id',
                    status: ApprovalStatus.APPROVED,
                });
            });

            // Wait a bit - request should still be pending
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Now emit correct response
            eventListeners.forEach((listener) => {
                listener({
                    approvalId: 'test-match-1',
                    status: ApprovalStatus.DENIED,
                    reason: DenialReason.USER_DENIED,
                });
            });

            const response = await approvalPromise;
            expect(response.status).toBe(ApprovalStatus.DENIED);
            expect(response.reason).toBe(DenialReason.USER_DENIED);
        });
    });
});
