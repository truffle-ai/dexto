import { describe, it, expect, beforeEach } from 'vitest';
import { useApprovalStore } from './approvalStore.js';
import type { ApprovalRequest, ApprovalResponse } from '@dexto/core';
import { ApprovalType, ApprovalStatus } from '@dexto/core';

// Helper to create test approval requests
function createTestApprovalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
    return {
        approvalId: `approval-${Math.random().toString(36).slice(2, 11)}`,
        type: ApprovalType.TOOL_APPROVAL,
        sessionId: 'test-session',
        timeout: 30000,
        timestamp: new Date(),
        metadata: {
            toolName: 'test_tool',
            args: {},
        },
        ...overrides,
    } as ApprovalRequest;
}

// Helper to create test approval responses
function createTestApprovalResponse(
    approvalId: string,
    status: ApprovalStatus,
    overrides: Partial<ApprovalResponse> = {}
): ApprovalResponse {
    return {
        approvalId,
        status,
        sessionId: 'test-session',
        ...overrides,
    } as ApprovalResponse;
}

describe('approvalStore', () => {
    beforeEach(() => {
        // Reset store to default state
        useApprovalStore.setState({
            pendingApproval: null,
            queue: [],
        });
    });

    describe('addApproval', () => {
        it('should set pendingApproval when empty', () => {
            const request = createTestApprovalRequest();
            useApprovalStore.getState().addApproval(request);

            expect(useApprovalStore.getState().pendingApproval).toEqual(request);
            expect(useApprovalStore.getState().queue).toHaveLength(0);
        });

        it('should queue when pendingApproval exists', () => {
            const request1 = createTestApprovalRequest();
            const request2 = createTestApprovalRequest();

            useApprovalStore.getState().addApproval(request1);
            useApprovalStore.getState().addApproval(request2);

            expect(useApprovalStore.getState().pendingApproval).toEqual(request1);
            expect(useApprovalStore.getState().queue).toHaveLength(1);
            expect(useApprovalStore.getState().queue[0]).toEqual(request2);
        });

        it('should queue multiple requests in order', () => {
            const request1 = createTestApprovalRequest();
            const request2 = createTestApprovalRequest();
            const request3 = createTestApprovalRequest();

            useApprovalStore.getState().addApproval(request1);
            useApprovalStore.getState().addApproval(request2);
            useApprovalStore.getState().addApproval(request3);

            expect(useApprovalStore.getState().pendingApproval).toEqual(request1);
            expect(useApprovalStore.getState().queue).toHaveLength(2);
            expect(useApprovalStore.getState().queue[0]).toEqual(request2);
            expect(useApprovalStore.getState().queue[1]).toEqual(request3);
        });
    });

    describe('processResponse', () => {
        it('should clear pendingApproval for approved status', () => {
            const request = createTestApprovalRequest();
            useApprovalStore.getState().addApproval(request);

            const response = createTestApprovalResponse(
                request.approvalId,
                ApprovalStatus.APPROVED
            );
            useApprovalStore.getState().processResponse(response);

            expect(useApprovalStore.getState().pendingApproval).toBeNull();
        });

        it('should clear pendingApproval for denied status', () => {
            const request = createTestApprovalRequest();
            useApprovalStore.getState().addApproval(request);

            const response = createTestApprovalResponse(request.approvalId, ApprovalStatus.DENIED);
            useApprovalStore.getState().processResponse(response);

            expect(useApprovalStore.getState().pendingApproval).toBeNull();
        });

        it('should clear pendingApproval for cancelled status', () => {
            const request = createTestApprovalRequest();
            useApprovalStore.getState().addApproval(request);

            const response = createTestApprovalResponse(
                request.approvalId,
                ApprovalStatus.CANCELLED
            );
            useApprovalStore.getState().processResponse(response);

            expect(useApprovalStore.getState().pendingApproval).toBeNull();
        });

        it('should process next in queue after terminal status', () => {
            const request1 = createTestApprovalRequest();
            const request2 = createTestApprovalRequest();

            useApprovalStore.getState().addApproval(request1);
            useApprovalStore.getState().addApproval(request2);

            const response = createTestApprovalResponse(
                request1.approvalId,
                ApprovalStatus.APPROVED
            );
            useApprovalStore.getState().processResponse(response);

            expect(useApprovalStore.getState().pendingApproval).toEqual(request2);
            expect(useApprovalStore.getState().queue).toHaveLength(0);
        });

        it('should handle multiple queued items', () => {
            const request1 = createTestApprovalRequest();
            const request2 = createTestApprovalRequest();
            const request3 = createTestApprovalRequest();

            useApprovalStore.getState().addApproval(request1);
            useApprovalStore.getState().addApproval(request2);
            useApprovalStore.getState().addApproval(request3);

            // Process first
            const response1 = createTestApprovalResponse(
                request1.approvalId,
                ApprovalStatus.APPROVED
            );
            useApprovalStore.getState().processResponse(response1);

            expect(useApprovalStore.getState().pendingApproval).toEqual(request2);
            expect(useApprovalStore.getState().queue).toHaveLength(1);
            expect(useApprovalStore.getState().queue[0]).toEqual(request3);

            // Process second
            const response2 = createTestApprovalResponse(
                request2.approvalId,
                ApprovalStatus.DENIED
            );
            useApprovalStore.getState().processResponse(response2);

            expect(useApprovalStore.getState().pendingApproval).toEqual(request3);
            expect(useApprovalStore.getState().queue).toHaveLength(0);
        });

        it('should not process response for mismatched approvalId', () => {
            const request = createTestApprovalRequest();
            useApprovalStore.getState().addApproval(request);

            const response = createTestApprovalResponse('wrong-id', ApprovalStatus.APPROVED);
            useApprovalStore.getState().processResponse(response);

            expect(useApprovalStore.getState().pendingApproval).toEqual(request);
        });

        it('should handle response when no pending approval', () => {
            const response = createTestApprovalResponse('some-id', ApprovalStatus.APPROVED);
            useApprovalStore.getState().processResponse(response);

            expect(useApprovalStore.getState().pendingApproval).toBeNull();
        });
    });

    describe('clearApproval', () => {
        it('should clear current and process next in queue', () => {
            const request1 = createTestApprovalRequest();
            const request2 = createTestApprovalRequest();

            useApprovalStore.getState().addApproval(request1);
            useApprovalStore.getState().addApproval(request2);

            useApprovalStore.getState().clearApproval();

            expect(useApprovalStore.getState().pendingApproval).toEqual(request2);
            expect(useApprovalStore.getState().queue).toHaveLength(0);
        });

        it('should set pendingApproval to null when queue is empty', () => {
            const request = createTestApprovalRequest();
            useApprovalStore.getState().addApproval(request);

            useApprovalStore.getState().clearApproval();

            expect(useApprovalStore.getState().pendingApproval).toBeNull();
        });

        it('should handle clearApproval when nothing is pending', () => {
            useApprovalStore.getState().clearApproval();

            expect(useApprovalStore.getState().pendingApproval).toBeNull();
            expect(useApprovalStore.getState().queue).toHaveLength(0);
        });
    });

    describe('clearAll', () => {
        it('should clear everything', () => {
            const request1 = createTestApprovalRequest();
            const request2 = createTestApprovalRequest();
            const request3 = createTestApprovalRequest();

            useApprovalStore.getState().addApproval(request1);
            useApprovalStore.getState().addApproval(request2);
            useApprovalStore.getState().addApproval(request3);

            useApprovalStore.getState().clearAll();

            expect(useApprovalStore.getState().pendingApproval).toBeNull();
            expect(useApprovalStore.getState().queue).toHaveLength(0);
        });
    });

    describe('selectors', () => {
        describe('getPendingCount', () => {
            it('should return 0 when nothing is pending', () => {
                expect(useApprovalStore.getState().getPendingCount()).toBe(0);
            });

            it('should return 1 when only pendingApproval exists', () => {
                const request = createTestApprovalRequest();
                useApprovalStore.getState().addApproval(request);

                expect(useApprovalStore.getState().getPendingCount()).toBe(1);
            });

            it('should return correct count with queue', () => {
                const request1 = createTestApprovalRequest();
                const request2 = createTestApprovalRequest();
                const request3 = createTestApprovalRequest();

                useApprovalStore.getState().addApproval(request1);
                useApprovalStore.getState().addApproval(request2);
                useApprovalStore.getState().addApproval(request3);

                expect(useApprovalStore.getState().getPendingCount()).toBe(3);
            });
        });

        describe('getPendingForSession', () => {
            it('should return empty array for session with no approvals', () => {
                const result = useApprovalStore.getState().getPendingForSession('session-1');
                expect(result).toHaveLength(0);
            });

            it('should return only approvals for specified session', () => {
                const request1 = createTestApprovalRequest({ sessionId: 'session-1' });
                const request2 = createTestApprovalRequest({ sessionId: 'session-2' });
                const request3 = createTestApprovalRequest({ sessionId: 'session-1' });

                useApprovalStore.getState().addApproval(request1);
                useApprovalStore.getState().addApproval(request2);
                useApprovalStore.getState().addApproval(request3);

                const result = useApprovalStore.getState().getPendingForSession('session-1');
                expect(result).toHaveLength(2);
                expect(result[0]).toEqual(request1);
                expect(result[1]).toEqual(request3);
            });

            it('should include both pending and queued for session', () => {
                const request1 = createTestApprovalRequest({ sessionId: 'session-1' });
                const request2 = createTestApprovalRequest({ sessionId: 'session-1' });

                useApprovalStore.getState().addApproval(request1);
                useApprovalStore.getState().addApproval(request2);

                const result = useApprovalStore.getState().getPendingForSession('session-1');
                expect(result).toHaveLength(2);
            });
        });

        describe('hasPendingApproval', () => {
            it('should return false when nothing is pending', () => {
                expect(useApprovalStore.getState().hasPendingApproval()).toBe(false);
            });

            it('should return true when approval is pending', () => {
                const request = createTestApprovalRequest();
                useApprovalStore.getState().addApproval(request);

                expect(useApprovalStore.getState().hasPendingApproval()).toBe(true);
            });

            it('should return false after clearing', () => {
                const request = createTestApprovalRequest();
                useApprovalStore.getState().addApproval(request);
                useApprovalStore.getState().clearApproval();

                expect(useApprovalStore.getState().hasPendingApproval()).toBe(false);
            });
        });
    });

    describe('session isolation', () => {
        it('should keep different sessions separate in queue', () => {
            const session1Request1 = createTestApprovalRequest({ sessionId: 'session-1' });
            const session2Request1 = createTestApprovalRequest({ sessionId: 'session-2' });
            const session1Request2 = createTestApprovalRequest({ sessionId: 'session-1' });

            useApprovalStore.getState().addApproval(session1Request1);
            useApprovalStore.getState().addApproval(session2Request1);
            useApprovalStore.getState().addApproval(session1Request2);

            const session1Pending = useApprovalStore.getState().getPendingForSession('session-1');
            const session2Pending = useApprovalStore.getState().getPendingForSession('session-2');

            expect(session1Pending).toHaveLength(2);
            expect(session2Pending).toHaveLength(1);
        });
    });
});
