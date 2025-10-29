// packages/webui/lib/analytics/events.ts
// WebUI-specific analytics event definitions for PostHog.
// These events track user activation, retention, and feature usage.

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

// Session & Activation Events

export interface FirstMessageEvent {
    // Critical activation metric - first message ever sent by this user
    provider: string;
    model: string;
    hasImage: boolean;
    hasFile: boolean;
    messageLength: number;
}

// User Interaction Events

export interface MessageSentEvent {
    sessionId: string;
    provider: string;
    model: string;
    hasImage: boolean;
    hasFile: boolean;
    messageLength: number;
    messageCount?: number; // Running count of messages in session
}

export interface SessionSwitchedEvent {
    fromSessionId: string | null;
    toSessionId: string;
}

export interface SessionCreatedEvent {
    sessionId: string;
    trigger: 'first_message' | 'manual'; // How was session created?
}

export interface ConversationResetEvent {
    sessionId: string;
    messageCount: number; // How many messages were cleared
}

export interface AgentSwitchedEvent {
    fromAgentId: string | null;
    toAgentId: string;
    toAgentName?: string;
    sessionId?: string;
}

// Feature Usage Events

export interface MCPServerConnectedEvent {
    serverName: string;
    transportType: 'stdio' | 'http' | 'sse';
    toolCount?: number; // Number of tools provided by server
}

export interface ToolCalledEvent {
    toolName: string;
    success: boolean;
    sessionId: string;
    mcpServer?: string; // Which MCP server provided the tool
    durationMs?: number;
}

export interface LLMSwitchedEvent {
    fromProvider: string;
    fromModel: string;
    toProvider: string;
    toModel: string;
    sessionId?: string; // May be null if switching before first message
    trigger: 'user_action' | 'config_change'; // How was switch triggered?
}

export interface StreamingToggledEvent {
    enabled: boolean;
    sessionId?: string;
}

export interface FileUploadedEvent {
    fileType: string; // MIME type
    fileSizeBytes?: number;
    sessionId: string;
}

export interface ImageUploadedEvent {
    imageType: string; // MIME type (image/png, image/jpeg, etc.)
    imageSizeBytes?: number;
    sessionId: string;
}

// Settings & Configuration Events

export interface ThemeChangedEvent {
    theme: 'light' | 'dark';
}

export interface SettingsOpenedEvent {
    section?: string; // Which settings section was opened
}

// Retention & Engagement Events

export interface PageViewEvent {
    path: string;
    title?: string;
}

export interface DailyActiveEvent {
    // Emitted once per day per user (tracked client-side with localStorage)
    date: string; // YYYY-MM-DD
}

/**
 * Map of all WebUI analytics events.
 * Use this for type-safe event tracking.
 */
export interface WebUIAnalyticsEventMap {
    // Session & Activation
    dexto_webui_first_message: FirstMessageEvent;

    // User Interactions
    dexto_webui_message_sent: MessageSentEvent;
    dexto_webui_session_switched: SessionSwitchedEvent;
    dexto_webui_session_created: SessionCreatedEvent;
    dexto_webui_conversation_reset: ConversationResetEvent;
    dexto_webui_agent_switched: AgentSwitchedEvent;

    // Feature Usage
    dexto_webui_mcp_server_connected: MCPServerConnectedEvent;
    dexto_webui_tool_called: ToolCalledEvent;
    dexto_webui_llm_switched: LLMSwitchedEvent;
    dexto_webui_streaming_toggled: StreamingToggledEvent;
    dexto_webui_file_uploaded: FileUploadedEvent;
    dexto_webui_image_uploaded: ImageUploadedEvent;

    // Settings & Configuration
    dexto_webui_theme_changed: ThemeChangedEvent;
    dexto_webui_settings_opened: SettingsOpenedEvent;

    // Retention & Engagement
    dexto_webui_page_view: PageViewEvent;
    dexto_webui_daily_active: DailyActiveEvent;
}

export type WebUIAnalyticsEventName = keyof WebUIAnalyticsEventMap;

export type WebUIAnalyticsEventPayload<Name extends WebUIAnalyticsEventName> =
    WebUIAnalyticsEventMap[Name];
