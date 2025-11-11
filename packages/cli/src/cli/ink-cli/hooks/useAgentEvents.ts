/**
 * Hook for managing agent event bus subscriptions
 * Transforms agent events into state actions
 */

import { useEffect } from 'react';
import type { DextoAgent, AgentEventBus, ApprovalType } from '@dexto/core';
import { ApprovalType as ApprovalTypeEnum } from '@dexto/core';
import type { CLIAction } from '../state/actions.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';

interface UseAgentEventsProps {
    agent: DextoAgent;
    dispatch: React.Dispatch<CLIAction>;
}

/**
 * Subscribes to agent event bus and dispatches state actions
 * Decouples event bus from UI components
 */
export function useAgentEvents({ agent, dispatch }: UseAgentEventsProps): void {
    useEffect(() => {
        const bus: AgentEventBus = agent.agentEventBus;

        // Handle streaming chunks
        const handleChunk = (payload: { type: string; content: string }) => {
            if (payload.type === 'text') {
                dispatch({
                    type: 'STREAMING_CHUNK',
                    content: payload.content,
                });
            }
        };

        // Handle response completion
        const handleResponse = (payload: { content: string }) => {
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
        const handleToolCall = (payload: { toolName: string; args: any }) => {
            dispatch({
                type: 'MESSAGE_ADD',
                message: {
                    id: `tool-${Date.now()}`,
                    role: 'tool',
                    content: `🔧 Calling tool: ${payload.toolName}`,
                    timestamp: new Date(),
                },
            });
        };

        // Handle approval requests
        const handleApprovalRequest = (event: {
            approvalId: string;
            type: string;
            sessionId?: string;
            timeout?: number;
            timestamp: Date;
            metadata: Record<string, any>;
        }) => {
            // Only handle tool confirmation approvals in ink-cli
            if (event.type === ApprovalTypeEnum.TOOL_CONFIRMATION) {
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
        bus.on('llmservice:chunk', handleChunk);
        bus.on('llmservice:response', handleResponse);
        bus.on('llmservice:error', handleError);
        bus.on('llmservice:toolCall', handleToolCall);
        bus.on('dexto:approvalRequest', handleApprovalRequest);

        // Cleanup on unmount
        return () => {
            bus.off('llmservice:chunk', handleChunk);
            bus.off('llmservice:response', handleResponse);
            bus.off('llmservice:error', handleError);
            bus.off('llmservice:toolCall', handleToolCall);
            bus.off('dexto:approvalRequest', handleApprovalRequest);
        };
    }, [agent, dispatch]);
}
