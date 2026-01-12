// packages/webui/lib/analytics/events.ts
// WebUI-specific analytics event definitions for PostHog.
// These events track user activation, retention, and feature usage.
//
// Shared events are imported from @dexto/analytics - they use single event names
// with a `source` property to distinguish CLI vs WebUI.

import type {
    LLMTokensConsumedEvent,
    MessageSentEvent as SharedMessageSentEvent,
    FirstMessageEvent as SharedFirstMessageEvent,
    ToolCalledEvent as SharedToolCalledEvent,
    ToolResultEvent,
    SessionCreatedEvent as SharedSessionCreatedEvent,
    SessionResetEvent,
    LLMSwitchedEvent as SharedLLMSwitchedEvent,
} from '@dexto/analytics';

/**
 * Base context automatically included with every WebUI event.
 * Populated by the AnalyticsProvider.
 */
export interface BaseEventContext {
    app?: 'dexto-webui';
    app_version?: string;
    browser?: string;
    browser_version?: string;
    os?: string;
    screen_width?: number;
    screen_height?: number;
    session_id?: string;
}

// WebUI-specific events (no CLI equivalent)

export interface SessionSwitchedEvent {
    fromSessionId: string | null;
    toSessionId: string;
}

export interface AgentSwitchedEvent {
    fromAgentId: string | null;
    toAgentId: string;
    toAgentName?: string;
    sessionId?: string;
}

export interface MCPServerConnectedEvent {
    serverName: string;
    transportType: 'stdio' | 'http' | 'sse';
    toolCount?: number;
}

export interface FileUploadedEvent {
    fileType: string;
    fileSizeBytes?: number;
    sessionId: string;
}

export interface ImageUploadedEvent {
    imageType: string;
    imageSizeBytes?: number;
    sessionId: string;
}

/**
 * Map of all WebUI analytics events.
 * Use this for type-safe event tracking.
 *
 * BREAKING CHANGE: Shared events now use unified names (dexto_*) instead of
 * dexto_webui_* prefixes. This enables simpler PostHog dashboards where
 * all platforms use the same event name with a `source` property.
 */
export interface WebUIAnalyticsEventMap {
    // Shared events (same names as CLI, with source: 'webui')
    dexto_llm_tokens_consumed: LLMTokensConsumedEvent;
    dexto_message_sent: SharedMessageSentEvent;
    dexto_first_message: SharedFirstMessageEvent;
    dexto_tool_called: SharedToolCalledEvent;
    dexto_tool_result: ToolResultEvent;
    dexto_session_created: SharedSessionCreatedEvent;
    dexto_session_reset: SessionResetEvent;
    dexto_llm_switched: SharedLLMSwitchedEvent;

    // WebUI-specific events (no CLI equivalent)
    dexto_webui_session_switched: SessionSwitchedEvent;
    dexto_webui_agent_switched: AgentSwitchedEvent;
    dexto_webui_mcp_server_connected: MCPServerConnectedEvent;
    dexto_webui_file_uploaded: FileUploadedEvent;
    dexto_webui_image_uploaded: ImageUploadedEvent;
}

export type WebUIAnalyticsEventName = keyof WebUIAnalyticsEventMap;

export type WebUIAnalyticsEventPayload<Name extends WebUIAnalyticsEventName> =
    WebUIAnalyticsEventMap[Name];
