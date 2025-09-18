'use client';

import React, { createContext, useContext, ReactNode, useEffect, useState, useCallback } from 'react';
import { useChat, Message, ErrorMessage } from './useChat';
import { useGreeting } from './useGreeting';

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
  // Determine WebSocket URL; replace localhost for network access
  
  // for express in production code, the default is picked up because process.env.NEXT_PUBLIC_WS_URL is set at build time for client side components, not at runtime
  // let wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

  // for hono in production code, same but add /ws to the end
  let wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';
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
      
      const data = await response.json();
      return data.session.id;
    } catch (error) {
      console.error('Error creating auto session:', error);
      // Fallback to a simple timestamp-based session ID
      return `chat-${Date.now()}`;
    }
  }, []);

  // Enhanced sendMessage with auto-session creation
  const sendMessage = useCallback(async (
    content: string,
    imageData?: { base64: string; mimeType: string },
    fileData?: { base64: string; mimeType: string; filename?: string }
  ) => {
    let sessionId = currentSessionId;
    
    // Auto-create session on first message
    if (!sessionId && isWelcomeState) {
      sessionId = await createAutoSession();
      
      setCurrentSessionId(sessionId);
      setIsWelcomeState(false);

      // Prime currentLLM for this session to avoid UI flicker
      await fetchCurrentLLM(sessionId);
    }
    
    if (sessionId) {
      originalSendMessage(content, imageData, fileData, sessionId, isStreaming);
    } else {
      console.error('No session available for sending message');
    }
  }, [originalSendMessage, currentSessionId, isWelcomeState, createAutoSession, isStreaming]);

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
      
      const data = await response.json();
      const history = data.history || [];
      
      // Convert API history to UI messages
      const uiMessages: Message[] = [];
      
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

        if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
          // Handle assistant messages with tool calls
          // First add the assistant message (if it has content)
          if (msg.content) {
            uiMessages.push(baseMessage);
          }
          
          // Then add tool call messages for each tool call
          msg.toolCalls.forEach((toolCall: any, toolIndex: number) => {
            const toolArgs = toolCall.function ? JSON.parse(toolCall.function.arguments || '{}') : {};
            const toolName = toolCall.function?.name || 'unknown';
            
            // Look for corresponding tool result in subsequent messages
            let toolResult = undefined;
            for (let j = index + 1; j < history.length; j++) {
              const nextMsg = history[j];
              if (nextMsg.role === 'tool' && nextMsg.toolCallId === toolCall.id) {
                toolResult = nextMsg.content;
                break;
              }
            }
            
            uiMessages.push({
              id: `session-${sessionId}-${index}-tool-${toolIndex}`,
              role: 'tool' as const,
              content: null,
              createdAt: Date.now() - (history.length - index) * 1000 + toolIndex,
              sessionId: sessionId,
              toolName: toolName,
              toolArgs: toolArgs,
              toolResult: toolResult,
            });
          });
        } else if (msg.role === 'tool') {
          // Skip standalone tool messages as they're handled above with their corresponding tool calls
          continue;
        } else {
          // Handle regular messages (user, system, assistant without tool calls)
          uiMessages.push(baseMessage);
        }
      }
      
      setMessages(uiMessages);
    } catch (error) {
      console.error('Error loading session history:', error);
      // On error, just clear messages and continue
      setMessages([]);
    }
  }, [setMessages, fetchCurrentLLM]);

  // Switch to a different session and load it on the backend
  const switchSession = useCallback(async (sessionId: string) => {
    if (sessionId === currentSessionId) return;
    
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
    }
  }, [currentSessionId, loadSessionHistory]);

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
