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

    it('uses the overridden base URL for control-plane endpoints when provided as a string', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(
            createJsonResponse({
                balance_usd: 42,
                last_30_days: {
                    since: '2026-08-22T00:00:00.000Z',
                    total_cost_usd: 1.5,
                    total_usage_events: 12,
                },
                recent_model_usage: [],
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        const client = new DextoApiClient('https://gateway.local');

        await expect(client.getUsageSummary('dxt_test')).resolves.toEqual({
            balance_usd: 42,
            last_30_days: {
                since: '2026-08-22T00:00:00.000Z',
                total_cost_usd: 1.5,
                total_usage_events: 12,
            },
            recent_model_usage: [],
        });

        expect(fetchMock).toHaveBeenCalledWith(
            'https://gateway.local/v1/billing/summary',
            expect.objectContaining({ method: 'GET' })
        );
    });

    it('rejects incomplete recent model usage instead of showing an empty history', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                createJsonResponse({
                    balance_usd: 42,
                    last_30_days: {
                        since: '2026-08-22T00:00:00.000Z',
                        total_cost_usd: 1.5,
                        total_usage_events: 12,
                    },
                    recent_model_usage: [{ model: 'missing-fields' }],
                })
            )
        );

        const client = new DextoApiClient('http://localhost:3001');
        await expect(client.getUsageSummary('dxt_test')).rejects.toThrow(
            'Invalid response from API'
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
});
