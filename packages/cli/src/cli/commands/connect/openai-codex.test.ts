import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { loginOpenAiCodexDeviceCode } from './openai-codex.js';

type MockFetchResponse = {
    ok: boolean;
    status: number;
    statusText: string;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
};

function okJson(data: unknown): MockFetchResponse {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

describe('openai codex oauth (device code)', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        vi.resetAllMocks();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.resetAllMocks();
    });

    it('completes device-code flow and returns tokens', async () => {
        const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();

            if (url.endsWith('/api/accounts/deviceauth/usercode')) {
                return okJson({
                    device_auth_id: 'device-auth-id',
                    user_code: 'ABCD-EFGH',
                    interval: '1',
                });
            }

            if (url.endsWith('/api/accounts/deviceauth/token')) {
                return okJson({
                    authorization_code: 'auth-code',
                    code_verifier: 'code-verifier',
                });
            }

            if (url.endsWith('/oauth/token')) {
                return okJson({
                    access_token: 'access-token',
                    refresh_token: 'refresh-token',
                    expires_in: 3600,
                });
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        global.fetch = mockFetch as unknown as typeof fetch;

        const flow = await loginOpenAiCodexDeviceCode({
            clientId: 'client-id',
            userAgent: 'dexto-test',
        });

        expect(flow.deviceUrl).toContain('auth.openai.com');
        expect(flow.userCode).toBe('ABCD-EFGH');

        const tokens = await flow.callback();
        expect(tokens.accessToken).toBe('access-token');
        expect(tokens.refreshToken).toBe('refresh-token');
        expect(tokens.expiresInSec).toBe(3600);
    });
});
