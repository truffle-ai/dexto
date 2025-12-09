/**
 * Hook for managing agent event bus subscriptions
 * Handles events directly, updating state via setters
 */

import type React from 'react';
import { useEffect, useRef } from 'react';
import type { DextoAgent, AgentEventBus, AgentEventMap } from '@dexto/core';
import { ApprovalType as ApprovalTypeEnum } from '@dexto/core';
import type { Message, OverlayType, McpWizardServerType } from '../state/types.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import { generateMessageId } from '../utils/idGenerator.js';

/**
 * UI state shape (must match InkCLIRefactored)
 */
interface UIState {
    isProcessing: boolean;
    isCancelling: boolean;
    isThinking: boolean;
    activeOverlay: OverlayType;
    exitWarningShown: boolean;
    exitWarningTimestamp: number | null;
    mcpWizardServerType: McpWizardServerType;
    copyModeEnabled: boolean;
}

/**
 * Session state shape
 */
interface SessionState {
    id: string | null;
    hasActiveSession: boolean;
    modelName: string;
}

interface UseAgentEventsProps {
    agent: DextoAgent;
    isCancelling: boolean;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    setSession: React.Dispatch<React.SetStateAction<SessionState>>;
    setApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
    setApprovalQueue: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
}

// Streaming state tracked in ref to avoid recreating handlers
interface StreamingState {
    id: string | null;
    content: string;
}

/**
 * Subscribes to agent event bus and handles events directly
 */
