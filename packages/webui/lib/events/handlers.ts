/**
 * Event Handler Registry
 *
 * Maps StreamingEvent types to Zustand store actions.
 * Replaces the 200+ LOC switch statement in useChat.ts with a registry pattern.
 *
 * Each handler is responsible for:
 * - Extracting relevant data from the event
 * - Calling the appropriate store action(s)
 * - Keeping side effects simple and focused
 *
 * @see packages/webui/components/hooks/useChat.ts (original implementation)
 */

import type { StreamingEvent, ApprovalStatus } from '@dexto/core';
import { useChatStore, generateMessageId } from '../stores/chatStore.js';
import { useAgentStore } from '../stores/agentStore.js';
import { useApprovalStore } from '../stores/approvalStore.js';
import { usePreferenceStore } from '../stores/preferenceStore.js';
import { useTodoStore } from '../stores/todoStore.js';
import type { ClientEventBus } from './EventBus.js';
import { captureTokenUsage } from '../analytics/capture.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Generic event handler function
 */
type EventHandler<T = StreamingEvent> = (event: T) => void;

/**
 * Extract specific event type by name
 * For events not in StreamingEvent, we use a broader constraint
 */
type EventByName<T extends string> =
    Extract<StreamingEvent, { name: T }> extends never
        ? { name: T; sessionId: string; [key: string]: any }
        : Extract<StreamingEvent, { name: T }>;

// =============================================================================
// Handler Registry
// =============================================================================

/**
 * Map of event names to their handlers
 * Uses string as key type to support all event names
 */
const handlers = new Map<string, EventHandler<any>>();

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Finalizes any in-progress streaming message for a session.
 * This ensures proper message ordering when tool calls or approvals arrive
 * while the assistant is still streaming content.
 */
function finalizeStreamingIfNeeded(sessionId: string): void {
    const chatStore = useChatStore.getState();
    const sessionState = chatStore.getSessionState(sessionId);

    if (sessionState.streamingMessage) {
        // Move streaming message to messages array before adding new messages
        chatStore.finalizeStreamingMessage(sessionId, {});
    }
}

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * llm:thinking - LLM started thinking
 * Sets processing=true and agent status to 'thinking'
 */
function handleLLMThinking(event: EventByName<'llm:thinking'>): void {
    const { sessionId } = event;

    // Update chat state
    useChatStore.getState().setProcessing(sessionId, true);

    // Update agent status
    useAgentStore.getState().setThinking(sessionId);
}

/**
 * llm:chunk - LLM sent streaming chunk
 * Appends content to streaming message (text or reasoning)
 *
 * When streaming is disabled (user preference), chunks are skipped
 * and the full content comes via llm:response instead.
 */
function handleLLMChunk(event: EventByName<'llm:chunk'>): void {
    // Check user streaming preference
    const isStreaming = usePreferenceStore.getState().isStreaming;
    if (!isStreaming) {
        // Skip chunk updates when streaming is disabled
        // llm:response will provide the full content
        return;
    }

    const { sessionId, content, chunkType = 'text' } = event;
    const chatStore = useChatStore.getState();

    // Check if streaming message exists
    const sessionState = chatStore.getSessionState(sessionId);

    if (!sessionState.streamingMessage) {
        // Create new streaming message
        const newMessage = {
            id: generateMessageId(),
            role: 'assistant' as const,
            content: chunkType === 'text' ? content : '',
            reasoning: chunkType === 'reasoning' ? content : undefined,
            createdAt: Date.now(),
            sessionId,
        };
        chatStore.setStreamingMessage(sessionId, newMessage);
    } else {
        // Append to existing streaming message
        chatStore.appendToStreamingMessage(sessionId, content, chunkType);
    }
}

/**
 * llm:response - LLM sent final response
 * Finalizes streaming message OR creates assistant message if needed
 *
 * Handles three scenarios:
 * 1. Streaming mode: streaming message exists → finalize with content and metadata
 * 2. Non-streaming mode: no streaming message → create new assistant message
 * 3. Multi-turn: assistant message already in messages array → update it
 */
