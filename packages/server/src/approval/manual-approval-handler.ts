import type { ApprovalHandler, ApprovalRequest, ApprovalResponse } from '@dexto/core';
import { ApprovalStatus, DenialReason } from '@dexto/core';
import type { ApprovalCoordinator } from './approval-coordinator.js';

/**
 * Creates a manual approval handler that uses ApprovalCoordinator for server communication.
 *
 * This handler emits `approval:request` and waits for `approval:response` via the coordinator,
 * enabling SSE-based approval flows where:
 * 1. Handler emits approval:request → Coordinator → SSE endpoint forwards to client
 * 2. Client sends decision via POST /api/approvals/{approvalId}
 * 3. API route emits approval:response → Coordinator → Handler resolves
 *
 * The returned handler implements the optional cancellation methods (cancel, cancelAll, getPending)
 * for managing pending approval requests.
 *
 * Timeouts are handled per-request using the timeout value from ApprovalRequest, which
 * is set by ApprovalManager based on the request type (tool confirmation vs elicitation).
 *
 * @param coordinator The approval coordinator for request/response communication
 * @returns ApprovalHandler with cancellation support
 *
 * @example
 * ```typescript
 * const coordinator = new ApprovalCoordinator();
 * const handler = createManualApprovalHandler(coordinator);
 * agent.setApprovalHandler(handler);
 *
 * // Later, cancel a specific approval (if handler supports it)
 * handler.cancel?.('approval-id-123');
 * ```
 */
export function createManualApprovalHandler(coordinator: ApprovalCoordinator): ApprovalHandler {
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
            // Use per-request timeout (always set by ApprovalManager based on request type)
            // - Tool confirmations use config.toolConfirmation.timeout
            // - Elicitations use config.elicitation.timeout
            const effectiveTimeout = request.timeout;

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
                    message: `Approval request timed out after ${effectiveTimeout}ms`,
                };
                coordinator.emitResponse(timeoutResponse);

                reject(new Error(`Approval request timed out after ${effectiveTimeout}ms`));
            }, effectiveTimeout);

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

    const handler: ApprovalHandler = Object.assign(handleApproval, {
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
                handler.cancel?.(approvalId);
            }
        },

        getPending: (): string[] => {
            return Array.from(pendingApprovals.keys());
        },
    });

    return handler;
}
