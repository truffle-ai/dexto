import React, {
    createContext,
    useContext,
    ReactNode,
    useEffect,
    useState,
    useCallback,
    useRef,
} from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useChat, Message, ErrorMessage, StreamStatus } from './useChat';
import { useGreeting } from './useGreeting';
import type { FilePart, ImagePart, TextPart, UIResourcePart } from '../../types';
import type { SanitizedToolResult } from '@dexto/core';
import { getResourceKind } from '@dexto/core';
import { useAnalytics } from '@/lib/analytics/index.js';
import { queryKeys } from '@/lib/queryKeys.js';
import { client } from '@/lib/client.js';
import { useMutation } from '@tanstack/react-query';

// Helper to get history endpoint type (workaround for string literal path)
type HistoryEndpoint = (typeof client.api.sessions)[':sessionId']['history'];

// Derive history message type from Hono client response (server schema is source of truth)
type HistoryResponse = Awaited<ReturnType<HistoryEndpoint['$get']>>;
type HistoryData = Awaited<ReturnType<Extract<HistoryResponse, { ok: true }>['json']>>;
type HistoryMessage = HistoryData['history'][number];

// Derive toolCall type from HistoryMessage
type ToolCall = NonNullable<HistoryMessage['toolCalls']>[number];

interface ChatContextType {
    messages: Message[];
    sendMessage: (
        content: string,
        imageData?: { image: string; mimeType: string },
        fileData?: { data: string; mimeType: string; filename?: string }
    ) => void;
    status: StreamStatus;
    reset: () => void;
    currentSessionId: string | null;
    switchSession: (sessionId: string) => void;
    loadSessionHistory: (sessionId: string) => Promise<void>;
    // Active LLM config for the current session (UI source of truth)
    currentLLM: {
        provider: string;
        model: string;
        displayName?: string;
        router?: string;
        baseURL?: string;
    } | null;
    refreshCurrentLLM: () => Promise<void>;
    isWelcomeState: boolean;
    returnToWelcome: () => void;
    isStreaming: boolean;
    setStreaming: (streaming: boolean) => void;
    processing: boolean;
    cancel: (sessionId?: string) => void;
    // Error state
    activeError: ErrorMessage | null;
    clearError: () => void;
    // Greeting state
    greeting: string | null;
}

// Helper function to fetch and convert session history to UI messages
async function fetchSessionHistory(
    sessionId: string
): Promise<{ messages: Message[]; isBusy: boolean }> {
    const response = await client.api.sessions[':sessionId'].history.$get({
        param: { sessionId },
    });
    if (!response.ok) {
        throw new Error('Failed to fetch session history');
    }
    const data = await response.json();
    const history = data.history || [];
    return {
        messages: convertHistoryToMessages(history, sessionId),
        isBusy: data.isBusy ?? false,
    };
}

