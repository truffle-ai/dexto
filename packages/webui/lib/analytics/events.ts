// packages/webui/lib/analytics/events.ts
// WebUI analytics event definitions for PostHog.
// These events track user activation, retention, and feature usage.
//
// All events use unified names (dexto_*) with a `source` property to
// distinguish CLI vs WebUI. This enables simpler PostHog dashboards.

import type {
    LLMTokensConsumedEvent,
    MessageSentEvent,
    FirstMessageEvent,
    ToolCalledEvent,
    ToolResultEvent,
    SessionCreatedEvent,
    SessionResetEvent,
    LLMSwitchedEvent,
    SessionSwitchedEvent,
    AgentSwitchedEvent,
    MCPServerConnectedEvent,
    FileAttachedEvent,
    ImageAttachedEvent,
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

/**
 * Map of all WebUI analytics events.
 * Use this for type-safe event tracking.
 *
 * All events use unified names (dexto_*) with source: 'webui'.
 * CLI uses the same event names with source: 'cli'.
 */
export interface WebUIAnalyticsEventMap {
    dexto_llm_tokens_consumed: LLMTokensConsumedEvent;
    dexto_message_sent: MessageSentEvent;
    dexto_first_message: FirstMessageEvent;
    dexto_tool_called: ToolCalledEvent;
    dexto_tool_result: ToolResultEvent;
    dexto_session_created: SessionCreatedEvent;
    dexto_session_reset: SessionResetEvent;
    dexto_llm_switched: LLMSwitchedEvent;
    dexto_session_switched: SessionSwitchedEvent;
    dexto_agent_switched: AgentSwitchedEvent;
    dexto_mcp_server_connected: MCPServerConnectedEvent;
    dexto_file_attached: FileAttachedEvent;
    dexto_image_attached: ImageAttachedEvent;
}

export type WebUIAnalyticsEventName = keyof WebUIAnalyticsEventMap;

export type WebUIAnalyticsEventPayload<Name extends WebUIAnalyticsEventName> =
    WebUIAnalyticsEventMap[Name];
