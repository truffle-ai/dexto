// packages/cli/src/analytics/constants.ts

// Single source for PostHog configuration.
// Embed your public key here (safe to publish). Host can stay default.
export const DEFAULT_POSTHOG_KEY = 'phc_IJHITHjBKOjDyFiVeilfdumcGniXMuLeXeiLQhYvwDW';
export const DEFAULT_POSTHOG_HOST = 'https://app.posthog.com';

/**
 * Single opt-out switch for analytics.
 *
 * Usage:
 *   DEXTO_ANALYTICS_DISABLED=1 dexto ...
 *
 * When set to a truthy value ("1", "true", "yes"), analytics are fully disabled.
 */
export function isAnalyticsDisabled(): boolean {
    const v = process.env.DEXTO_ANALYTICS_DISABLED;
    return typeof v === 'string' && /^(1|true|yes)$/i.test(v);
}

/**
 * Generic per-command timeout (in milliseconds) used by the analytics wrapper.
 *
 * This does NOT terminate the command. It emits a non-terminating timeout
 * event when the duration threshold is crossed to help diagnose long runs.
 */
export const COMMAND_TIMEOUT_MS = 600000; // 10 minutes
