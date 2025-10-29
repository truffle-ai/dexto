// packages/webui/lib/analytics/index.ts
// Main exports for WebUI analytics library.

export { AnalyticsProvider, useAnalyticsContext } from './provider.js';
export { useAnalytics } from './hook.js';
export type {
    WebUIAnalyticsEventName,
    WebUIAnalyticsEventPayload,
    WebUIAnalyticsEventMap,
    BaseEventContext,
    FirstMessageEvent,
    MessageSentEvent,
    SessionSwitchedEvent,
    SessionCreatedEvent,
    ConversationResetEvent,
    AgentSwitchedEvent,
    MCPServerConnectedEvent,
    ToolCalledEvent,
    LLMSwitchedEvent,
    FileUploadedEvent,
    ImageUploadedEvent,
} from './events.js';
