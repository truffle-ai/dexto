import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCloudAgentDashboardUrl, resolveDashboardBaseUrl } from './links.js';

describe('deploy links', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('uses an explicit dashboard url when configured', () => {
        vi.stubEnv('DEXTO_APP_URL', 'https://preview.dexto.ai/');
        vi.stubEnv('DEXTO_SANDBOX_URL', 'http://localhost:3004');

        expect(resolveDashboardBaseUrl()).toBe('https://preview.dexto.ai');
        expect(getCloudAgentDashboardUrl('sbx_test')).toBe(
            'https://preview.dexto.ai/dashboard/cloud-agents/sbx_test'
        );
    });

    it('maps local sandbox deployments to the local dashboard', () => {
        vi.stubEnv('DEXTO_SANDBOX_URL', 'http://localhost:3004');

        expect(resolveDashboardBaseUrl()).toBe('http://localhost:5173');
    });

    it('maps api subdomains to app subdomains', () => {
        vi.stubEnv('DEXTO_API_URL', 'https://api.preview.dexto.ai');

        expect(resolveDashboardBaseUrl()).toBe('https://app.preview.dexto.ai');
    });

    it('falls back to the production app url', () => {
        expect(resolveDashboardBaseUrl()).toBe('https://app.dexto.ai');
    });
});
