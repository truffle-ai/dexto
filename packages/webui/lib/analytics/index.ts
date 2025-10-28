// packages/webui/lib/analytics/index.ts
// Main exports for WebUI analytics library.

export { AnalyticsProvider, useAnalyticsContext } from './provider.js';
export { useAnalytics } from './hook.js';
export type {
    WebUIAnalyticsEventName,
    WebUIAnalyticsEventPayload,
    WebUIAnalyticsEventMap,
    BaseEventContext,
    SessionStartEvent,
    FirstMessageEvent,
    MessageSentEvent,
    SessionSwitchedEvent,
    SessionCreatedEvent,
    ConversationResetEvent,
    MCPServerConnectedEvent,
    ToolCalledEvent,
    LLMSwitchedEvent,
    StreamingToggledEvent,
    FileUploadedEvent,
    ImageUploadedEvent,
    ThemeChangedEvent,
    SettingsOpenedEvent,
    PageViewEvent,
    DailyActiveEvent,
} from './events.js';
