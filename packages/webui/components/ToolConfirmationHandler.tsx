'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useChatContext } from './hooks/ChatContext';
import { InlineApprovalCard } from './InlineApprovalCard';

export interface ApprovalEvent {
    approvalId: string;
    type: string;
    toolName?: string; // For tool confirmation type
    args?: any; // For tool confirmation type
    description?: string; // For tool confirmation type
    timestamp: Date;
    sessionId?: string;
    metadata: Record<string, any>;
}

interface ToolConfirmationHandlerProps {
    websocket?: WebSocket | null;
    onApprovalRequest?: (approval: ApprovalEvent | null) => void;
    onApprove?: (formData?: Record<string, any>, rememberChoice?: boolean) => void;
    onDeny?: () => void;
    onHandlersReady?: (handlers: ApprovalHandlers) => void;
}

export interface ApprovalHandlers {
    onApprove: (formData?: Record<string, any>, rememberChoice?: boolean) => void;
    onDeny: () => void;
}

/**
 * WebUI component for handling approval requests
 * Manages approval state and sends responses back through WebSocket
 */
export function ToolConfirmationHandler({ websocket, onApprovalRequest, onApprove: externalOnApprove, onDeny: externalOnDeny, onHandlersReady }: ToolConfirmationHandlerProps) {
    const [pendingConfirmation, setPendingConfirmation] = useState<ApprovalEvent | null>(null);
    const { currentSessionId } = useChatContext();

    // Queue to hold requests that arrive while an approval is pending
    const queuedRequestsRef = React.useRef<ApprovalEvent[]>([]);

    // Store handlers in a ref so they can be accessed by the approval card
    const handlersRef = React.useRef<ApprovalHandlers | null>(null);

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
                    // Only handle requests for the active session
                    const sid = message?.data?.sessionId as string | undefined;
                    if (!sid || sid !== currentSessionId) return;

                    // Handle both tool confirmation and elicitation types
                    if (message.data.type !== 'tool_confirmation' && message.data.type !== 'elicitation') {
                        console.debug('[WebUI] Ignoring unsupported approval type:', message.data.type);
                        return;
                    }

                    let confirmationEvent: ApprovalEvent;

                    if (message.data.type === 'tool_confirmation') {
                        const toolMetadata = message.data.metadata as {
                            toolName: string;
                            args: Record<string, unknown>;
                            description?: string;
                        };

                        confirmationEvent = {
                            approvalId: message.data.approvalId,
                            type: message.data.type,
                            toolName: toolMetadata.toolName,
                            args: toolMetadata.args,
                            description: toolMetadata.description,
                            timestamp: new Date(message.data.timestamp),
                            sessionId: message.data.sessionId,
                            metadata: message.data.metadata,
                        };
                    } else {
                        // Elicitation request
                        confirmationEvent = {
                            approvalId: message.data.approvalId,
                            type: message.data.type,
                            timestamp: new Date(message.data.timestamp),
                            sessionId: message.data.sessionId,
                            metadata: message.data.metadata,
                        };
                    }

                    console.debug('[WebUI] Received approvalRequest', confirmationEvent);

                    if (pendingConfirmation) {
                        // Buffer the request to be shown later
                        queuedRequestsRef.current.push(confirmationEvent);
                    } else {
                        setPendingConfirmation(confirmationEvent);
                    }
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        websocket.addEventListener('message', handleMessage);

        return () => {
            websocket.removeEventListener('message', handleMessage);
        };
    }, [websocket, pendingConfirmation, currentSessionId]);

    // Send confirmation response
    const sendResponse = useCallback((approved: boolean, formData?: Record<string, any>, rememberChoice?: boolean) => {
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

    const handleApprove = useCallback((formData?: Record<string, any>, rememberChoice?: boolean) => {
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
