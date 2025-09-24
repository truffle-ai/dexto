// packages/cli/src/analytics/constants.ts

// Single source for PostHog configuration.
// Embed your public key here (safe to publish). Host can stay default.
export const DEFAULT_POSTHOG_KEY = 'phc_IJHITHjBKOjDyFiVeilfdumcGniXMuLeXeiLQhYvwDW';
export const DEFAULT_POSTHOG_HOST = 'https://app.posthog.com';

// Single opt-out switch for analytics
export function isAnalyticsDisabled(): boolean {
    const v = process.env.DEXTO_ANALYTICS_DISABLED;
    return typeof v === 'string' && /^(1|true|yes)$/i.test(v);
}
