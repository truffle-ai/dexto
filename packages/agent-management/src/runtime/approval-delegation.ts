/**
 * Approval Delegation for Sub-Agents
 *
 * Creates ApprovalHandler instances that delegate approval requests
 * from sub-agents to the parent agent's approval system.
 */

import type {
    ApprovalHandler,
    ApprovalRequest,
    ApprovalResponse,
    ApprovalRequestDetails,
    ApprovalManager,
    IDextoLogger,
} from '@dexto/core';

/**
 * Extended metadata type that includes delegation information
 */
interface DelegatedMetadata {
    /** Original metadata from the request */
    [key: string]: unknown;
    /** ID of the sub-agent that originated the request */
    delegatedFromAgent: string;
}

/**
 * Creates an ApprovalHandler that delegates requests to a parent's ApprovalManager.
 *
 * This allows sub-agent tool approvals to flow through the parent's approval system,
 * ensuring the user sees a unified approval UI regardless of which agent made the request.
 *
 * @param parentApprovalManager - The parent agent's ApprovalManager
 * @param subAgentId - ID of the sub-agent for tracking
 * @param logger - Logger for debugging
 * @returns An ApprovalHandler that can be set on the sub-agent's ApprovalManager
 *
 * @example
 * ```typescript
 * const delegatingHandler = createDelegatingApprovalHandler(
 *   parentAgent.services.approvalManager,
 *   subAgentId,
 *   logger
 * );
 * subAgent.services.approvalManager.setHandler(delegatingHandler);
 * ```
 */
export function createDelegatingApprovalHandler(
    parentApprovalManager: ApprovalManager,
    subAgentId: string,
    logger: IDextoLogger
): ApprovalHandler {
    // Track pending approvals for this sub-agent (for cancellation)
    const pendingApprovalIds = new Set<string>();

    const handler: ApprovalHandler = Object.assign(
        async (request: ApprovalRequest): Promise<ApprovalResponse> => {
            logger.debug(
                `Delegating approval '${request.approvalId}' (type: ${request.type}) from sub-agent '${subAgentId}'`
            );

            // Track this approval
            pendingApprovalIds.add(request.approvalId);

            try {
                // Build delegated request details with sub-agent context
                const delegatedDetails: ApprovalRequestDetails = {
                    type: request.type,
                    timeout: request.timeout,
                    sessionId: request.sessionId,
                    metadata: {
                        ...request.metadata,
                        delegatedFromAgent: subAgentId,
                    } as DelegatedMetadata,
                };

                // Forward to parent's approval manager
                const response = await parentApprovalManager.requestApproval(delegatedDetails);

                logger.debug(
                    `Approval '${request.approvalId}' delegated response: ${response.status}`
                );

                return response;
            } finally {
                // Remove from pending set
                pendingApprovalIds.delete(request.approvalId);
            }
        },
        {
            /**
             * Cancel a specific pending approval request
             */
            cancel: (approvalId: string): void => {
                if (pendingApprovalIds.has(approvalId)) {
                    logger.debug(
                        `Cancelling delegated approval '${approvalId}' for sub-agent '${subAgentId}'`
                    );
                    parentApprovalManager.cancelApproval(approvalId);
                    pendingApprovalIds.delete(approvalId);
                }
            },

            /**
             * Cancel all pending approval requests for this sub-agent
             */
            cancelAll: (): void => {
                if (pendingApprovalIds.size > 0) {
                    logger.debug(
                        `Cancelling all ${pendingApprovalIds.size} delegated approvals for sub-agent '${subAgentId}'`
                    );
                    for (const approvalId of pendingApprovalIds) {
                        parentApprovalManager.cancelApproval(approvalId);
                    }
                    pendingApprovalIds.clear();
                }
            },

            /**
             * Get list of pending approval IDs for this sub-agent
             */
            getPending: (): string[] => {
                return Array.from(pendingApprovalIds);
            },

            /**
             * Get pending approval requests (not available for delegated handlers)
             */
            getPendingRequests: (): ApprovalRequest[] => {
                // We don't have access to the full requests, just IDs
                return [];
            },
        }
    );

    return handler;
}
