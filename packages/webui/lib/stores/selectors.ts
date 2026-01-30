/**
 * Store Selectors
 *
 * Centralized selector hooks for Zustand stores.
 * These hooks encapsulate common selector patterns to:
 * - Reduce duplication across components
 * - Ensure consistent null-safety handling
 * - Provide stable references to prevent re-renders
 *
 * @example
 * ```tsx
 * // Instead of repeating this pattern:
 * const messages = useChatStore((s) => {
 *     if (!sessionId) return EMPTY_MESSAGES;
 *     return s.sessions.get(sessionId)?.messages ?? EMPTY_MESSAGES;
 * });
 *
 * // Use:
 * const messages = useSessionMessages(sessionId);
 * ```
 */

import { useMemo } from 'react';
import { useChatStore, type Message, type ErrorMessage } from './chatStore.js';
import { useSessionStore } from './sessionStore.js';
import { useAgentStore, type AgentStatus, type ConnectionStatus } from './agentStore.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Stable empty array reference to prevent re-renders.
 * Using a constant reference ensures React's shallow comparison
 * doesn't trigger unnecessary re-renders when there are no messages.
 */
export const EMPTY_MESSAGES: Message[] = [];

// =============================================================================
// Session Selectors
// =============================================================================

/**
 * Get the current session ID
 */
export function useCurrentSessionId(): string | null {
    return useSessionStore((s) => s.currentSessionId);
}

/**
 * Check if in welcome state (no active session)
 */
export function useIsWelcomeState(): boolean {
    return useSessionStore((s) => s.isWelcomeState);
}

/**
 * Check if a session operation is in progress
 */
export function useIsSessionOperationPending(): boolean {
    return useSessionStore(
        (s) => s.isCreatingSession || s.isSwitchingSession || s.isLoadingHistory
    );
}

/**
 * Check if history replay is in progress (for suppressing notifications)
 */
export function useIsReplayingHistory(): boolean {
    return useSessionStore((s) => s.isReplayingHistory);
}

// =============================================================================
// Chat Selectors
// =============================================================================

/**
 * Get messages for a session (without streaming message)
 *
 * @param sessionId - Session ID or null
 * @returns Array of messages, empty array if no session
 */
export function useSessionMessages(sessionId: string | null): Message[] {
    return useChatStore((s) => {
        if (!sessionId) return EMPTY_MESSAGES;
        const session = s.sessions.get(sessionId);
        return session?.messages ?? EMPTY_MESSAGES;
    });
}

/**
 * Get the streaming message for a session
 *
 * @param sessionId - Session ID or null
 * @returns Streaming message or null
 */
export function useStreamingMessage(sessionId: string | null): Message | null {
    return useChatStore((s) => {
        if (!sessionId) return null;
        const session = s.sessions.get(sessionId);
        return session?.streamingMessage ?? null;
    });
}

/**
 * Get all messages including streaming message.
 * Uses useMemo internally for stable reference when combining.
 *
 * @param sessionId - Session ID or null
 * @returns Combined array of messages + streaming message
 */
export function useAllMessages(sessionId: string | null): Message[] {
    const baseMessages = useSessionMessages(sessionId);
    const streamingMessage = useStreamingMessage(sessionId);

    return useMemo(() => {
        if (streamingMessage) {
            return [...baseMessages, streamingMessage];
        }
        return baseMessages;
    }, [baseMessages, streamingMessage]);
}

/**
 * Get processing state for a session
 *
 * @param sessionId - Session ID or null
 * @returns True if session is processing
 */
export function useSessionProcessing(sessionId: string | null): boolean {
    return useChatStore((s) => {
        if (!sessionId) return false;
        const session = s.sessions.get(sessionId);
        return session?.processing ?? false;
    });
}

/**
 * Get error state for a session
 *
 * @param sessionId - Session ID or null
 * @returns Error object or null
 */
export function useSessionError(sessionId: string | null): ErrorMessage | null {
    return useChatStore((s) => {
        if (!sessionId) return null;
        const session = s.sessions.get(sessionId);
        return session?.error ?? null;
    });
}

/**
 * Get loading history state for a session
 *
 * @param sessionId - Session ID or null
 * @returns True if loading history
 */
export function useSessionLoadingHistory(sessionId: string | null): boolean {
    return useChatStore((s) => {
        if (!sessionId) return false;
        const session = s.sessions.get(sessionId);
        return session?.loadingHistory ?? false;
    });
}

// =============================================================================
// Agent Selectors
// =============================================================================

/**
 * Get the current tool name being executed
 */
export function useCurrentToolName(): string | null {
    return useAgentStore((s) => s.currentToolName);
}

/**
 * Get the agent's current status
 */
export function useAgentStatus(): AgentStatus {
    return useAgentStore((s) => s.status);
}

/**
 * Get the agent's connection status
 */
export function useConnectionStatus(): ConnectionStatus {
    return useAgentStore((s) => s.connectionStatus);
}

/**
 * Check if the agent is busy (not idle)
 */
export function useIsAgentBusy(): boolean {
    return useAgentStore((s) => s.status !== 'idle');
}

/**
 * Check if the agent is connected
 */
export function useIsAgentConnected(): boolean {
    return useAgentStore((s) => s.connectionStatus === 'connected');
}

/**
 * Get the active session ID for the agent
 */
export function useAgentActiveSession(): string | null {
    return useAgentStore((s) => s.activeSessionId);
}

// =============================================================================
// Combined Selectors (Convenience Hooks)
// =============================================================================

/**
 * Combined chat state for a session.
 * Use this when a component needs multiple pieces of session state.
 *
 * @param sessionId - Session ID or null
 * @returns Object with messages, processing, error, and loadingHistory
 *
 * @example
 * ```tsx
 * const { messages, processing, error } = useSessionChatState(sessionId);
 * ```
 */
export function useSessionChatState(sessionId: string | null) {
    const messages = useAllMessages(sessionId);
    const processing = useSessionProcessing(sessionId);
    const error = useSessionError(sessionId);
    const loadingHistory = useSessionLoadingHistory(sessionId);

    return { messages, processing, error, loadingHistory };
}

/**
 * Combined agent state.
 * Use this when a component needs multiple pieces of agent state.
 *
 * @returns Object with status, connectionStatus, currentToolName, and isBusy
 *
 * @example
 * ```tsx
 * const { status, isBusy, currentToolName } = useAgentState();
 * ```
 */
export function useAgentState() {
    const status = useAgentStatus();
    const connectionStatus = useConnectionStatus();
    const currentToolName = useCurrentToolName();
    const isBusy = useIsAgentBusy();

    return { status, connectionStatus, currentToolName, isBusy };
}
