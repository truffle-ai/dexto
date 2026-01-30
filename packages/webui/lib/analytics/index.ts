// Main exports for WebUI analytics library.
//
// All event types should be imported directly from @dexto/analytics.

export { AnalyticsProvider, useAnalyticsContext } from './provider.js';
export { useAnalytics } from './hook.js';
export { captureTokenUsage } from './capture.js';

// WebUI-specific type maps (for type-safe capture)
export type {
    WebUIAnalyticsEventName,
    WebUIAnalyticsEventPayload,
    WebUIAnalyticsEventMap,
    BaseEventContext,
} from './events.js';
