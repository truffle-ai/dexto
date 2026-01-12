// packages/webui/lib/analytics/index.ts
// Main exports for WebUI analytics library.
//
// Shared types (LLMTokensConsumedEvent, MessageSentEvent, etc.) should be
// imported directly from @dexto/analytics, not re-exported here.

export { AnalyticsProvider, useAnalyticsContext } from './provider.js';
export { useAnalytics } from './hook.js';
export { captureTokenUsage } from './capture.js';

// WebUI-specific types only
export type {
    WebUIAnalyticsEventName,
    WebUIAnalyticsEventPayload,
    WebUIAnalyticsEventMap,
    BaseEventContext,
    SessionSwitchedEvent,
    AgentSwitchedEvent,
    MCPServerConnectedEvent,
    FileUploadedEvent,
    ImageUploadedEvent,
} from './events.js';