function handleLLMResponse(event: EventByName<'llm:response'>): void {
    const { sessionId, content, tokenUsage, model, provider, estimatedInputTokens } = event;
    const chatStore = useChatStore.getState();
    const sessionState = chatStore.getSessionState(sessionId);
    const finalContent = typeof content === 'string' ? content : '';

    // Check if there's a streaming message to finalize
    if (sessionState.streamingMessage) {
        // Finalize streaming message with content and metadata
        chatStore.finalizeStreamingMessage(sessionId, {
            content: finalContent,
            tokenUsage,
            ...(model && { model }),
            ...(provider && { provider }),
        });

        // Track token usage analytics before returning
        if (tokenUsage && (tokenUsage.inputTokens || tokenUsage.outputTokens)) {
            // Calculate estimate accuracy if both estimate and actual are available
            let estimateAccuracyPercent: number | undefined;
            if (estimatedInputTokens !== undefined && tokenUsage.inputTokens) {
                const diff = estimatedInputTokens - tokenUsage.inputTokens;
                estimateAccuracyPercent = Math.round((diff / tokenUsage.inputTokens) * 100);
            }

            captureTokenUsage({
                sessionId,
                provider,
                model,
                inputTokens: tokenUsage.inputTokens,
                outputTokens: tokenUsage.outputTokens,
                reasoningTokens: tokenUsage.reasoningTokens,
                totalTokens: tokenUsage.totalTokens,
                cacheReadTokens: tokenUsage.cacheReadTokens,
                cacheWriteTokens: tokenUsage.cacheWriteTokens,
                estimatedInputTokens,
                estimateAccuracyPercent,
            });
        }
        return;
    }

    // No streaming message - find the most recent assistant message in this turn
    // This handles cases where streaming was finalized before tool calls
    const messages = sessionState.messages;

    // Look for the most recent assistant message (may have tool messages after it)
    let recentAssistantMsg = null;
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'assistant') {
            recentAssistantMsg = msg;
            break;
        }
        // Stop searching if we hit a user message (different turn)
        if (msg.role === 'user') {
            break;
        }
    }

    if (recentAssistantMsg) {
        // Update existing assistant message with final content and metadata
        chatStore.updateMessage(sessionId, recentAssistantMsg.id, {
            content: finalContent || recentAssistantMsg.content,
            tokenUsage,
            ...(model && { model }),
            ...(provider && { provider }),
        });
    } else if (finalContent) {
        // No assistant message exists - create one with the final content
        // This handles non-streaming mode or first response
        chatStore.addMessage(sessionId, {
            id: generateMessageId(),
            role: 'assistant',
            content: finalContent,
            tokenUsage,
            ...(model && { model }),
            ...(provider && { provider }),
            createdAt: Date.now(),
            sessionId,
        });
    }

    // Track token usage analytics (at end, after all processing)
    if (tokenUsage && (tokenUsage.inputTokens || tokenUsage.outputTokens)) {
        // Calculate estimate accuracy if both estimate and actual are available
        let estimateAccuracyPercent: number | undefined;
        if (estimatedInputTokens !== undefined && tokenUsage.inputTokens) {
            const diff = estimatedInputTokens - tokenUsage.inputTokens;
            estimateAccuracyPercent = Math.round((diff / tokenUsage.inputTokens) * 100);
        }

        captureTokenUsage({
            sessionId,
            provider,
            model,
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            reasoningTokens: tokenUsage.reasoningTokens,
            totalTokens: tokenUsage.totalTokens,
            cacheReadTokens: tokenUsage.cacheReadTokens,
            cacheWriteTokens: tokenUsage.cacheWriteTokens,
            estimatedInputTokens,
            estimateAccuracyPercent,
        });
    }
}

/**
 * llm:tool-call - LLM requested a tool call
 * Adds a tool message to the chat
 *
 * Checks if an approval message already exists for this tool to avoid duplicates.
 * This handles cases where approval:request arrives before llm:tool-call.
 */
