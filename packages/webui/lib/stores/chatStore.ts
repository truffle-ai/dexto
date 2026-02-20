/**
 * Chat Store
 *
 * Manages message state per session using Zustand.
 * Each session has isolated message state to support multi-session scenarios.
 */

import { create } from 'zustand';
import type {
    InternalMessage,
    Issue,
    SanitizedToolResult,
    LLMProvider,
    ToolPresentationSnapshotV1,
} from '@dexto/core';
import type { TextPart, ImagePart, AudioPart, FilePart, FileData, UIResourcePart } from '@/types';

// =============================================================================
// Types
// =============================================================================

/**
 * UI Message role - excludes 'system' which is filtered out before reaching UI
 */
export type UIMessageRole = 'user' | 'assistant' | 'tool';

/**
 * Tool result type for UI messages
 * Broader than SanitizedToolResult to handle legacy formats and edge cases
 */
export type ToolResult =
    | SanitizedToolResult
    | { error: string | Record<string, unknown> }
    | string
    | Record<string, unknown>;

/**
 * Sub-agent progress data for spawn_agent tool calls
 */
export interface SubAgentProgress {
    /** Short task description */
    task: string;
    /** Agent ID (e.g., 'explore-agent') */
    agentId: string;
    /** Number of tools called by the sub-agent */
    toolsCalled: number;
    /** Current tool being executed */
    currentTool: string;
    /** Current tool arguments (optional) */
    currentArgs?: Record<string, unknown>;
}

/**
 * Message in the chat UI
 * Extends core InternalMessage with UI-specific fields
 * Note: Excludes 'system' role as system messages are not displayed in UI
 */
export interface Message extends Omit<InternalMessage, 'content' | 'role'> {
    id: string;
    role: UIMessageRole;
    createdAt: number;
    content: string | null | Array<TextPart | ImagePart | AudioPart | FilePart | UIResourcePart>;

    // User attachments
    imageData?: { image: string; mimeType: string };
    fileData?: FileData;

    // Tool-related fields
    toolName?: string;
    toolDisplayName?: string;
    presentationSnapshot?: ToolPresentationSnapshotV1;
    toolArgs?: Record<string, unknown>;
    toolCallId?: string;
    toolResult?: ToolResult;
    toolResultMeta?: SanitizedToolResult['meta'];
    toolResultSuccess?: boolean;
    /** Sub-agent progress data (for spawn_agent tool calls) */
    subAgentProgress?: SubAgentProgress;

    // Approval fields
    requireApproval?: boolean;
    approvalStatus?: 'pending' | 'approved' | 'rejected';

    // LLM metadata
    tokenUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        reasoningTokens?: number;
        totalTokens?: number;
    };
    reasoning?: string;
    model?: string;
    provider?: LLMProvider;

    // Session reference
    sessionId?: string;
}

/**
 * Error state for a session
 */
export interface ErrorMessage {
    id: string;
    message: string;
    timestamp: number;
    context?: string;
    recoverable?: boolean;
    sessionId?: string;
    anchorMessageId?: string;
    detailedIssues?: Issue[];
}

/**
 * State for a single session
 */
export interface SessionChatState {
    messages: Message[];
    streamingMessage: Message | null;
    processing: boolean;
    error: ErrorMessage | null;
    loadingHistory: boolean;
}

/**
 * Default state for a new session
 */
const defaultSessionState: SessionChatState = {
    messages: [],
    streamingMessage: null,
    processing: false,
    error: null,
    loadingHistory: false,
};

// =============================================================================
// Store Interface
// =============================================================================

interface ChatStore {
    /**
     * Session states keyed by session ID
     */
    sessions: Map<string, SessionChatState>;

    // -------------------------------------------------------------------------
    // Message Actions
    // -------------------------------------------------------------------------

    /**
     * Add a message to a session
     */
    addMessage: (sessionId: string, message: Message) => void;

    /**
     * Update an existing message
     */
    updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;

    /**
     * Remove a message from a session
     */
    removeMessage: (sessionId: string, messageId: string) => void;

    /**
     * Clear all messages in a session
     */
    clearMessages: (sessionId: string) => void;

    /**
     * Set all messages for a session at once
     */
    setMessages: (sessionId: string, messages: Message[]) => void;

    /**
     * Initialize or replace session state with history
     */
    initFromHistory: (sessionId: string, messages: Message[]) => void;

    // -------------------------------------------------------------------------
    // Streaming Actions
    // -------------------------------------------------------------------------

    /**
     * Set the current streaming message for a session
     */
    setStreamingMessage: (sessionId: string, message: Message | null) => void;

    /**
     * Append content to the streaming message
     */
    appendToStreamingMessage: (
        sessionId: string,
        content: string,
        chunkType?: 'text' | 'reasoning'
    ) => void;

    /**
     * Finalize streaming message (move to messages array)
     */
    finalizeStreamingMessage: (sessionId: string, updates?: Partial<Message>) => void;

    // -------------------------------------------------------------------------
    // State Actions
    // -------------------------------------------------------------------------

    /**
     * Set processing state for a session
     */
    setProcessing: (sessionId: string, processing: boolean) => void;

    /**
     * Set error state for a session
     */
    setError: (sessionId: string, error: ErrorMessage | null) => void;

    /**
     * Set loading history state for a session
     */
    setLoadingHistory: (sessionId: string, loading: boolean) => void;

    // -------------------------------------------------------------------------
    // Session Actions
    // -------------------------------------------------------------------------

    /**
     * Initialize a session with default state
     */
    initSession: (sessionId: string) => void;

    /**
     * Remove a session completely
     */
    removeSession: (sessionId: string) => void;

