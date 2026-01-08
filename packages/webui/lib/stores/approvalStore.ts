/**
 * Approval Store
 *
 * Manages approval requests from the agent using Zustand.
 * Handles queueing when multiple approvals arrive simultaneously.
 *
 * Flow:
 * 1. approval:request event → addApproval() → sets pendingApproval or queues
 * 2. User responds via UI → sends response to agent
 * 3. approval:response event → processResponse() → clears and processes next
 */

import { create } from 'zustand';
import { ApprovalStatus } from '@dexto/core';
import type { ApprovalRequest, ApprovalResponse } from '@dexto/core';

export interface PendingApproval {
    request: ApprovalRequest;
    timestamp: number;
}

interface ApprovalStore {
    // Current pending approval being displayed
    pendingApproval: ApprovalRequest | null;

    // Queue of pending approvals waiting to be displayed
    queue: ApprovalRequest[];

    // Actions
    addApproval: (request: ApprovalRequest) => void;
    processResponse: (response: ApprovalResponse) => void;
    clearApproval: () => void;
    clearAll: () => void;

    // Selectors
    getPendingCount: () => number;
    getPendingForSession: (sessionId: string) => ApprovalRequest[];
    hasPendingApproval: () => boolean;
}

/**
 * Check if approval response status is terminal (ends the approval)
 */
function isTerminalStatus(status: ApprovalStatus): boolean {
    return (
        status === ApprovalStatus.APPROVED ||
        status === ApprovalStatus.DENIED ||
        status === ApprovalStatus.CANCELLED
    );
}

export const useApprovalStore = create<ApprovalStore>((set, get) => ({
    pendingApproval: null,
    queue: [],

    /**
     * Add a new approval request
     * If there's already a pending approval, queue it
     */
    addApproval: (request: ApprovalRequest) => {
        set((state) => {
            // If there's already a pending approval, add to queue
            if (state.pendingApproval) {
                return {
                    queue: [...state.queue, request],
                };
            }

            // Otherwise, set as pending
            return {
                pendingApproval: request,
            };
        });
    },

    /**
     * Process an approval response
     * If status is terminal (approved/denied/cancelled), clear pending and process next
     */
    processResponse: (response: ApprovalResponse) => {
        set((state) => {
            // Only process if this response matches the current pending approval
            if (state.pendingApproval?.approvalId !== response.approvalId) {
                return state;
            }

            // If terminal status, clear pending and process next
            if (isTerminalStatus(response.status)) {
                // Get next from queue
                const [next, ...rest] = state.queue;

                return {
                    pendingApproval: next ?? null,
                    queue: rest,
                };
            }

            // Non-terminal status (e.g., future streaming updates), keep pending
            return state;
        });
    },

    /**
     * Clear current approval and process next in queue
     * Used for manual dismissal or timeout
     */
    clearApproval: () => {
        set((state) => {
            const [next, ...rest] = state.queue;
            return {
                pendingApproval: next ?? null,
                queue: rest,
            };
        });
    },

    /**
     * Clear all pending approvals
     * Used when switching sessions or resetting state
     */
    clearAll: () => {
        set({
            pendingApproval: null,
            queue: [],
        });
    },

    /**
     * Get total count of pending approvals (current + queued)
     */
    getPendingCount: () => {
        const state = get();
        return (state.pendingApproval ? 1 : 0) + state.queue.length;
    },

    /**
     * Get all pending approvals for a specific session
     */
    getPendingForSession: (sessionId: string) => {
        const state = get();
        const results: ApprovalRequest[] = [];

        if (state.pendingApproval?.sessionId === sessionId) {
            results.push(state.pendingApproval);
        }

        results.push(...state.queue.filter((req) => req.sessionId === sessionId));

        return results;
    },

    /**
     * Check if there's a pending approval
     */
    hasPendingApproval: () => {
        return get().pendingApproval !== null;
    },
}));