function handleToolCall(event: EventByName<'llm:tool-call'>): void {
    const { sessionId, toolName, args, callId } = event;
    const chatStore = useChatStore.getState();

    // Finalize any streaming message to maintain proper sequence
    finalizeStreamingIfNeeded(sessionId);

    const messages = chatStore.getMessages(sessionId);

    // Check if there's already a message for this tool call (from approval:request)
    // The approval message uses the approvalId which may equal callId
    const existingMessage = messages.find(
        (m) => m.role === 'tool' && m.toolCallId === callId && m.toolResult === undefined
    );

    if (existingMessage) {
        // Approval message already exists - update with args if needed
        chatStore.updateMessage(sessionId, existingMessage.id, {
            toolArgs: args,
        });
        console.debug('[handlers] Tool call message already exists:', existingMessage.id);
        return;
    }

    // Check for pending approval messages that don't have a result yet
    // Match by: 1) exact toolName, 2) toolName without prefix, 3) any pending approval
    const stripPrefix = (name: string) =>
        name
            .replace(/^(internal--|custom--|mcp--[^-]+--|mcp__[^_]+__)/, '')
            .replace(/^(internal__|custom__)/, '');
    const cleanToolName = stripPrefix(toolName);

    const pendingApprovalMessage = messages.find((m) => {
        if (m.role !== 'tool' || m.toolResult !== undefined) return false;
        if (m.requireApproval !== true || m.approvalStatus !== 'pending') return false;

        // Match by toolName (exact or stripped)
        if (m.toolName === toolName) return true;
        if (m.toolName && stripPrefix(m.toolName) === cleanToolName) return true;

        return false;
    });

    if (pendingApprovalMessage) {
        // Update existing approval message with the callId and args
        chatStore.updateMessage(sessionId, pendingApprovalMessage.id, {
            toolCallId: callId,
            toolArgs: args,
        });
        console.debug(
            '[handlers] Updated existing approval message with callId:',
            pendingApprovalMessage.id
        );
        return;
    }

    // Create tool message
    const toolMessage = {
        id: `tool-${callId}`,
        role: 'tool' as const,
        content: null,
        toolName,
        toolArgs: args,
        toolCallId: callId,
        createdAt: Date.now(),
        sessionId,
    };

    chatStore.addMessage(sessionId, toolMessage);

    // Update agent status
    useAgentStore.getState().setExecutingTool(sessionId, toolName);
}

/**
 * llm:tool-result - LLM returned a tool result
 * Updates the tool message with the result
 *
 * Finds the tool message by multiple strategies:
 * 1. Direct match by toolCallId
 * 2. Message with id `tool-${callId}` or `approval-${callId}`
 * 3. Most recent pending tool message (fallback)
 */
function handleToolResult(event: EventByName<'llm:tool-result'>): void {
    const { sessionId, callId, success, sanitized, requireApproval, approvalStatus } = event;
    const chatStore = useChatStore.getState();

    // Try to find the tool message
    let message = callId ? chatStore.getMessageByToolCallId(sessionId, callId) : undefined;

    // If not found by toolCallId, try by message ID patterns
    if (!message && callId) {
        const messages = chatStore.getMessages(sessionId);
        message = messages.find((m) => m.id === `tool-${callId}` || m.id === `approval-${callId}`);
    }

    // If still not found, find the most recent pending tool message
    if (!message) {
        const messages = chatStore.getMessages(sessionId);
        const pendingTools = messages
            .filter((m) => m.role === 'tool' && m.toolResult === undefined)
            .sort((a, b) => b.createdAt - a.createdAt);

        // Prioritize approval messages
        message = pendingTools.find((m) => m.id.startsWith('approval-')) || pendingTools[0];
    }

    if (message) {
        // Update with result - include toolResultMeta for display data
        chatStore.updateMessage(sessionId, message.id, {
            toolResult: sanitized,
            toolResultMeta: sanitized?.meta,
            toolResultSuccess: success,
            ...(requireApproval !== undefined && { requireApproval }),
            ...(approvalStatus !== undefined && { approvalStatus }),
        });
    } else {
        console.warn('[handlers] Could not find tool message to update for callId:', callId);
    }
}

/**
 * llm:error - LLM encountered an error
 * Sets error state and stops processing
 */