    // -------------------------------------------------------------------------
    // Selectors
    // -------------------------------------------------------------------------

    /**
     * Get state for a session (creates default if not exists)
     */
    getSessionState: (sessionId: string) => SessionChatState;

    /**
     * Get messages for a session
     */
    getMessages: (sessionId: string) => Message[];

    /**
     * Get a specific message by ID
     */
    getMessage: (sessionId: string, messageId: string) => Message | undefined;

    /**
     * Find message by tool call ID
     */
    getMessageByToolCallId: (sessionId: string, toolCallId: string) => Message | undefined;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get or create session state
 */
function getOrCreateSession(
    sessions: Map<string, SessionChatState>,
    sessionId: string
): SessionChatState {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    return { ...defaultSessionState };
}

/**
 * Generate unique message ID
 */
export function generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useChatStore = create<ChatStore>()((set, get) => ({
    sessions: new Map(),

    // -------------------------------------------------------------------------
    // Message Actions
    // -------------------------------------------------------------------------

    addMessage: (sessionId, message) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                messages: [...sessionState.messages, message],
            });

            return { sessions: newSessions };
        });
    },

    updateMessage: (sessionId, messageId, updates) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = newSessions.get(sessionId);
            if (!sessionState) return state;

            const messageIndex = sessionState.messages.findIndex((m) => m.id === messageId);
            if (messageIndex === -1) return state;

            const newMessages = [...sessionState.messages];
            newMessages[messageIndex] = { ...newMessages[messageIndex], ...updates };

            newSessions.set(sessionId, {
                ...sessionState,
                messages: newMessages,
            });

            return { sessions: newSessions };
        });
    },

    removeMessage: (sessionId, messageId) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = newSessions.get(sessionId);
            if (!sessionState) return state;

            newSessions.set(sessionId, {
                ...sessionState,
                messages: sessionState.messages.filter((m) => m.id !== messageId),
            });

            return { sessions: newSessions };
        });
    },

    clearMessages: (sessionId) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = newSessions.get(sessionId);
            if (!sessionState) return state;

            newSessions.set(sessionId, {
                ...sessionState,
                messages: [],
                streamingMessage: null,
            });

            return { sessions: newSessions };
        });
    },

    setMessages: (sessionId, messages) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                messages,
            });

            return { sessions: newSessions };
        });
    },

    initFromHistory: (sessionId, messages) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                messages,
                processing: false,
                error: null,
                streamingMessage: null,
            });

            return { sessions: newSessions };
        });
    },

    // -------------------------------------------------------------------------
    // Streaming Actions
    // -------------------------------------------------------------------------

    setStreamingMessage: (sessionId, message) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                streamingMessage: message,
            });

            return { sessions: newSessions };
        });
    },

    appendToStreamingMessage: (sessionId, content, chunkType = 'text') => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);
            if (!sessionState.streamingMessage) return state;

            const currentMessage = sessionState.streamingMessage;
            let updatedMessage: Message;

            if (chunkType === 'reasoning') {
                // Append to reasoning field
                updatedMessage = {
                    ...currentMessage,
                    reasoning: (currentMessage.reasoning || '') + content,
                };
            } else {
                // Append to content
                const currentContent =
                    typeof currentMessage.content === 'string' ? currentMessage.content : '';
                updatedMessage = {
                    ...currentMessage,
                    content: currentContent + content,
                };
            }

            newSessions.set(sessionId, {
                ...sessionState,
                streamingMessage: updatedMessage,
            });

            return { sessions: newSessions };
        });
    },

    finalizeStreamingMessage: (sessionId, updates = {}) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);
            if (!sessionState.streamingMessage) return state;

            const finalizedMessage: Message = {
                ...sessionState.streamingMessage,
                ...updates,
            };

            // Ensure messages array exists (defensive)
            const existingMessages = sessionState.messages ?? [];

            newSessions.set(sessionId, {
                ...sessionState,
                messages: [...existingMessages, finalizedMessage],
                streamingMessage: null,
            });

            return { sessions: newSessions };
        });
    },

    // -------------------------------------------------------------------------
    // State Actions
    // -------------------------------------------------------------------------

    setProcessing: (sessionId, processing) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                processing,
            });

            return { sessions: newSessions };
        });
    },

    setError: (sessionId, error) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                error,
            });

            return { sessions: newSessions };
        });
    },

    setLoadingHistory: (sessionId, loading) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                loadingHistory: loading,
            });

            return { sessions: newSessions };
        });
    },

    // -------------------------------------------------------------------------
    // Session Actions
    // -------------------------------------------------------------------------

    initSession: (sessionId) => {
        set((state) => {
            if (state.sessions.has(sessionId)) return state;

            const newSessions = new Map(state.sessions);
            newSessions.set(sessionId, { ...defaultSessionState });

            return { sessions: newSessions };
        });
    },

    removeSession: (sessionId) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            newSessions.delete(sessionId);
            return { sessions: newSessions };
        });
    },

    // -------------------------------------------------------------------------
    // Selectors
    // -------------------------------------------------------------------------

    getSessionState: (sessionId) => {
        const state = get().sessions.get(sessionId);
        return state ?? { ...defaultSessionState };
    },

    getMessages: (sessionId) => {
        return get().getSessionState(sessionId).messages;
    },

    getMessage: (sessionId, messageId) => {
        return get()
            .getMessages(sessionId)
            .find((m) => m.id === messageId);
    },

    getMessageByToolCallId: (sessionId, toolCallId) => {
        return get()
            .getMessages(sessionId)
            .find((m) => m.toolCallId === toolCallId);
    },
}));
