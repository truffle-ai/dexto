'use client';

import React, { createContext, useContext, ReactNode, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useChat, Message, ErrorMessage } from './useChat';
import { useGreeting } from './useGreeting';
import type { FilePart, ImagePart, SanitizedToolResult, TextPart } from '@dexto/core';
import { getResourceKind } from '@dexto/core';

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
  refreshCurrentLLM: (sessionId?: string | null) => Promise<void>;
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

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  // Determine WebSocket URL; replace localhost for network access
  let wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
  if (typeof window !== 'undefined') {
    try {
      const urlObj = new URL(wsUrl);
      if (urlObj.hostname === 'localhost') {
        urlObj.hostname = window.location.hostname;
        wsUrl = urlObj.toString();
      }
    } catch (e) {
      console.warn('Invalid WS URL:', wsUrl);
    }
  }

  // Start with no session - pure welcome state
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isWelcomeState, setIsWelcomeState] = useState(true);
  const [isStreaming, setIsStreaming] = useState(true); // Default to streaming enabled
  const [isSwitchingSession, setIsSwitchingSession] = useState(false); // Guard against rapid session switches
  const { messages, sendMessage: originalSendMessage, status, reset: originalReset, setMessages, websocket, activeError, clearError, processing, cancel } = useChat(wsUrl, () => currentSessionId);
  const [currentLLM, setCurrentLLM] = useState<{ provider: string; model: string; displayName?: string; router?: string; baseURL?: string } | null>(null);

  // Helper to fetch current LLM (session-scoped if applicable)
  const fetchCurrentLLM = useCallback(async (sessionIdOverride?: string | null) => {
    try {
      const targetSessionId = sessionIdOverride !== undefined ? sessionIdOverride : currentSessionId;
      const url = targetSessionId ? `/api/llm/current?sessionId=${targetSessionId}` : '/api/llm/current';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const cfg = data.config || data;
        setCurrentLLM({
          provider: cfg.provider,
          model: cfg.model,
          displayName: cfg.displayName,
          router: cfg.router,
          baseURL: cfg.baseURL,
        });
      }
    } catch {
      // ignore fetch errors here; UI can still operate
    }
  }, [currentSessionId]);

  // On initial mount (welcome state), fetch default LLM to populate UI label
  useEffect(() => {
    if (!currentLLM) {
      void fetchCurrentLLM();
    }
  }, [currentLLM, fetchCurrentLLM]);

  
  // Get greeting from API
  const { greeting } = useGreeting(currentSessionId);

  // Auto-create session on first message with random UUID
  const createAutoSession = useCallback(async (): Promise<string> => {
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // Let server generate random UUID
      });

      if (!response.ok) {
        throw new Error('Failed to create session');
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

      return data.session.id;
    } catch (error) {
      console.error('Error creating auto session:', error);
      // Fallback to client-generated session ID
      // Note: Server will auto-create this session on first message (lazy creation in DextoAgent.run)
      const fallbackId = `chat-${Date.now()}`;
      console.warn(`Using client-generated session ID as fallback: ${fallbackId}`);
      return fallbackId;
    }
  }, []);

  // Enhanced sendMessage with auto-session creation
  const sendMessage = useCallback(async (
    content: string,
    imageData?: { base64: string; mimeType: string },
    fileData?: { base64: string; mimeType: string; filename?: string }
  ) => {
    let sessionId = currentSessionId;

    // Auto-create session on first message and wait for it to complete
    if (!sessionId && isWelcomeState) {
      try {
        sessionId = await createAutoSession();

        // Update state before sending message
        setCurrentSessionId(sessionId);
        setIsWelcomeState(false);

        // Navigate using Next.js router to properly handle client-side routing
        router.replace(`/chat/${sessionId}`);

        // Prime currentLLM for this session to avoid UI flicker
        await fetchCurrentLLM(sessionId);
      } catch (error) {
        console.error('Failed to create session:', error);
        return; // Don't send message if session creation fails
      }
    }

    // Only send after session is confirmed ready
    if (sessionId) {
      originalSendMessage(content, imageData, fileData, sessionId, isStreaming);
    } else {
      console.error('No session available for sending message');
    }
  }, [originalSendMessage, currentSessionId, isWelcomeState, createAutoSession, isStreaming, fetchCurrentLLM, router]);

  // Enhanced reset with session support
  const reset = useCallback(() => {
    if (currentSessionId) {
      originalReset(currentSessionId);
    }
  }, [originalReset, currentSessionId]);

  // Load session history when switching sessions
  const loadSessionHistory = useCallback(async (sessionId: string) => {

    try {
      const response = await fetch(`/api/sessions/${sessionId}/history`);
      if (!response.ok) {
        if (response.status === 404) {
          // Session doesn't exist, create it
          const createResponse = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });
          if (!createResponse.ok) {
            throw new Error('Failed to create session');
          }
          // New session has no history
          setMessages([]);
          return;
        }
        throw new Error('Failed to load session history');
      }
      
      const responseText = await response.text();
      if (!responseText.trim()) {
        // Empty response, keep any in-flight messages for this session
        setMessages((prev) => {
          const hasSessionMsgs = prev.some((m) => m.sessionId === sessionId);
          return hasSessionMsgs ? prev : [];
        });
        return;
      }
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse session history response:', parseError);
        setMessages([]);
        return;
      }
      
      const history = data.history || [];
      
      // Convert API history to UI messages
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
              const toolArgs = toolCall.function ? JSON.parse(toolCall.function.arguments || '{}') : {};
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

      setMessages((prev) => {
        const hasSessionMsgs = prev.some((m) => m.sessionId === sessionId);
        return hasSessionMsgs ? prev : uiMessages;
      });
    } catch (error) {
      console.error('Error loading session history:', error);
      // On error, just clear messages and continue
      setMessages([]);
    }
  }, [setMessages, fetchCurrentLLM]);

  // Switch to a different session and load it on the backend
  const switchSession = useCallback(async (sessionId: string) => {
    // Guard against switching to same session or rapid successive switches
    if (sessionId === currentSessionId || isSwitchingSession) {
      return;
    }
    setIsSwitchingSession(true);
    try {
      setCurrentSessionId(sessionId);
      setIsWelcomeState(false); // No longer in welcome state
      await loadSessionHistory(sessionId);
      // After switching sessions, simply hydrate UI from the server's
      // authoritative per-session LLM config (no client-side switching)
      await fetchCurrentLLM(sessionId);
    } catch (error) {
      console.error('Error switching session:', error);
      throw error; // Re-throw so UI can handle the error
    } finally {
      // Always reset the switching flag, even if error occurs
      setIsSwitchingSession(false);
    }
  }, [currentSessionId, isSwitchingSession, loadSessionHistory, fetchCurrentLLM]);


  // Return to welcome state (no active session)
  const returnToWelcome = useCallback(() => {
    setCurrentSessionId(null);
    setIsWelcomeState(true);
    setMessages([]);
    setCurrentLLM(null);
  }, [setMessages]);

  // Listen for config-related WebSocket events via DOM events
  useEffect(() => {
    const handleConfigChange = (event: any) => {
      // Attempt to update current LLM from event if payload includes it
      const detail = event?.detail || {};
      if (detail.config?.llm) {
        const llm = detail.config.llm;
        setCurrentLLM({ provider: llm.provider, model: llm.model, router: llm.router, baseURL: llm.baseURL });
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
      refreshCurrentLLM: fetchCurrentLLM,
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
