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

    it('reuses an existing active CLI key without creating a new one', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
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
        );
        vi.stubGlobal('fetch', fetchMock);

        const client = new DextoApiClient({
            gatewayBaseUrl: 'http://gateway.local',
            platformBaseUrl: 'http://platform.local',
        });

        const result = await client.provisionDextoApiKey('auth-token');

        expect(result).toEqual({
            dextoApiKey: '',
            keyId: 'key-1',
            isNewKey: false,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://platform.local/api/keys',
            expect.objectContaining({
                method: 'GET',
                headers: {
                    Authorization: 'Bearer auth-token',
                },
            })
        );
    });

    it('rotates an existing CLI key through platform list/delete/create endpoints', async () => {
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
            isNewKey: true,
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
