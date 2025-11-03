'use client';

import React, { createContext, useContext, ReactNode, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useChat, Message, ErrorMessage } from './useChat';
import { useGreeting } from './useGreeting';
import type { FilePart, ImagePart, SanitizedToolResult, TextPart } from '@dexto/core';
import { getResourceKind } from '@dexto/core';
import { useAnalytics } from '@/lib/analytics/index.js';
import { queryKeys } from '@/lib/queryKeys.js';

interface ChatContextType {
  messages: Message[];
  sendMessage: (
    content: string,
    imageData?: { base64: string; mimeType: string },
    fileData?: { base64: string; mimeType: string; filename?: string }
  ) => void;
  status: 'connecting' | 'open' | 'closed';
  reset: () => void;
  currentSessionId: string | null;
  switchSession: (sessionId: string) => void;
  loadSessionHistory: (sessionId: string) => Promise<void>;
  // Active LLM config for the current session (UI source of truth)
  currentLLM: { provider: string; model: string; displayName?: string; router?: string; baseURL?: string } | null;
  refreshCurrentLLM: () => Promise<void>;
  isWelcomeState: boolean;
  returnToWelcome: () => void;
  isStreaming: boolean;
  setStreaming: (streaming: boolean) => void;
  websocket: WebSocket | null;
  processing: boolean;
  cancel: (sessionId?: string) => void;
  // Error state
  activeError: ErrorMessage | null;
  clearError: () => void;
  // Greeting state
  greeting: string | null;
}

import { getWsUrl, getApiUrl } from '@/lib/api-url';

