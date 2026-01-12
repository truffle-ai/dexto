// packages/webui/lib/analytics/hook.ts
// Convenience hook for tracking analytics events in WebUI components.
//
// Uses shared event names (dexto_*) with source: 'webui' for unified dashboards.

import { useCallback, useRef } from 'react';
import { useAnalyticsContext } from './provider.js';
import type {
    MessageSentEvent,
    SessionCreatedEvent,
    SessionResetEvent,
    ToolCalledEvent,
    ToolResultEvent,
    LLMSwitchedEvent,
} from '@dexto/analytics';
import type {
    SessionSwitchedEvent,
    AgentSwitchedEvent,
    FileUploadedEvent,
    ImageUploadedEvent,
    MCPServerConnectedEvent,
} from './events.js';

const FIRST_MESSAGE_KEY = 'dexto_first_message_sent';

/**
 * Check if this is the user's first message ever (for activation tracking).
 * Uses localStorage to persist across sessions.
 */
function isFirstMessage(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return !localStorage.getItem(FIRST_MESSAGE_KEY);
    } catch {
        return false;
    }
}

/**
 * Mark that the user has sent their first message.
 */
function markFirstMessageSent(): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(FIRST_MESSAGE_KEY, 'true');
    } catch {
        // Ignore localStorage errors
    }
}

export interface UseAnalyticsReturn {
    capture: ReturnType<typeof useAnalyticsContext>['capture'];
    enabled: boolean;
    isReady: boolean;

    // Convenience tracking methods (source: 'webui' added automatically)
    trackMessageSent: (params: Omit<MessageSentEvent, 'messageCount' | 'source'>) => void;
    trackSessionCreated: (params: Omit<SessionCreatedEvent, 'source'>) => void;
    trackSessionSwitched: (params: SessionSwitchedEvent) => void;
    trackSessionReset: (params: Omit<SessionResetEvent, 'source'>) => void;
    trackAgentSwitched: (params: AgentSwitchedEvent) => void;
    trackToolCalled: (params: Omit<ToolCalledEvent, 'source'>) => void;
    trackToolResult: (params: Omit<ToolResultEvent, 'source'>) => void;
    trackLLMSwitched: (params: Omit<LLMSwitchedEvent, 'source'>) => void;
    trackFileUploaded: (params: FileUploadedEvent) => void;
    trackImageUploaded: (params: ImageUploadedEvent) => void;
    trackMCPServerConnected: (params: MCPServerConnectedEvent) => void;
}

/**
 * Hook for tracking analytics events with convenience methods.
 * Automatically handles first message detection and message counting.
 */
export function useAnalytics(): UseAnalyticsReturn {
    const { capture, enabled, isReady } = useAnalyticsContext();

    // Track message count per session
    const messageCountRef = useRef<Record<string, number>>({});

    const trackMessageSent = useCallback(
        (params: Omit<MessageSentEvent, 'messageCount' | 'source'>) => {
            if (!enabled) return;

            try {
                // Increment message count for this session
                const sessionId = params.sessionId;
                messageCountRef.current[sessionId] = (messageCountRef.current[sessionId] || 0) + 1;

                // Check if this is the user's first message ever
                const isFirst = isFirstMessage();

                if (isFirst) {
                    // Track first message event (critical activation metric)
                    capture('dexto_first_message', {
                        source: 'webui',
                        provider: params.provider,
                        model: params.model,
                        hasImage: params.hasImage,
                        hasFile: params.hasFile,
                        messageLength: params.messageLength,
                    });
                    markFirstMessageSent();
                }

                // Track regular message sent event
                capture('dexto_message_sent', {
                    source: 'webui',
                    ...params,
                    messageCount: messageCountRef.current[sessionId],
                });
            } catch (error) {
                // Analytics should never break the app - fail silently
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    const trackSessionCreated = useCallback(
        (params: Omit<SessionCreatedEvent, 'source'>) => {
            if (!enabled) return;
            try {
                capture('dexto_session_created', { source: 'webui', ...params });
            } catch (error) {
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    const trackSessionSwitched = useCallback(
        (params: SessionSwitchedEvent) => {
            if (!enabled) return;
            try {
                capture('dexto_webui_session_switched', params);
            } catch (error) {
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    const trackSessionReset = useCallback(
        (params: Omit<SessionResetEvent, 'source'>) => {
            if (!enabled) return;
            try {
                // Reset message count for this session
                messageCountRef.current[params.sessionId] = 0;
                capture('dexto_session_reset', { source: 'webui', ...params });
            } catch (error) {
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    const trackAgentSwitched = useCallback(
        (params: AgentSwitchedEvent) => {
            if (!enabled) return;
            try {
                capture('dexto_webui_agent_switched', params);
            } catch (error) {
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    const trackToolCalled = useCallback(
        (params: Omit<ToolCalledEvent, 'source'>) => {
            if (!enabled) return;
            try {
                capture('dexto_tool_called', { source: 'webui', ...params });
            } catch (error) {
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    const trackToolResult = useCallback(
        (params: Omit<ToolResultEvent, 'source'>) => {
            if (!enabled) return;
            try {
                capture('dexto_tool_result', { source: 'webui', ...params });
            } catch (error) {
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    const trackLLMSwitched = useCallback(
        (params: Omit<LLMSwitchedEvent, 'source'>) => {
            if (!enabled) return;
            try {
                capture('dexto_llm_switched', { source: 'webui', ...params });
            } catch (error) {
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    const trackFileUploaded = useCallback(
        (params: FileUploadedEvent) => {
            if (!enabled) return;
            try {
                capture('dexto_webui_file_uploaded', params);
            } catch (error) {
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    const trackImageUploaded = useCallback(
        (params: ImageUploadedEvent) => {
            if (!enabled) return;
            try {
                capture('dexto_webui_image_uploaded', params);
            } catch (error) {
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    const trackMCPServerConnected = useCallback(
        (params: MCPServerConnectedEvent) => {
            if (!enabled) return;
            try {
                capture('dexto_webui_mcp_server_connected', params);
            } catch (error) {
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    return {
        capture,
        enabled,
        isReady,
        trackMessageSent,
        trackSessionCreated,
        trackSessionSwitched,
        trackSessionReset,
        trackAgentSwitched,
        trackToolCalled,
        trackToolResult,
        trackLLMSwitched,
        trackFileUploaded,
        trackImageUploaded,
        trackMCPServerConnected,
    };
}
