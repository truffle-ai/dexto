import { afterEach, describe, expect, it, vi } from 'vitest';

describe('auth constants', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('defaults the app control-plane host to app.dexto.ai', async () => {
        delete process.env.DEXTO_PLATFORM_URL;

        const { DEXTO_PLATFORM_URL } = await import('./constants.js');

        expect(DEXTO_PLATFORM_URL).toBe('https://app.dexto.ai');
    });

    it('defaults the gateway host to app.dexto.ai', async () => {
        delete process.env.DEXTO_API_URL;

        const { DEXTO_API_URL } = await import('./constants.js');

        expect(DEXTO_API_URL).toBe('https://app.dexto.ai');
    });

    it('honors DEXTO_PLATFORM_URL overrides', async () => {
        vi.stubEnv('DEXTO_PLATFORM_URL', 'https://platform.preview.dexto.ai');

        const { DEXTO_PLATFORM_URL } = await import('./constants.js');

        expect(DEXTO_PLATFORM_URL).toBe('https://platform.preview.dexto.ai');
    });

    it('defaults the billing url to the dashboard settings route', async () => {
        delete process.env.DEXTO_CREDITS_URL;

        const { DEXTO_CREDITS_URL } = await import('./constants.js');

        expect(DEXTO_CREDITS_URL).toBe('https://app.dexto.ai/dashboard/settings/billing');
    });
});
