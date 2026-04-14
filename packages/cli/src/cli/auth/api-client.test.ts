import { afterEach, describe, expect, it, vi } from 'vitest';
import { DextoApiClient } from './api-client.js';

function createJsonResponse(body: unknown, status: number = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
        },
    });
}

describe('DextoApiClient', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('validates API keys against the platform validate endpoint', async () => {
        const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ valid: true }));
        vi.stubGlobal('fetch', fetchMock);

        const client = new DextoApiClient({
            gatewayBaseUrl: 'http://gateway.local',
            platformBaseUrl: 'http://platform.local',
        });

        const result = await client.validateDextoApiKey('dxt_test');

        expect(result).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://platform.local/api/keys/validate',
            expect.objectContaining({
                method: 'GET',
                headers: {
                    Authorization: 'Bearer dxt_test',
                },
            })
        );
    });

    it('uses the overridden base URL for control-plane endpoints when provided as a string', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(createJsonResponse({ valid: true }))
            .mockResolvedValueOnce(
                createJsonResponse({
                    credits_usd: 42,
                    mtd_usage: {
                        total_cost_usd: 1.5,
                        total_requests: 12,
                        by_model: {},
                    },
                    recent: [],
                })
            );
        vi.stubGlobal('fetch', fetchMock);

        const client = new DextoApiClient('http://gateway.local');

        await client.validateDextoApiKey('dxt_test');
        await client.getUsageSummary('dxt_test');

        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            'http://gateway.local/api/keys/validate',
            expect.objectContaining({ method: 'GET' })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            'http://gateway.local/api/account/usage',
            expect.objectContaining({ method: 'GET' })
        );
    });

    it('fetches billing balance with JWT auth', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            createJsonResponse({
                credits_usd: 17.5,
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        const client = new DextoApiClient({
            platformBaseUrl: 'http://platform.local',
        });

        const result = await client.getBillingBalance('jwt-token', {});

        expect(result).toEqual({ creditsUsd: 17.5 });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://platform.local/api/billing/balance',
            expect.objectContaining({
                method: 'GET',
                headers: {
                    Authorization: 'Bearer jwt-token',
                },
            })
        );
    });

    it('creates billing checkout sessions with JWT auth', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            createJsonResponse({
                checkout_url: 'https://checkout.example/abc',
                checkout_session_id: 'chk_123',
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        const client = new DextoApiClient({
            platformBaseUrl: 'http://platform.local',
        });

        const result = await client.createBillingCheckoutSession('jwt-token', {
            creditsUsd: 25,
            returnUrl: 'https://app.dexto.ai/dashboard/billing',
        });

        expect(result).toEqual({
            checkoutUrl: 'https://checkout.example/abc',
            checkoutSessionId: 'chk_123',
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://platform.local/api/billing/checkout-session',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    Authorization: 'Bearer jwt-token',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    credits_usd: 25,
                    return_url: 'https://app.dexto.ai/dashboard/billing',
                }),
            })
        );
    });

    it('rejects invalid checkout amounts before calling the billing API', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const client = new DextoApiClient({
            platformBaseUrl: 'http://platform.local',
        });

        await expect(
            client.createBillingCheckoutSession('jwt-token', {
                creditsUsd: 0,
            })
        ).rejects.toThrow('creditsUsd must be a positive number');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rotates an existing CLI key to guarantee returning a key value', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                createJsonResponse({
                    success: true,
                    data: [
                        {
                            id: 'key-1',
                            name: 'Dexto CLI Key',
                            status: 'active',
                            isActive: true,
                        },
                    ],
                })
            )
            .mockResolvedValueOnce(createJsonResponse({ success: true }))
            .mockResolvedValueOnce(
                createJsonResponse({
                    success: true,
                    data: {
                        id: 'key-2',
                        fullKey: 'dxt_new_key',
                    },
                })
            );
        vi.stubGlobal('fetch', fetchMock);

        const client = new DextoApiClient({
            gatewayBaseUrl: 'http://gateway.local',
            platformBaseUrl: 'http://platform.local',
        });

        const result = await client.provisionDextoApiKey('auth-token', 'Dexto CLI Key', true);

        expect(result).toEqual({
            dextoApiKey: 'dxt_new_key',
            keyId: 'key-2',
        });
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            'http://platform.local/api/keys',
            expect.objectContaining({ method: 'GET' })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            'http://platform.local/api/keys/key-1',
            expect.objectContaining({ method: 'DELETE' })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            'http://platform.local/api/keys',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    Authorization: 'Bearer auth-token',
                    'Content-Type': 'application/json',
                },
            })
        );
    });

    it('rotates existing key metadata even when regenerate is false', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                createJsonResponse({
                    success: true,
                    data: [
                        {
                            id: 'key-1',
                            name: 'Dexto CLI Key',
                            status: 'active',
                            isActive: true,
                        },
                    ],
                })
            )
            .mockResolvedValueOnce(createJsonResponse({ success: true }))
            .mockResolvedValueOnce(
                createJsonResponse({
                    success: true,
                    data: {
                        id: 'key-2',
                        fullKey: 'dxt_new_key',
                    },
                })
            );
        vi.stubGlobal('fetch', fetchMock);

        const client = new DextoApiClient({
            gatewayBaseUrl: 'http://gateway.local',
            platformBaseUrl: 'http://platform.local',
        });

        const result = await client.provisionDextoApiKey('auth-token');

        expect(result).toEqual({
            dextoApiKey: 'dxt_new_key',
            keyId: 'key-2',
        });
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            'http://platform.local/api/keys',
            expect.objectContaining({ method: 'GET' })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            'http://platform.local/api/keys/key-1',
            expect.objectContaining({ method: 'DELETE' })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            'http://platform.local/api/keys',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    Authorization: 'Bearer auth-token',
                    'Content-Type': 'application/json',
                },
            })
        );
    });

    it('treats server_error responses as transient poll failures', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ error: 'server_error' }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                })
            )
        );

        const client = new DextoApiClient('http://localhost:3001');
        const result = await client.pollDeviceCodeLogin('test-device-code');

        expect(result).toEqual({ status: 'transientError' });
    });

    it('treats fetch failures as transient poll failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

        const client = new DextoApiClient('http://localhost:3001');
        const result = await client.pollDeviceCodeLogin('test-device-code');

        expect(result).toEqual({ status: 'transientError' });
    });
});
