// WebUI analytics event definitions for PostHog.
// These events track user activation, retention, and feature usage.
//
// All events use unified names (dexto_*) with a `source` property to
// distinguish CLI vs WebUI. This enables simpler PostHog dashboards.

import type { SharedAnalyticsEventMap, FileAttachedEvent } from '@dexto/analytics';

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
 * WebUI analytics event map extending shared events with WebUI-specific events.
 *
 * IMPORTANT: If an event is also tracked by CLI, move it to SharedAnalyticsEventMap
 * in @dexto/analytics to avoid duplication.
 */
export interface WebUIAnalyticsEventMap extends SharedAnalyticsEventMap {
    // WebUI-specific events (not supported by CLI)
    dexto_file_attached: FileAttachedEvent;
}

export type WebUIAnalyticsEventName = keyof WebUIAnalyticsEventMap;

export type WebUIAnalyticsEventPayload<Name extends WebUIAnalyticsEventName> =
    WebUIAnalyticsEventMap[Name];
