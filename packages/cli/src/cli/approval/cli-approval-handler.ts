/**
 * CLI-specific Approval Handler
 *
 * Creates a manual approval handler that works directly with AgentEventBus
 * for the CLI/TUI mode. Unlike the server's ManualApprovalHandler which uses
 * ApprovalCoordinator for HTTP-based flows, this handler emits events directly
 * to the event bus that the TUI listens to.
 *
 * Flow:
 * 1. Handler emits 'approval:request' → EventBus → TUI shows prompt
 * 2. User responds in TUI → EventBus emits 'approval:response' → Handler resolves
 * 3. For auto-approvals (parallel tools), handler emits 'approval:response' → TUI dismisses
 */

import type {
    ApprovalHandler,
    ApprovalRequest,
    ApprovalResponse,
    AgentEventMap,
} from '@dexto/core';
import { ApprovalStatus, DenialReason } from '@dexto/core';

type ApprovalEventBus = {
    on: <K extends keyof AgentEventMap>(
        event: K,
        listener: AgentEventMap[K] extends void ? () => void : (payload: AgentEventMap[K]) => void,
        options?: { signal?: AbortSignal }
    ) => void;
    emit: <K extends keyof AgentEventMap>(
        event: K,
        ...args: AgentEventMap[K] extends void ? [] : [AgentEventMap[K]]
    ) => boolean;
};

/**
 * Creates a manual approval handler for CLI mode that uses AgentEventBus directly.
 *
 * @param eventBus The agent event bus for request/response communication
 * @returns ApprovalHandler with cancellation and auto-approve support
 *
 * @example
 * ```typescript
 * const handler = createCLIApprovalHandler(agent);
 * agent.setApprovalHandler(handler);
 * ```
 */
export function createCLIApprovalHandler(eventBus: ApprovalEventBus): ApprovalHandler {
    // Track pending approvals for cancellation support
    const pendingApprovals = new Map<
        string,
        {
            cleanup: () => void;
            resolve: (response: ApprovalResponse) => void;
            request: ApprovalRequest;
        }
    >();

    const handleApproval = (request: ApprovalRequest): Promise<ApprovalResponse> => {
        return new Promise<ApprovalResponse>((resolve) => {
            // Use per-request timeout (optional - undefined means no timeout)
            const effectiveTimeout = request.timeout;

            // Set timeout timer ONLY if timeout is specified
            let timer: NodeJS.Timeout | undefined;
            if (effectiveTimeout !== undefined) {
                timer = setTimeout(() => {
                    cleanup();
                    pendingApprovals.delete(request.approvalId);

                    // Create timeout response
                    const timeoutResponse: ApprovalResponse = {
                        approvalId: request.approvalId,
                        status: ApprovalStatus.CANCELLED,
                        sessionId: request.sessionId,
                        reason: DenialReason.TIMEOUT,
                        message: `Approval request timed out after ${effectiveTimeout}ms`,
                        timeoutMs: effectiveTimeout,
                    };

                    // Emit timeout response so TUI can dismiss the prompt
                    eventBus.emit('approval:response', timeoutResponse);

                    resolve(timeoutResponse);
                }, effectiveTimeout);
            }

            // Cleanup function to remove listener and clear timeout
            const controller = new AbortController();
            const cleanup = () => {
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
                controller.abort();
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

            // Register listener with abort signal for cleanup
            eventBus.on('approval:response', listener, { signal: controller.signal });

            // Store for cancellation support
            pendingApprovals.set(request.approvalId, {
                cleanup,
                resolve,
                request,
            });

            // Emit the approval:request event for TUI to receive
            eventBus.emit('approval:request', request);
        });
    };

    const handler: ApprovalHandler = Object.assign(handleApproval, {
        cancel: (approvalId: string): void => {
            const pending = pendingApprovals.get(approvalId);
            if (pending) {
                pending.cleanup();
                pendingApprovals.delete(approvalId);

                // Create cancellation response
                const cancelResponse: ApprovalResponse = {
                    approvalId,
                    status: ApprovalStatus.CANCELLED,
                    sessionId: pending.request.sessionId,
                    reason: DenialReason.SYSTEM_CANCELLED,
                    message: 'Approval request was cancelled',
                };

                // Emit cancellation event so TUI can dismiss the prompt
                eventBus.emit('approval:response', cancelResponse);

                // Resolve with CANCELLED response
                pending.resolve(cancelResponse);
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

        getPendingRequests: (): ApprovalRequest[] => {
            return Array.from(pendingApprovals.values()).map((p) => p.request);
        },

        /**
         * Auto-approve pending requests that match a predicate.
         * Used when a pattern is remembered to auto-approve other parallel requests
         * that would now match the same pattern.
         */
        autoApprovePending: (
            predicate: (request: ApprovalRequest) => boolean,
            responseData?: Record<string, unknown>
        ): number => {
            let count = 0;

            // Find all pending approvals that match the predicate
            for (const [approvalId, pending] of pendingApprovals) {
                if (predicate(pending.request)) {
                    // Clean up the pending state
                    pending.cleanup();
                    pendingApprovals.delete(approvalId);

                    // Create auto-approval response
                    const autoApproveResponse: ApprovalResponse = {
                        approvalId,
                        status: ApprovalStatus.APPROVED,
                        sessionId: pending.request.sessionId,
                        message: 'Auto-approved due to matching remembered pattern',
                        data: responseData,
                    };

                    // Emit response so TUI can dismiss the prompt
                    eventBus.emit('approval:response', autoApproveResponse);

                    // Resolve the pending promise
                    pending.resolve(autoApproveResponse);
                    count++;
                }
            }

            return count;
        },
    });

    return handler;
}
