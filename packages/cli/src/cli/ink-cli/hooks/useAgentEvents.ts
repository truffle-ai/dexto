/**
 * Hook for managing agent event bus subscriptions
 * Transforms agent events into state actions
 */

import type React from 'react';
import { useEffect, useRef } from 'react';
import type { DextoAgent, AgentEventBus } from '@dexto/core';
import { ApprovalType as ApprovalTypeEnum } from '@dexto/core';
import type { CLIAction } from '../state/actions.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import { generateMessageId } from '../utils/idGenerator.js';

interface UseAgentEventsProps {
    agent: DextoAgent;
    dispatch: React.Dispatch<CLIAction>;
    isCancelling: boolean;
}

/**
 * Subscribes to agent event bus and dispatches state actions
 * Decouples event bus from UI components
 */
export function useAgentEvents({ agent, dispatch, isCancelling }: UseAgentEventsProps): void {
    // Use ref for isCancelling to avoid re-registering event handlers on every state change
    // This prevents race conditions where events could be lost during handler re-registration
    const isCancellingRef = useRef(isCancelling);
    useEffect(() => {
        isCancellingRef.current = isCancelling;
    }, [isCancelling]);

    useEffect(() => {
        const bus: AgentEventBus = agent.agentEventBus;

        // Handle thinking event (when LLM starts processing)
        // TODO: This event should be renamed to handle actual reasoning tokens (extended thinking)
        // Currently it just indicates LLM request start, not reasoning token generation
        // See: https://www.anthropic.com/news/3-5-models-and-computer-use (extended thinking)
        const handleThinking = () => {
            if (isCancellingRef.current) return;
            dispatch({ type: 'THINKING_START' });
        };

        // Handle streaming chunks
        const handleChunk = (payload: {
            chunkType: 'text' | 'reasoning';
            content: string;
            isComplete?: boolean;
            sessionId: string;
        }) => {
            if (isCancellingRef.current) return; // Ignore events during cancellation
            // End thinking state when first chunk arrives
            dispatch({ type: 'THINKING_END' });
            if (payload.chunkType === 'text') {
                dispatch({
                    type: 'STREAMING_CHUNK',
                    content: payload.content,
                });
            }
        };

        // Handle response completion
        const handleResponse = (payload: { content: string }) => {
            if (isCancellingRef.current) return; // Ignore events during cancellation
            dispatch({
                type: 'STREAMING_END',
                content: payload.content,
            });
            dispatch({
                type: 'PROCESSING_END',
            });
        };

        // Handle errors
        const handleError = (payload: { error: Error }) => {
            dispatch({
                type: 'STREAMING_CANCEL',
            });
            dispatch({
                type: 'SUBMIT_ERROR',
                errorMessage: payload.error.message,
            });
        };

        // Handle tool calls
        const handleToolCall = (payload: { toolName: string; args: any; callId?: string }) => {
            if (isCancellingRef.current) return; // Ignore events during cancellation

            // Format args for display (compact, one-line)
            let argsPreview = '';
            try {
                const argsStr = JSON.stringify(payload.args);
                // Remove outer braces and limit length
                const cleanArgs = argsStr.replace(/^\{|\}$/g, '').trim();
                if (cleanArgs.length > 80) {
                    argsPreview = ` • ${cleanArgs.slice(0, 80)}...`;
                } else if (cleanArgs.length > 0) {
                    argsPreview = ` • ${cleanArgs}`;
                }
            } catch {
                argsPreview = '';
            }

            // Insert before streaming message so tools appear in correct order
            // Use callId if available for matching with result later
            const toolMessageId = payload.callId
                ? `tool-${payload.callId}`
                : generateMessageId('tool');

            dispatch({
                type: 'MESSAGE_INSERT_BEFORE_STREAMING',
                message: {
                    id: toolMessageId,
                    role: 'tool',
                    content: `${payload.toolName}${argsPreview}`,
                    timestamp: new Date(),
                    toolStatus: 'running',
                },
            });
        };

        // Handle tool results
        const handleToolResult = (payload: {
            toolName: string;
            callId?: string;
            sanitized?: any;
            rawResult?: any;
            success: boolean;
        }) => {
            if (isCancellingRef.current) return; // Ignore events during cancellation

            // Format result preview (4-5 CLI lines, ~400 chars accounting for wrapping)
            let resultPreview = '';
            try {
                const result = payload.sanitized || payload.rawResult;
                if (result) {
                    const resultStr =
                        typeof result === 'string' ? result : JSON.stringify(result, null, 2);

                    // Limit to ~400 chars (roughly 4-5 terminal lines at 80-100 chars width)
                    const maxChars = 400;
                    if (resultStr.length > maxChars) {
                        resultPreview = resultStr.slice(0, maxChars) + '\n...';
                    } else {
                        resultPreview = resultStr;
                    }
                }
            } catch {
                resultPreview = '';
            }

            // Update the tool message with result preview and mark as finished
            if (payload.callId) {
                const toolMessageId = `tool-${payload.callId}`;
                dispatch({
                    type: 'MESSAGE_UPDATE',
                    id: toolMessageId,
                    update: {
                        toolResult: resultPreview,
                        toolStatus: 'finished',
                    },
                });
            }
        };

        // Handle approval requests
        const handleApprovalRequest = (event: {
            approvalId: string;
            type: string;
            sessionId?: string | undefined;
            timeout?: number | undefined;
            timestamp: Date;
            metadata: Record<string, any>;
        }) => {
            // Handle both tool confirmation and command confirmation approvals in ink-cli
            if (
                event.type === ApprovalTypeEnum.TOOL_CONFIRMATION ||
                event.type === ApprovalTypeEnum.COMMAND_CONFIRMATION
            ) {
                const approval: ApprovalRequest = {
                    approvalId: event.approvalId,
                    type: event.type,
                    timestamp: event.timestamp,
                    metadata: event.metadata,
                };

                // Only include optional properties if they're defined
                if (event.sessionId !== undefined) {
                    approval.sessionId = event.sessionId;
                }
                if (event.timeout !== undefined) {
                    approval.timeout = event.timeout;
                }

                dispatch({
                    type: 'APPROVAL_REQUEST',
                    approval,
                });
            }
        };

        // Subscribe to events
        bus.on('llm:thinking', handleThinking);
        bus.on('llm:chunk', handleChunk);
        bus.on('llm:response', handleResponse);
        bus.on('llm:error', handleError);
        bus.on('llm:tool-call', handleToolCall);
        bus.on('llm:tool-result', handleToolResult);
        bus.on('approval:request', handleApprovalRequest);

        // Handle model switch
        const handleModelSwitch = (payload: any) => {
            if (payload.newConfig?.model) {
                dispatch({
                    type: 'MODEL_UPDATE',
                    modelName: payload.newConfig.model,
                });
            }
        };

        // Handle conversation reset
        const handleConversationReset = () => {
            dispatch({ type: 'CONVERSATION_RESET' });
        };

        // Handle session creation (e.g., from /clear command)
        // This maintains separation of concerns: commands emit events, UI handles state
        const handleSessionCreated = (payload: { sessionId: string | null; switchTo: boolean }) => {
            if (payload.switchTo) {
                if (payload.sessionId === null) {
                    // Clear without creating a new session (deferred creation)
                    dispatch({ type: 'SESSION_CLEAR' });
                } else {
                    // Clear current messages and switch to new session
                    dispatch({ type: 'SESSION_CLEAR' });
                    dispatch({
                        type: 'SESSION_SET',
                        sessionId: payload.sessionId,
                        hasActiveSession: true,
                    });
                }
            }
        };
        // Subscribe to events
        bus.on('llm:switched', handleModelSwitch);
        bus.on('session:reset', handleConversationReset);
        bus.on('session:created', handleSessionCreated);

        // Cleanup on unmount
        return () => {
            bus.off('llm:thinking', handleThinking);
            bus.off('llm:chunk', handleChunk);
            bus.off('llm:response', handleResponse);
            bus.off('llm:error', handleError);
            bus.off('llm:tool-call', handleToolCall);
            bus.off('llm:tool-result', handleToolResult);
            bus.off('approval:request', handleApprovalRequest);
            bus.off('llm:switched', handleModelSwitch);
            bus.off('session:reset', handleConversationReset);
            bus.off('session:created', handleSessionCreated);
        };
    }, [agent, dispatch]); // Note: isCancelling is accessed via ref to avoid re-registering handlers
}
