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
    SessionSwitchedEvent,
    AgentSwitchedEvent,
    FileAttachedEvent,
    ImageAttachedEvent,
    MCPServerConnectedEvent,
} from '@dexto/analytics';

export interface UseAnalyticsReturn {
    capture: ReturnType<typeof useAnalyticsContext>['capture'];
    enabled: boolean;
    isReady: boolean;

    // Convenience tracking methods (source: 'webui' added automatically)
    trackMessageSent: (params: Omit<MessageSentEvent, 'messageCount' | 'source'>) => void;
    trackSessionCreated: (params: Omit<SessionCreatedEvent, 'source'>) => void;
    trackSessionSwitched: (params: Omit<SessionSwitchedEvent, 'source'>) => void;
    trackSessionReset: (params: Omit<SessionResetEvent, 'source'>) => void;
    trackAgentSwitched: (params: Omit<AgentSwitchedEvent, 'source'>) => void;
    trackToolCalled: (params: Omit<ToolCalledEvent, 'source'>) => void;
    trackToolResult: (params: Omit<ToolResultEvent, 'source'>) => void;
    trackLLMSwitched: (params: Omit<LLMSwitchedEvent, 'source'>) => void;
    trackFileAttached: (params: Omit<FileAttachedEvent, 'source'>) => void;
    trackImageAttached: (params: Omit<ImageAttachedEvent, 'source'>) => void;
    trackMCPServerConnected: (params: Omit<MCPServerConnectedEvent, 'source'>) => void;
}

/**
 * Hook for tracking analytics events with convenience methods.
 * Automatically handles message counting per session.
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
        (params: Omit<SessionSwitchedEvent, 'source'>) => {
            if (!enabled) return;
            try {
                capture('dexto_session_switched', { source: 'webui', ...params });
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
        (params: Omit<AgentSwitchedEvent, 'source'>) => {
            if (!enabled) return;
            try {
                capture('dexto_agent_switched', { source: 'webui', ...params });
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

    const trackFileAttached = useCallback(
        (params: Omit<FileAttachedEvent, 'source'>) => {
            if (!enabled) return;
            try {
                capture('dexto_file_attached', { source: 'webui', ...params });
            } catch (error) {
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    const trackImageAttached = useCallback(
        (params: Omit<ImageAttachedEvent, 'source'>) => {
            if (!enabled) return;
            try {
                capture('dexto_image_attached', { source: 'webui', ...params });
            } catch (error) {
                console.warn('Analytics tracking failed:', error);
            }
        },
        [capture, enabled]
    );

    const trackMCPServerConnected = useCallback(
        (params: Omit<MCPServerConnectedEvent, 'source'>) => {
            if (!enabled) return;
            try {
                capture('dexto_mcp_server_connected', { source: 'webui', ...params });
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
        trackFileAttached,
        trackImageAttached,
        trackMCPServerConnected,
    };
}
