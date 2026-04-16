import { EventEmitter } from 'node:events';
import type { ApprovalRequest, ApprovalResponse } from '@dexto/core';

/**
 * Event coordinator for approval request/response flow between handler and server.
 *
 * Provides explicit separation between agent lifecycle events (on AgentEventBus)
 * and server-mode coordination events (on ApprovalCoordinator).
 *
 * Used by:
 * - ManualApprovalHandler: Emits requests, listens for responses
 * - Streaming endpoints: Listens for requests, helps emit responses
 * - Approval routes: Emits responses from client submissions
 */
export class ApprovalCoordinator extends EventEmitter {
    // Track approvalId -> request context mapping for multi-client routing and correlation.
    private approvalContexts = new Map<
        string,
        Pick<ApprovalRequest, 'sessionId' | 'hostRuntime'>
    >();

    /**
     * Emit an approval request.
     * Called by ManualApprovalHandler when tool/command needs approval.
     */
    public emitRequest(request: ApprovalRequest): void {
        // Store sessionId mapping for later lookup when client submits response
        this.approvalContexts.set(request.approvalId, {
            sessionId: request.sessionId,
            hostRuntime: request.hostRuntime,
        });
        this.emit('approval:request', request);
    }

    /**
     * Emit an approval response.
     * Called by API routes when user submits decision.
     */
    public emitResponse(response: ApprovalResponse): void {
        this.emit('approval:response', response);
        // Clean up the mapping after response is emitted
        this.approvalContexts.delete(response.approvalId);
    }

    /**
     * Get the sessionId associated with an approval request.
     * Used by API routes to attach sessionId to responses for SSE routing.
     */
    public getSessionId(approvalId: string): string | undefined {
        return this.approvalContexts.get(approvalId)?.sessionId;
    }

    public getHostRuntime(approvalId: string): ApprovalRequest['hostRuntime'] | undefined {
        return this.approvalContexts.get(approvalId)?.hostRuntime;
    }

    /**
     * Subscribe to approval requests.
     * Used by streaming endpoints to forward requests to SSE clients.
     *
     * @param handler Callback to handle approval requests
     * @param options Optional AbortSignal for cleanup
     */
    public onRequest(
        handler: (request: ApprovalRequest) => void,
        options?: { signal?: AbortSignal }
    ): void {
        const listener = (request: ApprovalRequest) => handler(request);
        this.on('approval:request', listener);

        // Cleanup on abort signal
        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.off('approval:request', listener);
            });
        }
    }

    /**
     * Subscribe to approval responses.
     * Used by ManualApprovalHandler to resolve pending approval promises.
     *
     * @param handler Callback to handle approval responses
     * @param options Optional AbortSignal for cleanup
     */
    public onResponse(
        handler: (response: ApprovalResponse) => void,
        options?: { signal?: AbortSignal }
    ): void {
        const listener = (response: ApprovalResponse) => handler(response);
        this.on('approval:response', listener);

        // Cleanup on abort signal
        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.off('approval:response', listener);
            });
        }
    }
}
