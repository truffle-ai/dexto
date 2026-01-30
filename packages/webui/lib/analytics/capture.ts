// Non-React capture helpers for use in event handlers.
// These functions work outside of React context (e.g., in handlers.ts).

import posthog from 'posthog-js';
import type { LLMTokensConsumedEvent } from '@dexto/analytics';

/**
 * Check if analytics is enabled by looking for the injected config.
 */
function isAnalyticsEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    return !!(window as any).__DEXTO_ANALYTICS__;
}

/**
 * Get base context properties included with every event.
 */
function getBaseContext() {
    if (typeof window === 'undefined') {
        return { app: 'dexto-webui' };
    }
    const config = (window as any).__DEXTO_ANALYTICS__;
    return {
        app: 'dexto-webui',
        app_version: config?.appVersion ?? 'unknown',
    };
}

/**
 * Capture LLM token usage event.
 * Called from event handlers (non-React context).
 *
 * @param params - Token usage data (source is automatically set to 'webui')
 */
export function captureTokenUsage(params: Omit<LLMTokensConsumedEvent, 'source'>): void {
    if (!isAnalyticsEnabled()) return;

    try {
        posthog.capture('dexto_llm_tokens_consumed', {
            ...getBaseContext(),
            source: 'webui',
            ...params,
        });
    } catch {
        // Analytics should never break the app
    }
}