function handleLLMError(event: EventByName<'llm:error'>): void {
    const { sessionId, error, context, recoverable } = event;
    const chatStore = useChatStore.getState();

    // Set error in chat store
    chatStore.setError(sessionId, {
        id: generateMessageId(),
        message: error?.message || 'Unknown error',
        timestamp: Date.now(),
        context,
        recoverable,
        sessionId,
    });

    // Stop processing
    chatStore.setProcessing(sessionId, false);

    // Update agent status
    useAgentStore.getState().setIdle();
}

/**
 * approval:request - User approval requested
 * Adds approval to store, creates/updates tool message, and sets agent status to awaiting approval
 *
 * Creates a tool message with approval state so the UI can render approve/reject inline.
 */
function handleApprovalRequest(event: EventByName<'approval:request'>): void {
    const sessionId = event.sessionId || '';
    const chatStore = useChatStore.getState();

    // Finalize any streaming message to maintain proper sequence
    if (sessionId) {
        finalizeStreamingIfNeeded(sessionId);
    }

    // The event IS the approval request
    useApprovalStore.getState().addApproval(event);

    // Extract tool info from the approval event
    const approvalId = (event as any).approvalId;
    const toolName = (event as any).metadata?.toolName || (event as any).toolName || 'unknown';
    const toolArgs = (event as any).metadata?.args || (event as any).args || {};
    const approvalType = (event as any).type;

    // Helper to strip prefixes for matching
    const stripPrefix = (name: string) =>
        name
            .replace(/^(internal--|custom--|mcp--[^-]+--|mcp__[^_]+__)/, '')
            .replace(/^(internal__|custom__)/, '');
    const cleanToolName = stripPrefix(toolName);

    // Check if there's already a tool message for this approval
    const messages = chatStore.getMessages(sessionId);
    const existingToolMessage = messages.find((m) => {
        if (m.role !== 'tool' || m.toolResult !== undefined) return false;
        // Already has approval - skip
        if (m.requireApproval === true) return false;
        // Match by toolName (exact or stripped)
        if (m.toolName === toolName) return true;
        if (m.toolName && stripPrefix(m.toolName) === cleanToolName) return true;
        return false;
    });

    if (existingToolMessage) {
        // Update existing tool message with approval info
        chatStore.updateMessage(sessionId, existingToolMessage.id, {
            requireApproval: true,
            approvalStatus: 'pending',
        });
        console.debug(
            '[handlers] Updated existing tool message with approval:',
            existingToolMessage.id
        );
    } else if (sessionId) {
        // Check if there's already a pending approval message to avoid duplicates
        const existingApprovalMessage = messages.find(
            (m) =>
                m.role === 'tool' &&
                m.requireApproval === true &&
                m.approvalStatus === 'pending' &&
                m.toolResult === undefined &&
                (m.toolName === toolName ||
                    (m.toolName && stripPrefix(m.toolName) === cleanToolName))
        );

        if (existingApprovalMessage) {
            console.debug(
                '[handlers] Approval message already exists:',
                existingApprovalMessage.id
            );
        } else {
            // Create a new tool message with approval state
            const approvalMessage = {
                id: `approval-${approvalId}`,
                role: 'tool' as const,
                content: null,
                toolName,
                toolArgs,
                toolCallId: approvalId, // Use approvalId as callId for correlation
                createdAt: Date.now(),
                sessionId,
                requireApproval: true,
                approvalStatus: 'pending' as const,
                // Store approval metadata for rendering (elicitation, command, etc.)
                ...(approvalType && { approvalType }),
            };
            chatStore.addMessage(sessionId, approvalMessage);
        }
    }

    // Update agent status
    if (sessionId) {
        useAgentStore.getState().setAwaitingApproval(sessionId);
    }
}

/**
 * approval:response - User approval response received
 * Processes response in store, updates tool message status, and sets agent status back to thinking or idle
 */
