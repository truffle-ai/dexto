'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useChatContext } from './hooks/ChatContext';
import type { ApprovalEvent } from '../types/approval.js';

interface ToolConfirmationHandlerProps {
    websocket?: WebSocket | null;
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
 * Manages approval state and sends responses back through WebSocket
 */
export function ToolConfirmationHandler({ websocket, onApprovalRequest, onApprove: externalOnApprove, onDeny: externalOnDeny, onHandlersReady }: ToolConfirmationHandlerProps) {
    const [pendingConfirmation, setPendingConfirmation] = useState<ApprovalEvent | null>(null);
    const { currentSessionId } = useChatContext();

    // Queue to hold requests that arrive while an approval is pending
    const queuedRequestsRef = React.useRef<ApprovalEvent[]>([]);

    // Notify parent component when approval state changes
    useEffect(() => {
        onApprovalRequest?.(pendingConfirmation);
    }, [pendingConfirmation, onApprovalRequest]);

    // Handle incoming WebSocket messages
    useEffect(() => {
        if (!websocket) return;

        const handleMessage = (event: MessageEvent) => {
            try {
                const message = JSON.parse(event.data);

                if (message.event === 'approvalRequest') {
                    // Validate message.data exists and is an object
                    if (!message?.data || typeof message.data !== 'object') {
                        console.error('[WebUI] Invalid approvalRequest: message.data is missing or not an object');
                        return;
                    }

                    // Skip only if sessionId is present and doesn't match current session
                    // Allow messages with no sessionId (global/legacy approvals)
                    const sid = message.data.sessionId as string | undefined;
                    if (sid && sid !== currentSessionId) return;

                    // Handle both tool confirmation and elicitation types
                    const messageType = message.data.type;
                    if (messageType !== 'tool_confirmation' && messageType !== 'elicitation') {
                        console.debug('[WebUI] Ignoring unsupported approval type:', messageType);
                        return;
                    }

                    let approvalEvent: ApprovalEvent;

                    if (messageType === 'tool_confirmation') {
                        // Validate metadata exists and has required properties
                        const metadata = message.data.metadata;
                        if (!metadata || typeof metadata !== 'object') {
                            console.error('[WebUI] Invalid tool_confirmation: metadata is missing or not an object');
                            return;
                        }

                        const toolName = metadata.toolName;
                        const args = metadata.args;

                        if (typeof toolName !== 'string') {
                            console.error('[WebUI] Invalid tool_confirmation: metadata.toolName must be a string');
                            return;
                        }

                        if (!args || typeof args !== 'object') {
                            console.error('[WebUI] Invalid tool_confirmation: metadata.args must be an object');
                            return;
                        }

                        approvalEvent = {
                            approvalId: message.data.approvalId,
                            type: messageType,
                            toolName: toolName,
                            args: args,
                            description: typeof metadata.description === 'string' ? metadata.description : undefined,
                            timestamp: message.data.timestamp,
                            sessionId: message.data.sessionId,
                            metadata: metadata,
                        };
                    } else {
                        // Elicitation request
                        approvalEvent = {
                            approvalId: message.data.approvalId,
                            type: messageType,
                            timestamp: message.data.timestamp,
                            sessionId: message.data.sessionId,
                            metadata: message.data.metadata || {},
                        };
                    }

                    console.debug('[WebUI] Received approvalRequest', approvalEvent);

                    if (pendingConfirmation) {
                        // Buffer the request to be shown later
                        queuedRequestsRef.current.push(approvalEvent);
                    } else {
                        setPendingConfirmation(approvalEvent);
                    }
                }
            } catch (error) {
                console.error(`[WebUI] Error handling approvalRequest message: ${error instanceof Error ? error.message : String(error)}`);
            }
        };

        websocket.addEventListener('message', handleMessage);

        return () => {
            websocket.removeEventListener('message', handleMessage);
        };
    }, [websocket, pendingConfirmation, currentSessionId]);

    // Send confirmation response
    const sendResponse = useCallback((approved: boolean, formData?: Record<string, unknown>, rememberChoice?: boolean) => {
        if (!pendingConfirmation || !websocket) return;

        const isElicitation = pendingConfirmation.type === 'elicitation';

        // For elicitation: only include data when approved AND formData exists
        // For tool confirmation: always include rememberChoice
        const responseData = isElicitation
            ? approved && formData
                ? { formData }
                : undefined
            : { rememberChoice: rememberChoice ?? false };

        const response = {
            type: 'approvalResponse',
            data: {
                approvalId: pendingConfirmation.approvalId,
                status: approved ? 'approved' : 'denied',
                sessionId: pendingConfirmation.sessionId,
                ...(responseData ? { data: responseData } : {}),
            },
        };

        console.debug('[WebUI] Sending approvalResponse', response);
        websocket.send(JSON.stringify(response));

        // Clear current approval
        setPendingConfirmation(null);

        // If there are queued requests, show the next one
        if (queuedRequestsRef.current.length > 0) {
            const next = queuedRequestsRef.current.shift()!;
            setTimeout(() => {
                setPendingConfirmation(next);
            }, 100);
        }
    }, [pendingConfirmation, websocket]);

    const handleApprove = useCallback((formData?: Record<string, unknown>, rememberChoice?: boolean) => {
        sendResponse(true, formData, rememberChoice);
        externalOnApprove?.(formData, rememberChoice);
    }, [sendResponse, externalOnApprove]);

    const handleDeny = useCallback(() => {
        sendResponse(false);
        externalOnDeny?.();
    }, [sendResponse, externalOnDeny]);

    // Expose handlers to parent via callback
    useEffect(() => {
        if (onHandlersReady) {
            onHandlersReady({
                onApprove: handleApprove,
                onDeny: handleDeny
            });
        }
    }, [handleApprove, handleDeny, onHandlersReady]);

    // Don't render anything - the approval will be rendered in MessageList
    return null;
}
