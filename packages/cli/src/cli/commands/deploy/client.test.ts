import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSandboxBaseUrl } from './client.js';

describe('deploy client', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('uses an explicit sandbox url when configured', () => {
        vi.stubEnv('DEXTO_SANDBOX_URL', 'https://sandbox.preview.dexto.ai/');

        expect(resolveSandboxBaseUrl()).toBe('https://sandbox.preview.dexto.ai');
    });

    it('maps localhost api usage to the local sandbox service', () => {
        vi.stubEnv('DEXTO_API_URL', 'http://localhost:3001');

        expect(resolveSandboxBaseUrl()).toBe('http://localhost:3004');
    });

    it('falls back to the hosted sandbox url', () => {
        expect(resolveSandboxBaseUrl()).toBe('https://sandbox.dexto.ai');
    });
});