export function useAgentEvents({
    agent,
    isCancelling,
    setMessages,
    setUi,
    setSession,
    setApproval,
    setApprovalQueue,
}: UseAgentEventsProps): void {
    // Use ref for isCancelling to avoid re-registering event handlers
    const isCancellingRef = useRef(isCancelling);
    useEffect(() => {
        isCancellingRef.current = isCancelling;
    }, [isCancelling]);

    // Track streaming state in ref to avoid closure issues
    const streamingRef = useRef<StreamingState>({ id: null, content: '' });

    useEffect(() => {
        const bus: AgentEventBus = agent.agentEventBus;

        // Handle thinking event (when LLM starts processing)
        const handleThinking = () => {
            if (isCancellingRef.current) return;
            setUi((prev) => ({ ...prev, isThinking: true }));

            // Start streaming: create new streaming message
            const streamId = generateMessageId('assistant');
            streamingRef.current = { id: streamId, content: '' };

            setMessages((prev) => [
                ...prev,
                {
                    id: streamId,
                    role: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    isStreaming: true,
                },
            ]);
        };

        // Handle streaming chunks
        const handleChunk = (payload: {
            chunkType: 'text' | 'reasoning';
            content: string;
            isComplete?: boolean;
            sessionId: string;
        }) => {
            if (isCancellingRef.current) return;

            // End thinking state when first chunk arrives
            setUi((prev) => ({ ...prev, isThinking: false }));

            if (payload.chunkType === 'text') {
                const streaming = streamingRef.current;
                if (!streaming.id) return;

                // Accumulate content
                streaming.content += payload.content;
                const newContent = streaming.content;
                const streamId = streaming.id;

                // Update the streaming message
                setMessages((prev) =>
                    prev.map((msg) => (msg.id === streamId ? { ...msg, content: newContent } : msg))
                );
            }
        };

        // Handle response completion (may fire multiple times during tool use)
        const handleResponse = (payload: { content: string }) => {
            if (isCancellingRef.current) return;

            const streaming = streamingRef.current;
            if (!streaming.id) return;

            // Finalize the streaming message
            const streamId = streaming.id;
            const finalContent =
                payload.content && payload.content.length > 0 ? payload.content : streaming.content;

            setMessages((prev) =>
                prev.map((msg) =>
                    msg.id === streamId
                        ? { ...msg, content: finalContent, isStreaming: false }
                        : msg
                )
            );

            // Clear streaming state
            streamingRef.current = { id: null, content: '' };
        };

        // Handle run completion (fires once when entire run finishes)
        const handleRunComplete = () => {
            if (isCancellingRef.current) return;
            setUi((prev) => ({
                ...prev,
                isProcessing: false,
                isCancelling: false,
                isThinking: false,
            }));
        };

        // Handle errors
        const handleError = (payload: { error: Error }) => {
            // Cancel any streaming message
            const streaming = streamingRef.current;
            if (streaming.id) {
                const streamId = streaming.id;
                setMessages((prev) => prev.filter((msg) => msg.id !== streamId));
                streamingRef.current = { id: null, content: '' };
            }

            // Add error message
            setMessages((prev) => [
                ...prev,
                {
                    id: generateMessageId('error'),
                    role: 'system',
                    content: `❌ Error: ${payload.error.message}`,
                    timestamp: new Date(),
                },
            ]);

            setUi((prev) => ({
                ...prev,
                isProcessing: false,
                isCancelling: false,
                isThinking: false,
            }));
        };

        // Handle tool calls
        const handleToolCall = (payload: { toolName: string; args: any; callId?: string }) => {
            if (isCancellingRef.current) return;

            // Format args for display (compact, one-line)
            let argsPreview = '';
            try {
                const argsStr = JSON.stringify(payload.args);
                const cleanArgs = argsStr.replace(/^\{|\}$/g, '').trim();
                if (cleanArgs.length > 80) {
                    argsPreview = ` • ${cleanArgs.slice(0, 80)}...`;
                } else if (cleanArgs.length > 0) {
                    argsPreview = ` • ${cleanArgs}`;
                }
            } catch {
                argsPreview = '';
            }

            const toolMessageId = payload.callId
                ? `tool-${payload.callId}`
                : generateMessageId('tool');

            // Append tool message after current messages
            setMessages((prev) => [
                ...prev,
                {
                    id: toolMessageId,
                    role: 'tool',
                    content: `${payload.toolName}${argsPreview}`,
                    timestamp: new Date(),
                    toolStatus: 'running',
                },
            ]);
        };

        // Handle tool results
        const handleToolResult = (payload: {
            toolName: string;
            callId?: string;
            sanitized?: any;
            rawResult?: any;
            success: boolean;
        }) => {
            if (isCancellingRef.current) return;

            let resultPreview = '';
            try {
                const result = payload.sanitized || payload.rawResult;
                if (result) {
                    let resultStr = '';
                    if (typeof result === 'string') {
                        resultStr = result;
                    } else if (result && typeof result === 'object') {
                        if (Array.isArray(result.content)) {
                            resultStr = result.content
                                .filter((item: { type?: string }) => item.type === 'text')
                                .map((item: { text?: string }) => item.text || '')
                                .join('\n');
                        } else if (result.text) {
                            resultStr = result.text;
                        } else {
                            resultStr = JSON.stringify(result, null, 2);
                        }
                    }

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

            if (payload.callId) {
                const toolMessageId = `tool-${payload.callId}`;
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === toolMessageId
                            ? { ...msg, toolResult: resultPreview, toolStatus: 'finished' }
                            : msg
                    )
                );
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
            if (
                event.type === ApprovalTypeEnum.TOOL_CONFIRMATION ||
                event.type === ApprovalTypeEnum.COMMAND_CONFIRMATION
            ) {
                const newApproval: ApprovalRequest = {
                    approvalId: event.approvalId,
                    type: event.type,
                    timestamp: event.timestamp,
                    metadata: event.metadata,
                };

                if (event.sessionId !== undefined) {
                    newApproval.sessionId = event.sessionId;
                }
                if (event.timeout !== undefined) {
                    newApproval.timeout = event.timeout;
                }

                // Queue if there's already an approval, otherwise show immediately
                setApproval((current) => {
                    if (current !== null) {
                        setApprovalQueue((queue) => [...queue, newApproval]);
                        return current;
                    }
                    setUi((prev) => ({ ...prev, activeOverlay: 'approval' }));
                    return newApproval;
                });
            }
        };

        // Handle model switch
        const handleModelSwitch = (payload: any) => {
            if (payload.newConfig?.model) {
                setSession((prev) => ({ ...prev, modelName: payload.newConfig.model }));
            }
        };

        // Handle conversation reset
        const handleConversationReset = () => {
            setMessages([]);
            setApproval(null);
            setApprovalQueue([]);
            setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
        };

        // Handle session creation (e.g., from /clear command)
        const handleSessionCreated = (payload: { sessionId: string | null; switchTo: boolean }) => {
            if (payload.switchTo) {
                setMessages([]);
                setApproval(null);
                setApprovalQueue([]);

                if (payload.sessionId === null) {
                    setSession((prev) => ({ ...prev, id: null, hasActiveSession: false }));
                } else {
                    setSession((prev) => ({
                        ...prev,
                        id: payload.sessionId,
                        hasActiveSession: true,
                    }));
                }
                setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
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
        bus.on('run:complete', handleRunComplete);
        bus.on('llm:switched', handleModelSwitch);
        bus.on('session:reset', handleConversationReset);
        bus.on('session:created', handleSessionCreated);

        // Cleanup
        return () => {
            bus.off('llm:thinking', handleThinking);
            bus.off('llm:chunk', handleChunk);
            bus.off('llm:response', handleResponse);
            bus.off('llm:error', handleError);
            bus.off('llm:tool-call', handleToolCall);
            bus.off('llm:tool-result', handleToolResult);
            bus.off('run:complete', handleRunComplete);
            bus.off('approval:request', handleApprovalRequest);
            bus.off('llm:switched', handleModelSwitch);
            bus.off('session:reset', handleConversationReset);
            bus.off('session:created', handleSessionCreated);
        };
    }, [agent, setMessages, setUi, setSession, setApproval, setApprovalQueue]);
}
