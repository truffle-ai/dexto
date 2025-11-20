import type { ApprovalHandler, ApprovalRequest, ApprovalResponse } from '@dexto/core';
import { ApprovalStatus, DenialReason } from '@dexto/core';
import type { ApprovalCoordinator } from './approval-coordinator.js';

/**
 * Extended approval handler with cancellation support
 */
export interface ManualApprovalHandler extends ApprovalHandler {
    /**
     * Cancel a specific approval request
     */
    cancel: (approvalId: string) => void;

    /**
     * Cancel all pending approval requests
     */
    cancelAll: () => void;

    /**
     * Get list of pending approval request IDs
     */
    getPending: () => string[];
}

/**
 * Creates a manual approval handler that uses ApprovalCoordinator for server communication.
 *
 * This handler emits `approval:request` and waits for `approval:response` via the coordinator,
 * enabling SSE-based approval flows where:
 * 1. Handler emits approval:request → Coordinator → SSE endpoint forwards to client
 * 2. Client sends decision via POST /api/approvals/{approvalId}
 * 3. API route emits approval:response → Coordinator → Handler resolves
 *
 * The returned handler includes cancellation methods (cancel, cancelAll, getPending)
 * for managing pending approval requests.
 *
 * @param coordinator The approval coordinator for request/response communication
 * @param timeoutMs Timeout in milliseconds for waiting for approval response
 * @returns ManualApprovalHandler with cancellation support
 *
 * @example
 * ```typescript
 * const coordinator = new ApprovalCoordinator();
 * const handler = createManualApprovalHandler(coordinator, 120_000);
 * agent.setApprovalHandler(handler);
 *
 * // Later, cancel a specific approval
 * handler.cancel('approval-id-123');
 * ```
 */
export function createManualApprovalHandler(
    coordinator: ApprovalCoordinator,
    timeoutMs: number
): ManualApprovalHandler {
    // Track pending approvals for cancellation support
    const pendingApprovals = new Map<
        string,
        {
            cleanup: () => void;
            reject: (error: Error) => void;
            request: ApprovalRequest;
        }
    >();

    const handleApproval = (request: ApprovalRequest): Promise<ApprovalResponse> => {
        return new Promise<ApprovalResponse>((resolve, reject) => {
            // Set timeout timer
            const timer = setTimeout(() => {
                cleanup();
                pendingApprovals.delete(request.approvalId);

                // Emit timeout response so UI/clients can dismiss the prompt
                const timeoutResponse: ApprovalResponse = {
                    approvalId: request.approvalId,
                    status: ApprovalStatus.CANCELLED,
                    sessionId: request.sessionId,
                    reason: DenialReason.TIMEOUT,
                    message: `Approval request timed out after ${timeoutMs}ms`,
                };
                coordinator.emitResponse(timeoutResponse);

                reject(new Error(`Approval request timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            // Cleanup function to remove listener and clear timeout
            let cleanupListener: (() => void) | null = null;
            const cleanup = () => {
                clearTimeout(timer);
                if (cleanupListener) {
                    cleanupListener();
                    cleanupListener = null;
                }
            };

            // Listen for approval:response events
            const listener = (res: ApprovalResponse) => {
                // Only handle responses for this specific approval
                if (res.approvalId === request.approvalId) {
                    cleanup();
                    pendingApprovals.delete(request.approvalId);
                    resolve(res);
                }
            };

            // Register listener
            coordinator.on('approval:response', listener);
            cleanupListener = () => coordinator.off('approval:response', listener);

            // Store for cancellation support
            pendingApprovals.set(request.approvalId, {
                cleanup,
                reject,
                request,
            });

            // Emit the approval:request event via coordinator
            // SSE endpoints will subscribe to coordinator and forward to clients
            coordinator.emitRequest(request);
        });
    };

    const handler: ManualApprovalHandler = Object.assign(handleApproval, {
        cancel: (approvalId: string): void => {
            const pending = pendingApprovals.get(approvalId);
            if (pending) {
                pending.cleanup();
                pending.reject(new Error('Approval request was cancelled'));
                pendingApprovals.delete(approvalId);

                // Emit cancellation event so UI listeners can dismiss the prompt
                coordinator.emitResponse({
                    approvalId,
                    status: ApprovalStatus.CANCELLED,
                    sessionId: pending.request.sessionId,
                    reason: DenialReason.SYSTEM_CANCELLED,
                    message: 'Approval request was cancelled',
                });
            }
        },

        cancelAll: (): void => {
            for (const [approvalId] of pendingApprovals) {
                handler.cancel(approvalId);
            }
        },

        getPending: (): string[] => {
            return Array.from(pendingApprovals.keys());
        },
    });

    return handler;
}
