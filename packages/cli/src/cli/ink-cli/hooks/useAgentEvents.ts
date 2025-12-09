/**
 * Hook for managing agent event bus subscriptions
 * Handles events directly, updating state via setters
 *
 * Uses AbortController pattern for cleanup - when the effect cleans up,
 * all listeners are automatically removed via signal.abort()
 */

import type React from 'react';
import { useEffect, useRef } from 'react';
import type { DextoAgent } from '@dexto/core';
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
 * Subscribes to agent event bus and handles events directly.
 * Event handlers are inlined to leverage TypeScript's type inference from AgentEventMap.
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
        const bus = agent.agentEventBus;
        const controller = new AbortController();
        const { signal } = controller;

        // Handle thinking event (when LLM starts processing)
        bus.on(
            'llm:thinking',
            () => {
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
            },
            { signal }
        );

        // Handle streaming chunks - payload type inferred from AgentEventMap
        bus.on(
            'llm:chunk',
            (payload) => {
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
                        prev.map((msg) =>
                            msg.id === streamId ? { ...msg, content: newContent } : msg
                        )
                    );
                }
            },
            { signal }
        );

        // Handle response completion (may fire multiple times during tool use)
        bus.on(
            'llm:response',
            (payload) => {
                if (isCancellingRef.current) return;

                const streaming = streamingRef.current;
                if (!streaming.id) return;

                // Finalize the streaming message
                const streamId = streaming.id;
                const finalContent =
                    payload.content && payload.content.length > 0
                        ? payload.content
                        : streaming.content;

                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === streamId
                            ? { ...msg, content: finalContent, isStreaming: false }
                            : msg
                    )
                );

                // Clear streaming state
                streamingRef.current = { id: null, content: '' };
            },
            { signal }
        );

        // Handle run completion (fires once when entire run finishes)
        bus.on(
            'run:complete',
            () => {
                if (isCancellingRef.current) return;
                setUi((prev) => ({
                    ...prev,
                    isProcessing: false,
                    isCancelling: false,
                    isThinking: false,
                }));
            },
            { signal }
        );

        // Handle errors
        bus.on(
            'llm:error',
            (payload) => {
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
            },
            { signal }
        );

        // Handle tool calls - payload type inferred from AgentEventMap
        bus.on(
            'llm:tool-call',
            (payload) => {
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
            },
            { signal }
        );

        // Handle tool results - payload type inferred from AgentEventMap
        bus.on(
            'llm:tool-result',
            (payload) => {
                if (isCancellingRef.current) return;

                let resultPreview = '';
                try {
                    const result = payload.sanitized || payload.rawResult;
                    if (result) {
                        let resultStr = '';
                        if (typeof result === 'string') {
                            resultStr = result;
                        } else if (result && typeof result === 'object') {
                            // SanitizedToolResult has content array
                            const resultObj = result as { content?: unknown[]; text?: string };
                            if (Array.isArray(resultObj.content)) {
                                resultStr = resultObj.content
                                    .filter(
                                        (item): item is { type: string; text?: string } =>
                                            typeof item === 'object' &&
                                            item !== null &&
                                            'type' in item &&
                                            item.type === 'text'
                                    )
                                    .map((item) => item.text || '')
                                    .join('\n');
                            } else if (resultObj.text) {
                                resultStr = resultObj.text;
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
            },
            { signal }
        );

        // Handle approval requests - payload type inferred from AgentEventMap (ApprovalRequest)
        bus.on(
            'approval:request',
            (event) => {
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
            },
            { signal }
        );

        // Handle model switch - payload type inferred from AgentEventMap
        bus.on(
            'llm:switched',
            (payload) => {
                if (payload.newConfig?.model) {
                    setSession((prev) => ({ ...prev, modelName: payload.newConfig.model }));
                }
            },
            { signal }
        );

        // Handle conversation reset
        bus.on(
            'session:reset',
            () => {
                setMessages([]);
                setApproval(null);
                setApprovalQueue([]);
                setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
            },
            { signal }
        );

        // Handle session creation (e.g., from /clear command)
        bus.on(
            'session:created',
            (payload) => {
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
            },
            { signal }
        );

        // Cleanup: abort controller removes all listeners at once
        return () => {
            controller.abort();
        };
    }, [agent, setMessages, setUi, setSession, setApproval, setApprovalQueue]);
}