// Helper function to convert session history API response to UI messages
function convertHistoryToMessages(history: any[], sessionId: string): Message[] {
  const uiMessages: Message[] = [];
  const pendingToolCalls = new Map<string, number>();
  
  for (let index = 0; index < history.length; index++) {
    const msg: any = history[index];
    const baseMessage = {
      id: `session-${sessionId}-${index}`,
      role: msg.role,
      content: msg.content,
      createdAt: Date.now() - (history.length - index) * 1000, // Approximate timestamps
      sessionId: sessionId,
      // Preserve token usage, reasoning, model, and router metadata from storage
      tokenUsage: msg.tokenUsage,
      reasoning: msg.reasoning,
      model: msg.model,
      router: msg.router,
      provider: msg.provider,
    };

    const deriveResources = (
      content: Array<TextPart | ImagePart | FilePart>
    ): SanitizedToolResult['resources'] => {
      const resources: NonNullable<SanitizedToolResult['resources']> = [];

      for (const part of content) {
        if (part.type === 'image' && typeof part.image === 'string' && part.image.startsWith('@blob:')) {
          const uri = part.image.substring(1);
          resources.push({
            uri,
            kind: 'image',
            mimeType: part.mimeType ?? 'image/jpeg',
          });
        }

        if (part.type === 'file' && typeof part.data === 'string' && part.data.startsWith('@blob:')) {
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
        msg.toolCalls.forEach((toolCall: any, toolIndex: number) => {
          let toolArgs: Record<string, unknown> = {};
          if (toolCall?.function) {
            try {
              toolArgs = JSON.parse(toolCall.function.arguments || '{}');
            } catch (e) {
              console.warn(`Failed to parse toolCall arguments for ${toolCall.function?.name || 'unknown'}: ${e}`);
              toolArgs = {};
            }
          }
          const toolName = toolCall.function?.name || 'unknown';

          const toolMessage: Message = {
            id: `session-${sessionId}-${index}-tool-${toolIndex}`,
            role: 'tool',
            content: null,
            createdAt: Date.now() - (history.length - index) * 1000 + toolIndex,
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
      const normalizedContent: Array<TextPart | ImagePart | FilePart> = Array.isArray(msg.content)
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
          ...(typeof msg.success === 'boolean' ? { success: msg.success } : {}),
        },
      };

      if (toolCallId && pendingToolCalls.has(toolCallId)) {
        const messageIndex = pendingToolCalls.get(toolCallId)!;
        uiMessages[messageIndex] = {
          ...uiMessages[messageIndex],
          toolResult: sanitizedFromHistory,
          toolResultMeta: sanitizedFromHistory.meta,
          toolResultSuccess: typeof msg.success === 'boolean' ? msg.success : undefined,
        };
      } else {
        uiMessages.push({
          ...baseMessage,
          role: 'tool',
          content: null,
          toolName,
          toolArgs: typeof msg.args === 'object' ? msg.args : undefined,
          toolResult: sanitizedFromHistory,
          toolResultMeta: sanitizedFromHistory.meta,
          toolResultSuccess: typeof msg.success === 'boolean' ? msg.success : undefined,
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
  const router = useRouter();
  const analytics = useAnalytics();
  const queryClient = useQueryClient();

  // Calculate WebSocket URL at runtime based on frontend port
  const wsUrl = getWsUrl();

  // Start with no session - pure welcome state
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isWelcomeState, setIsWelcomeState] = useState(true);
  const [isStreaming, setIsStreaming] = useState(true); // Default to streaming enabled
  const [isSwitchingSession, setIsSwitchingSession] = useState(false); // Guard against rapid session switches
  const [isCreatingSession, setIsCreatingSession] = useState(false); // Guard against double auto-creation
  const { messages, sendMessage: originalSendMessage, status, reset: originalReset, setMessages, websocket, activeError, clearError, processing, cancel } = useChat(wsUrl, () => currentSessionId);

  // Fetch current LLM config using TanStack Query
  const {
    data: currentLLMData,
    refetch: refetchCurrentLLM,
  } = useQuery<{ provider: string; model: string; displayName?: string; router?: string; baseURL?: string }, Error>({
    queryKey: queryKeys.llm.current(currentSessionId),
    queryFn: async () => {
      const url = currentSessionId 
        ? `${getApiUrl()}/api/llm/current?sessionId=${currentSessionId}` 
        : `${getApiUrl()}/api/llm/current`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch LLM config: ${res.status}`);
      }
      const data = await res.json();
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

  // Auto-create session on first message with random UUID
  const createAutoSession = useCallback(async (): Promise<string> => {
    const response = await fetch(`${getApiUrl()}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // Let server generate random UUID
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status} ${response.statusText}`);
    }

    const responseText = await response.text();
    if (!responseText.trim()) {
      throw new Error('Empty response from session creation');
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse session creation response:', parseError);
      throw new Error('Invalid response from session creation');
    }

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
  const sendMessage = useCallback(async (
    content: string,
    imageData?: { base64: string; mimeType: string },
    fileData?: { base64: string; mimeType: string; filename?: string }
  ) => {
    let sessionId = currentSessionId;

    // Auto-create session on first message and wait for it to complete
    if (!sessionId && isWelcomeState) {
      if (isCreatingSession) return; // Another send in-flight; drop duplicate request
      try {
        setIsCreatingSession(true);
        sessionId = await createAutoSession();

        // Update state before sending message
        setCurrentSessionId(sessionId);
        setIsWelcomeState(false);

        // Navigate using Next.js router to properly handle client-side routing
        router.replace(`/chat/${sessionId}`);

        // Note: currentLLM will automatically refetch when currentSessionId changes
      } catch (error) {
        console.error('Failed to create session:', error);
        return; // Don't send message if session creation fails
      } finally {
        setIsCreatingSession(false);
      }
    }

    // Only send after session is confirmed ready
    if (sessionId) {
      originalSendMessage(content, imageData, fileData, sessionId, isStreaming);

      // Track message sent
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
  }, [originalSendMessage, currentSessionId, isWelcomeState, isCreatingSession, createAutoSession, isStreaming, router, analytics, currentLLM]);

  // Enhanced reset with session support
  const reset = useCallback(() => {
    if (currentSessionId) {
      // Track conversation reset
      const messageCount = messages.filter(m => m.sessionId === currentSessionId).length;
      analytics.trackConversationReset({
        sessionId: currentSessionId,
        messageCount,
      });

      originalReset(currentSessionId);
    }
  }, [originalReset, currentSessionId, analytics, messages]);

  // Load session history when switching sessions
  const {
    data: sessionHistoryData,
    refetch: refetchSessionHistory,
  } = useQuery<Message[], Error>({
    queryKey: queryKeys.sessions.history(currentSessionId || ''),
    queryFn: async () => {
      if (!currentSessionId) {
        return [];
      }
      const response = await fetch(`${getApiUrl()}/api/sessions/${currentSessionId}/history`);
      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error('Failed to load session history');
      }
      
      const responseText = await response.text();
      if (!responseText.trim()) {
        return [];
      }
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse session history response:', parseError);
        throw new Error('Invalid session history response');
      }
      
      const history = data.history || [];
      return convertHistoryToMessages(history, currentSessionId);
    },
    enabled: false, // Manual refetch only
    retry: false,
  });

  // Sync session history data to messages when it changes
  useEffect(() => {
    if (sessionHistoryData && currentSessionId) {
      setMessages((prev) => {
        const hasSessionMsgs = prev.some((m) => m.sessionId === currentSessionId);
        return hasSessionMsgs ? prev : sessionHistoryData;
      });
    }
  }, [sessionHistoryData, currentSessionId, setMessages]);

  const loadSessionHistory = useCallback(async (sessionId: string) => {
    try {
      const result = await queryClient.fetchQuery<Message[], Error>({
        queryKey: queryKeys.sessions.history(sessionId),
        queryFn: async () => {
          const response = await fetch(`${getApiUrl()}/api/sessions/${sessionId}/history`);
          if (!response.ok) {
            if (response.status === 404) {
              return [];
            }
            throw new Error('Failed to load session history');
          }
          
          const responseText = await response.text();
          if (!responseText.trim()) {
            return [];
          }
          
          let data;
          try {
            data = JSON.parse(responseText);
          } catch (parseError) {
            console.error('Failed to parse session history response:', parseError);
            throw new Error('Invalid session history response');
          }
          
          const history = data.history || [];
          return convertHistoryToMessages(history, sessionId);
        },
        retry: false,
      });

      setMessages((prev) => {
        const hasSessionMsgs = prev.some((m) => m.sessionId === sessionId);
        return hasSessionMsgs ? prev : result;
      });
    } catch (error) {
      console.error('Error loading session history:', error);
      setMessages([]);
    }
  }, [setMessages, queryClient]);

  // Switch to a different session and load it on the backend
  const switchSession = useCallback(async (sessionId: string) => {
    // Guard against switching to same session or rapid successive switches
    if (sessionId === currentSessionId || isSwitchingSession) {
      return;
    }
    setIsSwitchingSession(true);
    try {
      // Track session switch
      analytics.trackSessionSwitched({
        fromSessionId: currentSessionId,
        toSessionId: sessionId,
      });

      setCurrentSessionId(sessionId);
      setIsWelcomeState(false); // No longer in welcome state
      await loadSessionHistory(sessionId);
      // Note: currentLLM will automatically refetch when currentSessionId changes via useQuery
    } catch (error) {
      console.error('Error switching session:', error);
      throw error; // Re-throw so UI can handle the error
    } finally {
      // Always reset the switching flag, even if error occurs
      setIsSwitchingSession(false);
    }
  }, [currentSessionId, isSwitchingSession, loadSessionHistory, analytics, queryClient]);


  // Return to welcome state (no active session)
  const returnToWelcome = useCallback(() => {
    setCurrentSessionId(null);
    setIsWelcomeState(true);
    setMessages([]);
    // Note: currentLLM will automatically refetch when currentSessionId changes to null
  }, [setMessages]);

  // Listen for config-related WebSocket events via DOM events
  useEffect(() => {
    const handleConfigChange = (event: any) => {
      // Attempt to update current LLM from event if payload includes it
      const detail = event?.detail || {};
      if (detail.config?.llm) {
        const llm = detail.config.llm;
        queryClient.setQueryData(queryKeys.llm.current(currentSessionId), {
          provider: llm.provider,
          model: llm.model,
          router: llm.router,
          baseURL: llm.baseURL,
        });
      }
    };

    const handleServersChange = (event: any) => {
      console.log('Servers changed:', event.detail);
      // Here you could trigger UI updates, but for now just log
    };

    const handleSessionReset = (event: any) => {
      const { sessionId } = event.detail || {};
      if (sessionId === currentSessionId) {
        setMessages([]);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('dexto:configChanged', handleConfigChange);
      window.addEventListener('dexto:serversChanged', handleServersChange);
      window.addEventListener('dexto:conversationReset', handleSessionReset);
      
      return () => {
        window.removeEventListener('dexto:configChanged', handleConfigChange);
        window.removeEventListener('dexto:serversChanged', handleServersChange);
        window.removeEventListener('dexto:conversationReset', handleSessionReset);
      };
    }
  }, [currentSessionId, setMessages]);

  return (
    <ChatContext.Provider value={{ 
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
      websocket,
      currentLLM,
      refreshCurrentLLM: refetchCurrentLLM,
      processing,
      cancel,
      // Error state
      activeError,
      clearError,
      // Greeting state
      greeting
    }}>
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
