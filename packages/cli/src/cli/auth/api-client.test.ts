import { afterEach, describe, expect, it, vi } from 'vitest';
import { DextoApiClient } from './api-client.js';

describe('DextoApiClient.pollDeviceCodeLogin', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
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
