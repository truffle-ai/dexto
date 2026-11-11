import { describe, expect, it, vi } from 'vitest';
import { createDextoClient } from './client.js';

describe('createDextoClient', () => {
    it('marks every request with X-Dexto-Request and keeps the bearer key', async () => {
        const fetchMock = vi.fn(
            async (_input: unknown, _init?: { headers?: Record<string, string> }) =>
                Response.json({ ok: true })
        );
        vi.stubGlobal('fetch', fetchMock);
        try {
            const client = createDextoClient({
                baseUrl: 'http://localhost:3001',
                apiKey: 'fixture-key',
            });
            await client.api.reset.$post({ json: {} } as never);
            const init = fetchMock.mock.calls[0]?.[1];
            const headers = new globalThis.Headers(init?.headers);
            expect(headers.get('x-dexto-request')).toBe('1');
            expect(headers.get('authorization')).toBe('Bearer fixture-key');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
