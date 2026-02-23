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
import { useChat, Message, UIUserMessage, UIAssistantMessage, UIToolMessage } from './useChat';
import { useApproval } from './ApprovalContext';
import { usePendingApprovals } from './useApprovals';
import type { FilePart, ImagePart, TextPart, UIResourcePart } from '../../types';
import type { SanitizedToolResult, ApprovalRequest } from '@dexto/core';
import { getResourceKind } from '@dexto/core';
import { useAnalytics } from '@/lib/analytics/index.js';
import { queryKeys } from '@/lib/queryKeys.js';
import { client } from '@/lib/client.js';
import { useMutation } from '@tanstack/react-query';
import {
    useAgentStore,
    useSessionStore,
    useChatStore,
    useCurrentSessionId,
    useIsWelcomeState,
    useSessionMessages,
} from '@/lib/stores/index.js';

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
    reset: () => void;
    switchSession: (sessionId: string) => void;
    loadSessionHistory: (sessionId: string) => Promise<void>;
    returnToWelcome: () => void;
    cancel: (sessionId?: string) => void;
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
        const createdAt = msg.timestamp ?? Date.now() - (history.length - index) * 1000;
        const baseId = `session-${sessionId}-${index}`;

        // Skip system messages - they're not shown in UI
        if (msg.role === 'system') {
            continue;
        }

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
            // Create assistant message
            if (msg.content) {
                // Extract text content from string or ContentPart array
                let textContent: string | null = null;
                if (typeof msg.content === 'string') {
                    textContent = msg.content;
                } else if (Array.isArray(msg.content)) {
                    // Extract text from ContentPart array
                    const textParts = (msg.content as unknown[])
                        .filter((part: unknown): part is TextPart => {
                            if (typeof part !== 'object' || part === null) return false;
                            const maybe = part as { type?: unknown; text?: unknown };
                            return maybe.type === 'text' && typeof maybe.text === 'string';
                        })
                        .map((part) => part.text);
                    textContent = textParts.length > 0 ? textParts.join('\n') : null;
                }

                const assistantMessage: UIAssistantMessage = {
                    id: baseId,
                    role: 'assistant',
                    content: textContent,
                    createdAt,
                    sessionId,
                    tokenUsage: msg.tokenUsage,
                    reasoning: msg.reasoning,
                    model: msg.model,
                    provider: msg.provider,
                };
                uiMessages.push(assistantMessage);
            }

            // Create tool messages for tool calls
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

                    const toolMessage: UIToolMessage = {
                        id: `${baseId}-tool-${toolIndex}`,
                        role: 'tool',
                        content: null,
                        createdAt: createdAt + toolIndex,
                        sessionId,
                        toolName,
                        toolArgs,
                        toolCallId: toolCall.id,
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
            // Extract success status from stored message (defaults to true for backwards compatibility)
            const success =
                'success' in msg && typeof msg.success === 'boolean' ? msg.success : true;
            const sanitizedFromHistory: SanitizedToolResult = {
                content: normalizedContent,
                ...(inferredResources ? { resources: inferredResources } : {}),
                meta: {
                    toolName,
                    toolCallId: toolCallId ?? `tool-${index}`,
                    success,
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
                // Update existing tool message with result
                const messageIndex = pendingToolCalls.get(toolCallId)!;
                const existingMessage = uiMessages[messageIndex] as UIToolMessage;
                uiMessages[messageIndex] = {
                    ...existingMessage,
                    toolResult: sanitizedFromHistory,
                    toolResultMeta: sanitizedFromHistory.meta,
                    toolResultSuccess: sanitizedFromHistory.meta?.success,
                    ...(requireApproval !== undefined && { requireApproval }),
                    ...(approvalStatus !== undefined && { approvalStatus }),
                };
            } else {
                // Create new tool message with result
                const toolMessage: UIToolMessage = {
                    id: baseId,
                    role: 'tool',
                    content: null,
                    createdAt,
                    sessionId,
                    toolName,
                    toolCallId,
                    toolResult: sanitizedFromHistory,
                    toolResultMeta: sanitizedFromHistory.meta,
                    toolResultSuccess: sanitizedFromHistory.meta?.success,
                    ...(requireApproval !== undefined && { requireApproval }),
                    ...(approvalStatus !== undefined && { approvalStatus }),
                };
                uiMessages.push(toolMessage);
            }

            continue;
        }

        // User message (only remaining case after system/assistant/tool handled)
        if (msg.role === 'user') {
            const userMessage: UIUserMessage = {
                id: baseId,
                role: 'user',
                content: msg.content,
                createdAt,
                sessionId,
            };
            uiMessages.push(userMessage);
        }
    }

    // Mark any tool calls that never received results as failed (incomplete)
    // This happens when a run was interrupted or crashed before tool completion
    for (const [_callId, messageIndex] of pendingToolCalls) {
        const msg = uiMessages[messageIndex];
        if (msg && msg.role === 'tool' && msg.toolResult === undefined) {
            uiMessages[messageIndex] = {
                ...msg,
                toolResultSuccess: false, // Mark as failed so UI doesn't show "running"
            };
        }
    }

    return uiMessages;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
    const navigate = useNavigate();
    const analytics = useAnalytics();
    const queryClient = useQueryClient();

    // Get state from stores using centralized selectors
    const currentSessionId = useCurrentSessionId();
    const isWelcomeState = useIsWelcomeState();

    // Local state for UI flow control only (not shared/persisted state)
    const [isSwitchingSession, setIsSwitchingSession] = useState(false); // Guard against rapid session switches
    const [isCreatingSession, setIsCreatingSession] = useState(false); // Guard against double auto-creation
    const lastSwitchedSessionRef = useRef<string | null>(null); // Track last switched session to prevent duplicate switches
    const newSessionWithMessageRef = useRef<string | null>(null); // Track new sessions that already have first message sent
    const currentSessionIdRef = useRef<string | null>(null); // Synchronous session ID (updates before React state to prevent race conditions)

    // Session abort controllers for cancellation
    const sessionAbortControllersRef = useRef<Map<string, AbortController>>(new Map());

    // useChat hook manages abort controllers internally
    const {
        sendMessage: originalSendMessage,
        reset: originalReset,
        cancel,
    } = useChat(currentSessionIdRef, sessionAbortControllersRef);

    // Restore pending approvals when session changes (e.g., after page refresh)
    const { handleApprovalRequest } = useApproval();
    const { data: pendingApprovalsData } = usePendingApprovals(currentSessionId);
    const restoredApprovalsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!pendingApprovalsData?.approvals || pendingApprovalsData.approvals.length === 0) {
            return;
        }

        // Restore any pending approvals that haven't been restored yet
        for (const approval of pendingApprovalsData.approvals) {
            // Skip if we've already restored this approval
            if (restoredApprovalsRef.current.has(approval.approvalId)) {
                continue;
            }

            // Mark as restored before calling handler to prevent duplicates
            restoredApprovalsRef.current.add(approval.approvalId);

            // Convert API response format to ApprovalRequest format
            // TODO: The API returns a simplified format without full metadata because
            // ApprovalCoordinator only tracks approval IDs, not the full request data.
            // To fix properly: store full ApprovalRequest in ApprovalCoordinator when
            // requests are created, then return that data from GET /api/approvals.
            handleApprovalRequest({
                approvalId: approval.approvalId,
                type: approval.type,
                sessionId: approval.sessionId,
                timeout: approval.timeout,
                timestamp: new Date(approval.timestamp),
                metadata: approval.metadata,
            } as ApprovalRequest);
        }
    }, [pendingApprovalsData, handleApprovalRequest]);

    // Clear restored approvals tracking when session changes
    useEffect(() => {
        restoredApprovalsRef.current.clear();
    }, [currentSessionId]);

    // Messages from centralized selector (stable reference, handles null session)
    const messages = useSessionMessages(currentSessionId);

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
                    originalSendMessage(content, imageData, fileData, sessionId);

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
                originalSendMessage(content, imageData, fileData, sessionId);
            }

            // Track message sent
            if (sessionId) {
                analytics.trackMessageSent({
                    sessionId,
                    provider: 'unknown', // Provider/model tracking moved to component level
                    model: 'unknown',
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
            navigate,
            analytics,
            generateTitle,
        ]
    );

    // Enhanced reset with session support
    const reset = useCallback(() => {
        if (currentSessionId) {
            // Track conversation reset
            const messageCount = messages.filter((m) => m.sessionId === currentSessionId).length;
            analytics.trackSessionReset({
                sessionId: currentSessionId,
                messageCount,
            });

            originalReset(currentSessionId);
        }
    }, [originalReset, currentSessionId, analytics, messages]);

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
            const currentMessages = useChatStore.getState().getMessages(currentSessionId);
            const hasSessionMsgs = currentMessages.some((m) => m.sessionId === currentSessionId);
            if (!hasSessionMsgs) {
                useChatStore
                    .getState()
                    .setMessages(currentSessionId, sessionHistoryData.messages as any);
            }
            // Cancel any active run on page refresh (we can't reconnect to the stream)
            if (sessionHistoryData.isBusy) {
                // Reset agent state since we're cancelling - we won't receive run:complete event
                useAgentStore.getState().setIdle();
                client.api.sessions[':sessionId'].cancel
                    .$post({
                        param: { sessionId: currentSessionId },
                        json: { clearQueue: true },
                    })
                    .catch((e) => console.warn('Failed to cancel busy session:', e));
            }
        }
    }, [sessionHistoryData, currentSessionId]);

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

                const currentMessages = useChatStore.getState().getMessages(sessionId);
                const hasSessionMsgs = currentMessages.some((m) => m.sessionId === sessionId);
                if (!hasSessionMsgs) {
                    // Populate chatStore with history (cast to compatible type)
                    useChatStore.getState().initFromHistory(sessionId, result.messages as any);
                }

                // Cancel any active run on page refresh (we can't reconnect to the stream)
                // This ensures clean state - user can see history and send new messages
                // TODO: Implement stream reconnection instead of cancelling
                // - Add GET /sessions/{sessionId}/events SSE endpoint for listen-only mode
                // - Connect to event stream when isBusy=true to resume receiving updates
                if (result.isBusy) {
                    // Reset agent state since we're cancelling - we won't receive run:complete event
                    useAgentStore.getState().setIdle();
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
                useChatStore.getState().clearMessages(sessionId);
            }
        },
        [queryClient]
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

                // Update ref BEFORE store to prevent race conditions with streaming
                currentSessionIdRef.current = sessionId;

                // Update store (single source of truth)
                useSessionStore.getState().setCurrentSession(sessionId);

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
        lastSwitchedSessionRef.current = null; // Clear to allow switching to same session again

        // Update store (single source of truth)
        useSessionStore.getState().returnToWelcome();
    }, []);

    return (
        <ChatContext.Provider
            value={{
                messages,
                sendMessage,
                reset,
                switchSession,
                loadSessionHistory,
                returnToWelcome,
                cancel,
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
