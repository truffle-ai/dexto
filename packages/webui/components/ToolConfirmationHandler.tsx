import { useEffect, useCallback } from 'react';
import { useSubmitApproval } from './hooks/useApprovals';
import type { ApprovalRequest } from '@dexto/core';
import { ApprovalStatus } from '@dexto/core';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { useApprovalStore } from '@/lib/stores/approvalStore';

// Re-export ApprovalRequest as ApprovalEvent for consumers (e.g., InlineApprovalCard, MessageList)
export type ApprovalEvent = ApprovalRequest;

interface ToolConfirmationHandlerProps {
    onApprovalRequest?: (approval: ApprovalEvent | null) => void;
    onApprove?: (formData?: Record<string, unknown>, rememberChoice?: boolean) => void;
    onDeny?: () => void;
    onHandlersReady?: (handlers: ApprovalHandlers) => void;
}

export interface ApprovalHandlers {
    onApprove: (formData?: Record<string, unknown>, rememberChoice?: boolean) => void;
    onDeny: () => void;
}

/**
 * WebUI component for handling approval requests
 * Uses approvalStore for state management (no DOM events)
 * Sends responses back through API via useSubmitApproval
 */
export function ToolConfirmationHandler({
    onApprovalRequest,
    onApprove: externalOnApprove,
    onDeny: externalOnDeny,
    onHandlersReady,
}: ToolConfirmationHandlerProps) {
    const currentSessionId = useSessionStore((s) => s.currentSessionId);
    const pendingApproval = useApprovalStore((s) => s.pendingApproval);
    const clearApproval = useApprovalStore((s) => s.clearApproval);
    const { mutateAsync: submitApproval } = useSubmitApproval();

    // Filter approvals by current session
    const currentApproval =
        pendingApproval &&
        (!pendingApproval.sessionId ||
            !currentSessionId ||
            pendingApproval.sessionId === currentSessionId)
            ? pendingApproval
            : null;

    // Notify parent component when approval state changes
    useEffect(() => {
        onApprovalRequest?.(currentApproval);
    }, [currentApproval, onApprovalRequest]);

    // Send confirmation response via API
    const sendResponse = useCallback(
        async (approved: boolean, formData?: Record<string, unknown>, rememberChoice?: boolean) => {
            if (!currentApproval) return;

            const { approvalId } = currentApproval;

            console.debug(
                `[WebUI] Sending approval response for ${approvalId}: ${approved ? 'approved' : 'denied'}`
            );

            // Use approval's sessionId as authoritative source for cache invalidation
            const sessionId = currentApproval.sessionId || currentSessionId;
            if (!sessionId) {
                console.error('[WebUI] Cannot submit approval without sessionId');
                return;
            }

            try {
                await submitApproval({
                    approvalId,
                    sessionId,
                    status: approved ? ApprovalStatus.APPROVED : ApprovalStatus.DENIED,
                    ...(approved && formData ? { formData } : {}),
                    ...(approved && rememberChoice !== undefined ? { rememberChoice } : {}),
                });
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[WebUI] Failed to send approval response: ${message}`);
                return;
            }

            // Clear current approval (processes queue automatically)
            clearApproval();
        },
        [currentApproval, currentSessionId, submitApproval, clearApproval]
    );

    const handleApprove = useCallback(
        (formData?: Record<string, unknown>, rememberChoice?: boolean) => {
            sendResponse(true, formData, rememberChoice);
            externalOnApprove?.(formData, rememberChoice);
        },
        [sendResponse, externalOnApprove]
    );

    const handleDeny = useCallback(() => {
        sendResponse(false);
        externalOnDeny?.();
    }, [sendResponse, externalOnDeny]);

    // Expose handlers to parent via callback
    useEffect(() => {
        if (onHandlersReady) {
            onHandlersReady({
                onApprove: handleApprove,
                onDeny: handleDeny,
            });
        }
    }, [handleApprove, handleDeny, onHandlersReady]);

    // Don't render anything - the approval will be rendered in MessageList
    return null;
}