// Helper function to convert session history API response to UI messages
function convertHistoryToMessages(history: HistoryMessage[], sessionId: string): Message[] {
    const uiMessages: Message[] = [];
    const pendingToolCalls = new Map<string, number>();

    for (let index = 0; index < history.length; index++) {
        const msg = history[index];
        const baseMessage: Message = {
            id: `session-${sessionId}-${index}`,
            role: msg.role,
            content: msg.content,
            createdAt: msg.timestamp ?? Date.now() - (history.length - index) * 1000,
            sessionId: sessionId,
            // Preserve token usage, reasoning, model, and router metadata from storage
            tokenUsage: msg.tokenUsage,
            reasoning: msg.reasoning,
            model: msg.model,
            router: msg.router,
            provider: msg.provider,
        };

        const deriveResources = (
            content: Array<TextPart | ImagePart | FilePart | UIResourcePart>
        ): SanitizedToolResult['resources'] => {
            const resources: NonNullable<SanitizedToolResult['resources']> = [];

            for (const part of content) {
                if (
                    part.type === 'image' &&
                    typeof part.image === 'string' &&
                    part.image.startsWith('@blob:')
                ) {
                    const uri = part.image.substring(1);
                    resources.push({
                        uri,
                        kind: 'image',
                        mimeType: part.mimeType ?? 'image/jpeg',
                    });
                }

                if (
                    part.type === 'file' &&
                    typeof part.data === 'string' &&
                    part.data.startsWith('@blob:')
                ) {
                    const uri = part.data.substring(1);
                    const mimeType = part.mimeType ?? 'application/octet-stream';
                    const kind = getResourceKind(mimeType);

                    resources.push({
                        uri,
                        kind,
                        mimeType,
                        ...(part.filename ? { filename: part.filename } : {}),
                    });
                }
            }

            return resources.length > 0 ? resources : undefined;
        };

        if (msg.role === 'assistant') {
            if (msg.content) {
                uiMessages.push(baseMessage);
            }

            if (msg.toolCalls && msg.toolCalls.length > 0) {
                msg.toolCalls.forEach((toolCall: ToolCall, toolIndex: number) => {
                    let toolArgs: Record<string, unknown> = {};
                    if (toolCall?.function) {
                        try {
                            toolArgs = JSON.parse(toolCall.function.arguments || '{}');
                        } catch (e) {
                            console.warn(
                                `Failed to parse toolCall arguments for ${toolCall.function?.name || 'unknown'}: ${e}`
                            );
                            toolArgs = {};
                        }
                    }
                    const toolName = toolCall.function?.name || 'unknown';

                    const toolMessage: Message = {
                        id: `session-${sessionId}-${index}-tool-${toolIndex}`,
                        role: 'tool',
                        content: null,
                        createdAt:
                            (msg.timestamp ?? Date.now() - (history.length - index) * 1000) +
                            toolIndex,
                        sessionId,
                        toolName,
                        toolArgs,
                        toolResult: undefined,
                        toolResultMeta: undefined,
                        toolResultSuccess: undefined,
                    };

                    if (typeof toolCall.id === 'string' && toolCall.id.length > 0) {
                        pendingToolCalls.set(toolCall.id, uiMessages.length);
                    }

                    uiMessages.push(toolMessage);
                });
            }

            continue;
        }

        if (msg.role === 'tool') {
            const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined;
            const toolName = typeof msg.name === 'string' ? msg.name : 'unknown';
            const normalizedContent: Array<TextPart | ImagePart | FilePart> = Array.isArray(
                msg.content
            )
                ? (msg.content as Array<TextPart | ImagePart | FilePart>)
                : typeof msg.content === 'string'
                  ? [{ type: 'text', text: msg.content }]
                  : [];

            const inferredResources = deriveResources(normalizedContent);
            const sanitizedFromHistory: SanitizedToolResult = {
                content: normalizedContent,
                ...(inferredResources ? { resources: inferredResources } : {}),
                meta: {
                    toolName,
                    toolCallId: toolCallId ?? `tool-${index}`,
                },
            };

            // Extract approval metadata if present (type-safe with optional chaining)
            const requireApproval: boolean | undefined =
                'requireApproval' in msg && typeof msg.requireApproval === 'boolean'
                    ? msg.requireApproval
                    : undefined;
            const approvalStatus: 'pending' | 'approved' | 'rejected' | undefined =
                'approvalStatus' in msg &&
                (msg.approvalStatus === 'pending' ||
                    msg.approvalStatus === 'approved' ||
                    msg.approvalStatus === 'rejected')
                    ? msg.approvalStatus
                    : undefined;

            if (toolCallId && pendingToolCalls.has(toolCallId)) {
                const messageIndex = pendingToolCalls.get(toolCallId)!;
                uiMessages[messageIndex] = {
                    ...uiMessages[messageIndex],
                    toolResult: sanitizedFromHistory,
                    toolResultMeta: sanitizedFromHistory.meta,
                    // Preserve approval metadata from history
                    ...(requireApproval !== undefined && { requireApproval }),
                    ...(approvalStatus !== undefined && { approvalStatus }),
                };
            } else {
                uiMessages.push({
                    ...baseMessage,
                    role: 'tool',
                    content: null,
                    toolName,
                    toolResult: sanitizedFromHistory,
                    toolResultMeta: sanitizedFromHistory.meta,
                    // Preserve approval metadata from history
                    ...(requireApproval !== undefined && { requireApproval }),
                    ...(approvalStatus !== undefined && { approvalStatus }),
                });
            }

            continue;
        }

        uiMessages.push(baseMessage);
    }

    return uiMessages;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
    const navigate = useNavigate();
    const analytics = useAnalytics();
    const queryClient = useQueryClient();

    // Start with no session - pure welcome state
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [isWelcomeState, setIsWelcomeState] = useState(true);
    const [isStreaming, setIsStreaming] = useState(true); // Default to streaming enabled
    const [isSwitchingSession, setIsSwitchingSession] = useState(false); // Guard against rapid session switches
    const [isCreatingSession, setIsCreatingSession] = useState(false); // Guard against double auto-creation
    const lastSwitchedSessionRef = useRef<string | null>(null); // Track last switched session to prevent duplicate switches
    const newSessionWithMessageRef = useRef<string | null>(null); // Track new sessions that already have first message sent
    const currentSessionIdRef = useRef<string | null>(null); // Synchronous session ID (updates before React state to prevent race conditions)

    // Session-scoped state (survives navigation)
    const [sessionErrors, setSessionErrors] = useState<Map<string, ErrorMessage>>(new Map());
    const [processingSessions, setProcessingSessions] = useState<Set<string>>(new Set());
    const [sessionStatuses, setSessionStatuses] = useState<Map<string, StreamStatus>>(new Map());
    const sessionAbortControllersRef = useRef<Map<string, AbortController>>(new Map());

    // Helper functions for session-scoped state
    const setSessionError = useCallback((sessionId: string, error: ErrorMessage | null) => {
        setSessionErrors((prev) => {
            const next = new Map(prev);
            if (error) {
                next.set(sessionId, error);
            } else {
                next.delete(sessionId);
            }
            return next;
        });
    }, []);

    const setSessionProcessing = useCallback((sessionId: string, isProcessing: boolean) => {
        setProcessingSessions((prev) => {
            const next = new Set(prev);
            if (isProcessing) {
                next.add(sessionId);
            } else {
                next.delete(sessionId);
            }
            return next;
        });
    }, []);

    const setSessionStatus = useCallback((sessionId: string, status: StreamStatus) => {
        setSessionStatuses((prev) => {
            const next = new Map(prev);
            next.set(sessionId, status);
            return next;
        });
    }, []);

    const getSessionAbortController = useCallback((sessionId: string): AbortController => {
        const existing = sessionAbortControllersRef.current.get(sessionId);
        if (existing) {
            return existing;
        }
        const controller = new AbortController();
        sessionAbortControllersRef.current.set(sessionId, controller);
        return controller;
    }, []);

    const abortSession = useCallback((sessionId: string) => {
        const controller = sessionAbortControllersRef.current.get(sessionId);
        if (controller) {
            controller.abort();
            sessionAbortControllersRef.current.delete(sessionId);
        }
    }, []);

    // Get current session's state
    const activeError = currentSessionId ? sessionErrors.get(currentSessionId) || null : null;
    const processing = currentSessionId ? processingSessions.has(currentSessionId) : false;
    const status = currentSessionId ? sessionStatuses.get(currentSessionId) || 'idle' : 'idle';

    const {
        messages,
        sendMessage: originalSendMessage,
        reset: originalReset,
        setMessages,
        cancel,
    } = useChat(currentSessionIdRef, {
        setSessionError,
        setSessionProcessing,
        setSessionStatus,
        getSessionAbortController,
        abortSession,
    });

    // Fetch current LLM config using TanStack Query
    const { data: currentLLMData, refetch: refetchCurrentLLM } = useQuery({
        queryKey: queryKeys.llm.current(currentSessionId),
        queryFn: async () => {
            const response = await client.api.llm.current.$get({
                query: currentSessionId ? { sessionId: currentSessionId } : {},
            });
            if (!response.ok) {
                throw new Error('Failed to fetch current LLM config');
            }
            const data = await response.json();
            const cfg = data.config || data;
            return {
                provider: cfg.provider,
                model: cfg.model,
                displayName: cfg.displayName,
                router: cfg.router,
                baseURL: cfg.baseURL,
            };
        },
        enabled: true, // Always fetch when sessionId changes
        retry: false, // Don't retry on error - UI can still operate
    });

    const currentLLM = currentLLMData ?? null;

    // Get greeting from API
    const { greeting } = useGreeting(currentSessionId);

    // Mutation for generating session title
    const { mutate: generateTitle } = useMutation({
        mutationFn: async (sessionId: string) => {
            const response = await client.api.sessions[':sessionId']['generate-title'].$post({
                param: { sessionId },
            });
            if (!response.ok) {
                throw new Error('Failed to generate title');
            }
            const data = await response.json();
            return data.title;
        },
        onSuccess: (_title, sessionId) => {
            // Invalidate sessions query to show the new title
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
            // Also invalidate the specific session query if needed
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(sessionId) });
        },
    });

    // Auto-create session on first message with random UUID
    const createAutoSession = useCallback(async (): Promise<string> => {
        const response = await client.api.sessions.$post({
            json: {}, // Let server generate random UUID
        });

        if (!response.ok) {
            throw new Error('Failed to create session');
        }

        const data = await response.json();

        if (!data.session?.id) {
            throw new Error('Session ID not found in server response');
        }

        const sessionId = data.session.id;

        // Track session creation
        analytics.trackSessionCreated({
            sessionId,
            trigger: 'first_message',
        });

        return sessionId;
    }, [analytics]);

    // Enhanced sendMessage with auto-session creation
    const sendMessage = useCallback(
        async (
            content: string,
            imageData?: { image: string; mimeType: string },
            fileData?: { data: string; mimeType: string; filename?: string }
        ) => {
            let sessionId = currentSessionId;
            let isNewSession = false;

            // Auto-create session on first message and wait for it to complete
            if (!sessionId && isWelcomeState) {
                if (isCreatingSession) return; // Another send in-flight; drop duplicate request
                try {
                    setIsCreatingSession(true);
                    sessionId = await createAutoSession();
                    isNewSession = true;

                    // Mark this session as a new session before navigation
                    // This allows switchSession to run but skip history load
                    newSessionWithMessageRef.current = sessionId;

                    // Update ref BEFORE streaming to prevent race conditions
                    currentSessionIdRef.current = sessionId;

                    // Send message BEFORE navigating
                    originalSendMessage(content, imageData, fileData, sessionId, isStreaming);

                    // Navigate - this will trigger switchSession via ChatApp useEffect
                    navigate({ to: `/chat/${sessionId}`, replace: true });

                    // Generate title for newly created session after first message
                    // Use setTimeout to delay title generation until message is complete
                    setTimeout(() => {
                        if (sessionId) generateTitle(sessionId);
                    }, 0);

                    // Note: currentLLM will automatically refetch when currentSessionId changes
                } catch (error) {
                    console.error('Failed to create session:', error);
                    return; // Don't send message if session creation fails
                } finally {
                    setIsCreatingSession(false);
                }
            }

            // Only send if we're using an existing session (not a newly created one)
            if (sessionId && !isNewSession) {
                originalSendMessage(content, imageData, fileData, sessionId, isStreaming);
            }

            // Track message sent
            if (sessionId) {
                const provider = currentLLM?.provider || 'unknown';
                const model = currentLLM?.model || 'unknown';
                analytics.trackMessageSent({
                    sessionId,
                    provider,
                    model,
                    hasImage: !!imageData,
                    hasFile: !!fileData,
                    messageLength: content.length,
                });
            } else {
                console.error('No session available for sending message');
            }
        },
        [
            originalSendMessage,
            currentSessionId,
            isWelcomeState,
            isCreatingSession,
            createAutoSession,
            isStreaming,
            navigate,
            analytics,
            currentLLM,
            generateTitle,
        ]
    );

    // Enhanced reset with session support
    const reset = useCallback(() => {
        if (currentSessionId) {
            // Track conversation reset
            const messageCount = messages.filter((m) => m.sessionId === currentSessionId).length;
            analytics.trackConversationReset({
                sessionId: currentSessionId,
                messageCount,
            });

            originalReset(currentSessionId);
        }
    }, [originalReset, currentSessionId, analytics, messages]);

    // Clear error for current session
    const clearError = useCallback(() => {
        if (currentSessionId) {
            setSessionError(currentSessionId, null);
        }
    }, [currentSessionId, setSessionError]);

    // Load session history when switching sessions
    const { data: sessionHistoryData } = useQuery({
        queryKey: queryKeys.sessions.history(currentSessionId || ''),
        queryFn: async () => {
            if (!currentSessionId) {
                return { messages: [], isBusy: false };
            }
            try {
                return await fetchSessionHistory(currentSessionId);
            } catch {
                // Return empty result for 404 or other errors
                return { messages: [], isBusy: false };
            }
        },
        enabled: false, // Manual refetch only
        retry: false,
    });

    // Sync session history data to messages when it changes
    useEffect(() => {
        if (sessionHistoryData && currentSessionId) {
            setMessages((prev) => {
                const hasSessionMsgs = prev.some((m) => m.sessionId === currentSessionId);
                return hasSessionMsgs ? prev : sessionHistoryData.messages;
            });
            // Cancel any active run on page refresh (we can't reconnect to the stream)
            if (sessionHistoryData.isBusy) {
                client.api.sessions[':sessionId'].cancel
                    .$post({
                        param: { sessionId: currentSessionId },
                        json: { clearQueue: true },
                    })
                    .catch((e) => console.warn('Failed to cancel busy session:', e));
            }
        }
    }, [sessionHistoryData, currentSessionId, setMessages]);

    const loadSessionHistory = useCallback(
        async (sessionId: string) => {
            try {
                const result = await queryClient.fetchQuery({
                    queryKey: queryKeys.sessions.history(sessionId),
                    queryFn: async () => {
                        try {
                            return await fetchSessionHistory(sessionId);
                        } catch {
                            // Return empty result for 404 or other errors
                            return { messages: [], isBusy: false };
                        }
                    },
                    retry: false,
                });

                setMessages((prev) => {
                    const hasSessionMsgs = prev.some((m) => m.sessionId === sessionId);
                    return hasSessionMsgs ? prev : result.messages;
                });

                // Cancel any active run on page refresh (we can't reconnect to the stream)
                // This ensures clean state - user can see history and send new messages
                // TODO: Implement stream reconnection instead of cancelling
                // - Add GET /sessions/{sessionId}/events SSE endpoint for listen-only mode
                // - Connect to event stream when isBusy=true to resume receiving updates
                if (result.isBusy) {
                    try {
                        await client.api.sessions[':sessionId'].cancel.$post({
                            param: { sessionId },
                            json: { clearQueue: true }, // Hard cancel - clear queue too
                        });
                    } catch (e) {
                        console.warn('Failed to cancel busy session on load:', e);
                    }
                }
            } catch (error) {
                console.error('Error loading session history:', error);
                setMessages([]);
            }
        },
        [setMessages, queryClient]
    );

    // Switch to a different session and load it on the backend
    const switchSession = useCallback(
        async (sessionId: string) => {
            // Guard against switching to same session or rapid successive switches
            // Use ref for immediate check (state updates are async)
            if (
                sessionId === currentSessionId ||
                sessionId === lastSwitchedSessionRef.current ||
                isSwitchingSession
            ) {
                return;
            }

            setIsSwitchingSession(true);
            try {
                // Track session switch (defensive - analytics failures shouldn't block switching)
                try {
                    analytics.trackSessionSwitched({
                        fromSessionId: currentSessionId,
                        toSessionId: sessionId,
                    });
                } catch (analyticsError) {
                    console.error('Failed to track session switch:', analyticsError);
                }

                // Skip history load for newly created sessions with first message already sent
                // This prevents replacing message IDs and breaking error anchoring
                // TODO: Long-term fix - backend should generate and persist message IDs
                // so history reload doesn't cause ID mismatches
                const skipHistoryLoad = newSessionWithMessageRef.current === sessionId;
                if (skipHistoryLoad) {
                    // Clear the ref after using it once
                    newSessionWithMessageRef.current = null;
                }

                // Update ref BEFORE state to prevent race conditions with streaming
                currentSessionIdRef.current = sessionId;
                setCurrentSessionId(sessionId);
                setIsWelcomeState(false); // No longer in welcome state

                // Mark this session as being switched to after state update succeeds
                lastSwitchedSessionRef.current = sessionId;

                if (!skipHistoryLoad) {
                    await loadSessionHistory(sessionId);
                }
                // Note: currentLLM will automatically refetch when currentSessionId changes via useQuery
            } catch (error) {
                console.error('Error switching session:', error);
                throw error; // Re-throw so UI can handle the error
            } finally {
                // Always reset the switching flag, even if error occurs
                setIsSwitchingSession(false);
            }
        },
        [currentSessionId, isSwitchingSession, loadSessionHistory, analytics]
    );

    // Return to welcome state (no active session)
    const returnToWelcome = useCallback(() => {
        currentSessionIdRef.current = null;
        setCurrentSessionId(null);
        setIsWelcomeState(true);
        setMessages([]);
    }, [setMessages]);

    return (
        <ChatContext.Provider
            value={{
                messages,
                sendMessage,
                status,
                reset,
                currentSessionId,
                switchSession,
                loadSessionHistory,
                isWelcomeState,
                returnToWelcome,
                isStreaming,
                setStreaming: setIsStreaming,
                currentLLM,
                refreshCurrentLLM: async () => {
                    await refetchCurrentLLM();
                },
                processing,
                cancel,
                // Error state
                activeError,
                clearError,
                // Greeting state
                greeting,
            }}
        >
            {children}
        </ChatContext.Provider>
    );
}

export function useChatContext(): ChatContextType {
    const context = useContext(ChatContext);
    if (!context) {
        throw new Error('useChatContext must be used within a ChatProvider');
    }
    return context;
}
