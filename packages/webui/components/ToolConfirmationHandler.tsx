'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useChatContext } from './hooks/ChatContext';
import { apiFetch } from '@/lib/api-client';
import type { ApprovalEvent } from '../types/approval.js';

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

// Re-export for backward compatibility
export type { ApprovalEvent } from '../types/approval.js';

/**
 * WebUI component for handling approval requests
 * Manages approval state and sends responses back through API
 */
export function ToolConfirmationHandler({
    onApprovalRequest,
    onApprove: externalOnApprove,
    onDeny: externalOnDeny,
    onHandlersReady,
}: ToolConfirmationHandlerProps) {
    const [pendingConfirmation, setPendingConfirmation] = useState<ApprovalEvent | null>(null);
    const { currentSessionId } = useChatContext();

    // Queue to hold requests that arrive while an approval is pending
    const queuedRequestsRef = React.useRef<ApprovalEvent[]>([]);

    // Notify parent component when approval state changes
    useEffect(() => {
        onApprovalRequest?.(pendingConfirmation);
    }, [pendingConfirmation, onApprovalRequest]);

    // Handle incoming approval requests via DOM event (dispatched by useChat)
    useEffect(() => {
        const handleApprovalRequest = (event: any) => {
            try {
                // Event detail structure: { approvalId, type, metadata, timestamp, sessionId }
                // This matches what useChat dispatches for 'approval-request' SSE event
                const data = event.detail;

                if (!data) {
                    console.error('[WebUI] Invalid approval request event: missing detail');
                    return;
                }

                // Skip if sessionId doesn't match (if provided)
                if (data.sessionId && currentSessionId && data.sessionId !== currentSessionId) {
                    return;
                }

                // Construct standard ApprovalEvent
                // Note: The server might send different shapes depending on type.
                // We normalize here.

                let approvalEvent: ApprovalEvent;
                const { approvalId, type, timestamp, metadata = {}, sessionId } = data;

                if (type === 'tool_confirmation') {
                    // Metadata should contain toolName, args
                    approvalEvent = {
                        approvalId,
                        type,
                        toolName: metadata.toolName || 'unknown',
                        args: metadata.args || {},
                        description: metadata.description,
                        timestamp: timestamp || new Date().toISOString(),
                        sessionId,
                        metadata,
                    };
                } else if (type === 'command_confirmation') {
                    approvalEvent = {
                        approvalId,
                        type,
                        toolName: metadata.toolName || 'unknown',
                        command: metadata.command || '',
                        originalCommand: metadata.originalCommand,
                        timestamp: timestamp || new Date().toISOString(),
                        sessionId,
                        metadata,
                    };
                } else {
                    // Generic/Elicitation
                    approvalEvent = {
                        approvalId,
                        type: type || 'elicitation',
                        timestamp: timestamp || new Date().toISOString(),
                        sessionId,
                        metadata,
                    };
                }

                console.debug(
                    `[WebUI] Received approvalRequest via Event: ${JSON.stringify(approvalEvent)}`
                );

                if (pendingConfirmation) {
                    queuedRequestsRef.current.push(approvalEvent);
                } else {
                    setPendingConfirmation(approvalEvent);
                }
            } catch (error) {
                console.error('[WebUI] Error handling approval request event:', error);
            }
        };

        window.addEventListener('approval:request', handleApprovalRequest);
        return () => {
            window.removeEventListener('approval:request', handleApprovalRequest);
        };
    }, [pendingConfirmation, currentSessionId]);

    // Handle approval responses (timeout, cancellation) via DOM event
    useEffect(() => {
        const handleApprovalResponse = (event: any) => {
            try {
                const data = event.detail;

                if (!data || !data.approvalId) {
                    console.error('[WebUI] Invalid approval response event: missing detail');
                    return;
                }

                // Skip if sessionId doesn't match (if provided)
                if (data.sessionId && currentSessionId && data.sessionId !== currentSessionId) {
                    return;
                }

                console.debug(
                    `[WebUI] Received approvalResponse: ${data.approvalId}, status: ${data.status}, reason: ${data.reason}`
                );

                // If this response is for the current pending approval, clear it
                if (pendingConfirmation && pendingConfirmation.approvalId === data.approvalId) {
                    // Check if it's a timeout or cancellation (status: 'cancelled')
                    if (data.status === 'cancelled') {
                        console.info(
                            `[WebUI] Approval ${data.approvalId} timed out or was cancelled (${data.reason})`
                        );
                        setPendingConfirmation(null);

                        // Process next queued request if any
                        if (queuedRequestsRef.current.length > 0) {
                            const next = queuedRequestsRef.current.shift()!;
                            setTimeout(() => {
                                setPendingConfirmation(next);
                            }, 100);
                        }
                    }
                }
            } catch (error) {
                console.error('[WebUI] Error handling approval response event:', error);
            }
        };

        window.addEventListener('approval:response', handleApprovalResponse);
        return () => {
            window.removeEventListener('approval:response', handleApprovalResponse);
        };
    }, [pendingConfirmation, currentSessionId]);

    // Send confirmation response via API
    const sendResponse = useCallback(
        async (approved: boolean, formData?: Record<string, unknown>, rememberChoice?: boolean) => {
            if (!pendingConfirmation) return;

            const { approvalId } = pendingConfirmation;

            console.debug(
                `[WebUI] Sending approval response for ${approvalId}: ${approved ? 'approved' : 'denied'}`
            );

            try {
                await apiFetch(`/api/approvals/${approvalId}`, {
                    method: 'POST',
                    body: JSON.stringify({
                        status: approved ? 'approved' : 'denied',
                        ...(approved && formData ? { formData } : {}),
                        ...(approved && rememberChoice !== undefined ? { rememberChoice } : {}),
                    }),
                });
            } catch (error) {
                console.error(
                    `[WebUI] Failed to send approval response: ${error instanceof Error ? error.message : String(error)}`
                );
                // TODO: Show toast?
                return;
            }

            // Clear current approval
            setPendingConfirmation(null);

            // If there are queued requests, show the next one
            if (queuedRequestsRef.current.length > 0) {
                const next = queuedRequestsRef.current.shift()!;
                setTimeout(() => {
                    setPendingConfirmation(next);
                }, 100);
            }
        },
        [pendingConfirmation]
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