function handleApprovalResponse(event: EventByName<'approval:response'>): void {
    const { status } = event;
    const sessionId = (event as any).sessionId || '';
    const approvalId = (event as any).approvalId;

    // The event IS the approval response
    useApprovalStore.getState().processResponse(event);

    // Update the tool message's approval status for audit trail
    if (sessionId && approvalId) {
        const chatStore = useChatStore.getState();
        const messages = chatStore.getMessages(sessionId);

        // Find the approval message by ID pattern
        const approvalMessage = messages.find(
            (m) =>
                m.id === `approval-${approvalId}` ||
                (m.toolCallId === approvalId && m.requireApproval)
        );

        if (approvalMessage) {
            const approvalStatus =
                status === ('approved' as ApprovalStatus) ? 'approved' : 'rejected';
            chatStore.updateMessage(sessionId, approvalMessage.id, {
                approvalStatus,
                // Mark rejected approvals as failed so UI shows error state
                ...(approvalStatus === 'rejected' && { toolResultSuccess: false }),
            });
            console.debug(
                '[handlers] Updated approval status:',
                approvalMessage.id,
                approvalStatus
            );
        }
    }

    // Update agent status based on approval
    // ApprovalStatus.APPROVED means approved, others mean rejected/cancelled
    const approved = status === ('approved' as ApprovalStatus);

    if (approved) {
        // Agent resumes execution after approval - set to thinking since it's actively processing.
        // Don't set to idle (agent isn't idle) or keep at awaiting_approval (no longer waiting).
        if (sessionId) {
            useAgentStore.getState().setThinking(sessionId);
        }
    } else {
        // Rejected/cancelled - go idle and stop processing
        useAgentStore.getState().setIdle();
        // Also stop processing since the run may be terminated
        if (sessionId) {
            useChatStore.getState().setProcessing(sessionId, false);
        }
    }
}

/**
 * run:complete - Agent run completed
 * Sets processing=false and agent status to idle
 */
function handleRunComplete(event: EventByName<'run:complete'>): void {
    const { sessionId } = event;
    const chatStore = useChatStore.getState();

    // Stop processing
    chatStore.setProcessing(sessionId, false);

    // Update agent status
    useAgentStore.getState().setIdle();
}

/**
 * session:title-updated - Session title updated
 * Handled by TanStack Query invalidation, placeholder for completeness
 */
function handleSessionTitleUpdated(event: EventByName<'session:title-updated'>): void {
    // This is handled by TanStack Query invalidation
    // Placeholder for registry completeness
    console.debug('[handlers] session:title-updated', event.sessionId, event.title);
}

/**
 * message:dequeued - Queued message was dequeued
 * Adds user message to chat (from queue)
 */
function handleMessageDequeued(event: EventByName<'message:dequeued'>): void {
    const { sessionId, content } = event;
    const chatStore = useChatStore.getState();

    // Extract text from content parts
    const textContent = content
        .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('\n');

    // Extract image attachment if present
    const imagePart = content.find(
        (part): part is Extract<typeof part, { type: 'image' }> => part.type === 'image'
    );

    // Extract file attachment if present
    const filePart = content.find(
        (part): part is Extract<typeof part, { type: 'file' }> => part.type === 'file'
    );

    if (textContent || content.length > 0) {
        // Create user message
        // Note: Only include imageData if image is a string (base64 or URL)
        const imageDataValue =
            imagePart && typeof imagePart.image === 'string'
                ? {
                      image: imagePart.image,
                      mimeType: imagePart.mimeType ?? 'image/jpeg',
                  }
                : undefined;

        const userMessage = {
            id: generateMessageId(),
            role: 'user' as const,
            content: textContent || '[attachment]',
            createdAt: Date.now(),
            sessionId,
            imageData: imageDataValue,
            fileData: filePart
                ? {
                      data: typeof filePart.data === 'string' ? filePart.data : '',
                      mimeType: filePart.mimeType,
                      filename: filePart.filename,
                  }
                : undefined,
        };

        chatStore.addMessage(sessionId, userMessage);
    }
}

/**
 * context:compacted - Context was compacted (inline compaction)
 * Log for now (future: add to activity store)
 */
function handleContextCompacted(event: EventByName<'context:compacted'>): void {
    console.debug(
        `[handlers] Context compacted: ${event.originalTokens.toLocaleString()} → ${event.compactedTokens.toLocaleString()} tokens (${event.originalMessages} → ${event.compactedMessages} messages) via ${event.strategy}`
    );
}

/**
 * service:event - Extensible service event for non-core services
 * Handles agent-spawner progress events and todo update events
 */
