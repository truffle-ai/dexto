import { describe, expect, it } from 'vitest';
import { buildDextoBillingUrl } from './billing.js';

describe('buildDextoBillingUrl', () => {
    it('defaults to the dashboard billing settings page', () => {
        expect(buildDextoBillingUrl({})).toBe('https://app.dexto.ai/dashboard/settings/billing');
    });

    it('appends a credits prefill to the billing page url', () => {
        expect(buildDextoBillingUrl({ creditsUsd: 25 })).toBe(
            'https://app.dexto.ai/dashboard/settings/billing?credits_usd=25'
        );
    });

    it('preserves existing query params when adding a credits prefill', () => {
        expect(
            buildDextoBillingUrl({
                baseUrl: 'https://example.com/dashboard/settings/billing?foo=bar',
                creditsUsd: 50,
            })
        ).toBe('https://example.com/dashboard/settings/billing?foo=bar&credits_usd=50');
    });
});
