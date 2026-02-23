import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { loginMiniMaxPortalDeviceCode } from './minimax-portal.js';

type MockFetchResponse = {
    ok: boolean;
    status: number;
    statusText: string;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
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

describe('minimax portal oauth (device code)', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        vi.resetAllMocks();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.resetAllMocks();
    });

    it('completes oauth flow and returns tokens', async () => {
        const mockFetch = vi.fn(
            async (input: RequestInfo | URL, init?: RequestInit): Promise<MockFetchResponse> => {
                const url = typeof input === 'string' ? input : input.toString();

                if (url.endsWith('/oauth/code')) {
                    const body = typeof init?.body === 'string' ? init.body : '';
                    const params = new URLSearchParams(body);
                    const state = params.get('state');
                    return okJson({
                        user_code: 'USER-CODE',
                        verification_uri: 'https://example.com/verify',
                        expired_in: Date.now() + 60_000,
                        interval: 1_000,
                        state,
                    });
                }

                if (url.endsWith('/oauth/token')) {
                    return {
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        text: async () =>
                            JSON.stringify({
                                status: 'success',
                                access_token: 'access-token',
                                refresh_token: 'refresh-token',
                                expired_in: 3600,
                                resource_url: 'https://api.minimax.io/anthropic/v1',
                            }),
                    };
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            }
        );

        global.fetch = mockFetch as unknown as typeof fetch;

        const flow = await loginMiniMaxPortalDeviceCode({
            region: 'global',
            clientId: 'client-id',
        });

        expect(flow.userCode).toBe('USER-CODE');
        expect(flow.verificationUrl).toBe('https://example.com/verify');

        const tokens = await flow.callback();
        expect(tokens.accessToken).toBe('access-token');
        expect(tokens.refreshToken).toBe('refresh-token');
        expect(tokens.expiresAt).toBeGreaterThan(Date.now());
        expect(tokens.resourceUrl).toBe('https://api.minimax.io/anthropic/v1');
    });
});
