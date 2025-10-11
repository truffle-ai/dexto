import { randomUUID } from 'crypto';
import type {
    ApprovalProvider,
    ApprovalRequest,
    ApprovalResponse,
    ApprovalRequestDetails,
} from '../types.js';
import type { AgentEventBus } from '../../events/index.js';
import { logger } from '../../logger/index.js';
import { ApprovalError } from '../errors.js';

/**
 * Event-based approval provider that uses the AgentEventBus to emit
 * approval requests and wait for responses from UI layers.
 *
 * This provider decouples the core approval logic from UI implementations,
 * allowing any client (CLI, WebUI, custom frontends) to handle approvals
 * by listening to events and responding accordingly.
 */
export class EventBasedApprovalProvider implements ApprovalProvider {
    private pendingApprovals = new Map<
        string,
        {
            resolve: (response: ApprovalResponse) => void;
            reject: (error: Error) => void;
            request: ApprovalRequest;
        }
    >();
    private defaultTimeout: number;
    private agentEventBus: AgentEventBus;

    constructor(
        agentEventBus: AgentEventBus,
        options: {
            defaultTimeout: number;
        }
    ) {
        this.agentEventBus = agentEventBus;
        this.defaultTimeout = options.defaultTimeout;

        // Listen for approval responses from application layers
        this.agentEventBus.on('dexto:approvalResponse', this.handleApprovalResponse.bind(this));
    }

    /**
     * Create and submit an approval request
     */
    async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
        const timeout = request.timeout ?? this.defaultTimeout;

        logger.info(
            `Approval request '${request.type}' created, approvalId: ${request.approvalId}, sessionId: ${request.sessionId ?? 'global'}`
        );

        return new Promise<ApprovalResponse>((resolve, reject) => {
            // Set timeout
            const timeoutId = setTimeout(() => {
                // Emit synthetic cancellation so UI knows it timed out
                const timeoutResponse: ApprovalResponse = {
                    approvalId: request.approvalId,
                    status: 'cancelled',
                    ...(request.sessionId && { sessionId: request.sessionId }),
                };

                logger.warn(
                    `Approval request timeout for '${request.type}', approvalId: ${request.approvalId}`
                );

                // Clean up before emitting to avoid re-processing
                this.pendingApprovals.delete(request.approvalId);

                // Notify application layers
                this.agentEventBus.emit('dexto:approvalResponse', timeoutResponse);

                reject(
                    ApprovalError.timeout(
                        request.approvalId,
                        request.type,
                        timeout,
                        request.sessionId
                    )
                );
            }, timeout);

            // Store the promise resolvers with cleanup
            this.pendingApprovals.set(request.approvalId, {
                resolve: (response: ApprovalResponse) => {
                    clearTimeout(timeoutId);
                    this.pendingApprovals.delete(request.approvalId);
                    resolve(response);
                },
                reject: (error: Error) => {
                    clearTimeout(timeoutId);
                    this.pendingApprovals.delete(request.approvalId);
                    reject(error);
                },
                request,
            });

            // Emit the approval request event
            const eventPayload: {
                approvalId: string;
                type: string;
                timestamp: Date;
                metadata: Record<string, any>;
                sessionId?: string;
                timeout?: number;
            } = {
                approvalId: request.approvalId,
                type: request.type,
                timestamp: request.timestamp,
                metadata: request.metadata as Record<string, any>,
            };

            if (request.sessionId !== undefined) {
                eventPayload.sessionId = request.sessionId;
            }
            if (request.timeout !== undefined) {
                eventPayload.timeout = request.timeout;
            }

            this.agentEventBus.emit('dexto:approvalRequest', eventPayload);
        });
    }

    /**
     * Handle approval response from external handlers
     */
    private async handleApprovalResponse(response: ApprovalResponse): Promise<void> {
        const pending = this.pendingApprovals.get(response.approvalId);
        if (!pending) {
            logger.warn(`Received approvalResponse for unknown approvalId ${response.approvalId}`);
            return;
        }

        // Remove from pending map immediately to prevent duplicate processing
        this.pendingApprovals.delete(response.approvalId);

        logger.info(
            `Approval '${pending.request.type}' ${response.status}, approvalId: ${response.approvalId}, sessionId: ${response.sessionId ?? 'global'}`
        );

        pending.resolve(response);
    }

    /**
     * Cancel a pending approval request
     */
    cancelApproval(approvalId: string): void {
        const pending = this.pendingApprovals.get(approvalId);
        if (pending) {
            pending.reject(
                ApprovalError.cancelled(
                    approvalId,
                    pending.request.type,
                    'individual request cancelled'
                )
            );
            this.pendingApprovals.delete(approvalId);
        }
    }

    /**
     * Cancel all pending approval requests
     */
    cancelAllApprovals(): void {
        for (const [_approvalId, pending] of this.pendingApprovals) {
            pending.reject(ApprovalError.cancelledAll('all requests cancelled'));
        }
        this.pendingApprovals.clear();
    }

    /**
     * Get list of pending approval request IDs
     */
    getPendingApprovals(): string[] {
        return Array.from(this.pendingApprovals.keys());
    }

    /**
     * Helper to create an approval request with generated ID
     */
    static createRequest(details: ApprovalRequestDetails): ApprovalRequest {
        return {
            approvalId: randomUUID(),
            type: details.type,
            sessionId: details.sessionId,
            timeout: details.timeout,
            timestamp: new Date(),
            metadata: details.metadata,
        } as ApprovalRequest;
    }
}
