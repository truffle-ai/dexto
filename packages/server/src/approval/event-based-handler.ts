import type {
    ApprovalHandler,
    ApprovalRequest,
    ApprovalResponse,
    AgentEventBus,
} from '@dexto/core';
import { ApprovalStatus, DenialReason } from '@dexto/core';

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
 * Creates a manual approval handler that uses the AgentEventBus for communication.
 *
 * This handler emits `approval:request` events and waits for `approval:response` events,
 * enabling SSE-based approval flows where:
 * 1. Server emits approval:request → SSE subscriber forwards to client
 * 2. Client sends decision via POST /api/approvals/{approvalId}
 * 3. Server emits approval:response → this handler resolves
 *
 * The returned handler includes cancellation methods (cancel, cancelAll, getPending)
 * for managing pending approval requests.
 *
 * @param eventBus The agent's event bus for emitting and listening to events
 * @param timeoutMs Timeout in milliseconds for waiting for approval response
 * @returns ManualApprovalHandler with cancellation support
 *
 * @example
 * ```typescript
 * const handler = createManualApprovalHandler(
 *   agent.agentEventBus,
 *   120_000 // 2 minutes
 * );
 * agent.setApprovalHandler(handler);
 *
 * // Later, cancel a specific approval
 * handler.cancel('approval-id-123');
 * ```
 */
export function createManualApprovalHandler(
    eventBus: AgentEventBus,
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
                eventBus.emit('approval:response', timeoutResponse);

                reject(new Error(`Approval request timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            // Cleanup function to remove listener and clear timeout
            const cleanup = () => {
                clearTimeout(timer);
                eventBus.off('approval:response', listener);
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
            eventBus.on('approval:response', listener);

            // Store for cancellation support
            pendingApprovals.set(request.approvalId, {
                cleanup,
                reject,
                request,
            });

            // Emit the approval:request event
            // SSE subscribers will pick this up and forward to clients
            eventBus.emit('approval:request', {
                approvalId: request.approvalId,
                type: request.type,
                timestamp: request.timestamp,
                metadata: request.metadata,
                sessionId: request.sessionId,
                timeout: request.timeout,
            });
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
                eventBus.emit('approval:response', {
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