function handleServiceEvent(event: EventByName<'service:event'>): void {
    const { service, event: eventType, toolCallId, sessionId, data } = event;

    // Handle agent-spawner progress events
    if (service === 'agent-spawner' && eventType === 'progress' && toolCallId && sessionId) {
        const chatStore = useChatStore.getState();
        const progressData = data as {
            task: string;
            agentId: string;
            toolsCalled: number;
            currentTool: string;
            currentArgs?: Record<string, unknown>;
        };

        // Find and update the tool message
        const messages = chatStore.getMessages(sessionId);
        const toolMessage = messages.find((m) => m.role === 'tool' && m.toolCallId === toolCallId);

        if (toolMessage) {
            chatStore.updateMessage(sessionId, toolMessage.id, {
                subAgentProgress: {
                    task: progressData.task,
                    agentId: progressData.agentId,
                    toolsCalled: progressData.toolsCalled,
                    currentTool: progressData.currentTool,
                    currentArgs: progressData.currentArgs,
                },
            });
        }
    }

    // Handle todo update events
    if (service === 'todo' && eventType === 'updated' && sessionId) {
        const todoData = data as {
            todos: Array<{
                id: string;
                sessionId: string;
                content: string;
                activeForm: string;
                status: 'pending' | 'in_progress' | 'completed';
                position: number;
                createdAt: Date | string;
                updatedAt: Date | string;
            }>;
            stats: { created: number; updated: number; deleted: number };
        };

        // Update todo store with new todos
        useTodoStore.getState().setTodos(sessionId, todoData.todos);
    }
}

// =============================================================================
// Registry Management
// =============================================================================

/**
 * Register all handlers in the registry
 * Call this once during initialization
 */
export function registerHandlers(): void {
    // Clear existing handlers
    handlers.clear();

    // Register each handler
    handlers.set('llm:thinking', handleLLMThinking);
    handlers.set('llm:chunk', handleLLMChunk);
    handlers.set('llm:response', handleLLMResponse);
    handlers.set('llm:tool-call', handleToolCall);
    handlers.set('llm:tool-result', handleToolResult);
    handlers.set('llm:error', handleLLMError);
    handlers.set('approval:request', handleApprovalRequest);
    handlers.set('approval:response', handleApprovalResponse);
    handlers.set('run:complete', handleRunComplete);
    handlers.set('session:title-updated', handleSessionTitleUpdated);
    handlers.set('message:dequeued', handleMessageDequeued);
    handlers.set('context:compacted', handleContextCompacted);
    handlers.set('service:event', handleServiceEvent);
}

/**
 * Get a handler for a specific event name
 *
 * @param name - Event name
 * @returns Handler function or undefined if not registered
 */
export function getHandler(name: string): EventHandler | undefined {
    return handlers.get(name);
}

/**
 * Setup event handlers for the EventBus
 * Registers all handlers and subscribes them to the bus
 *
 * @param bus - ClientEventBus instance
 *
 * @example
 * ```tsx
 * const bus = useEventBus();
 * useEffect(() => {
 *   const cleanup = setupEventHandlers(bus);
 *   return cleanup;
 * }, [bus]);
 * ```
 */
export function setupEventHandlers(bus: ClientEventBus): () => void {
    // Register handlers
    registerHandlers();

    // Subscribe each handler to the bus
    const subscriptions: Array<{ unsubscribe: () => void }> = [];

    handlers.forEach((handler, eventName) => {
        // Cast to any to bypass strict typing - handlers map uses string keys
        // but bus.on expects specific event names. This is safe because
        // registerHandlers() only adds valid event names.
        const subscription = bus.on(eventName as any, handler);
        subscriptions.push(subscription);
    });

    // Return cleanup function
    return () => {
        subscriptions.forEach((sub) => sub.unsubscribe());
    };
}

// =============================================================================
// Exports
// =============================================================================

// Export individual handlers for testing
export {
    handleLLMThinking,
    handleLLMChunk,
    handleLLMResponse,
    handleToolCall,
    handleToolResult,
    handleLLMError,
    handleApprovalRequest,
    handleApprovalResponse,
    handleRunComplete,
    handleSessionTitleUpdated,
    handleMessageDequeued,
    handleContextCompacted,
    handleServiceEvent,
};
