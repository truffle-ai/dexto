import { describe, expect, it, vi } from 'vitest';
import { createDextoCloudClient } from './cloud.js';

describe('Cloud discovery client', () => {
    it('lists available sources through the authenticated application route', async () => {
        const payload = {
            sources: [{ id: 'platform', kind: 'platform', title: 'Dexto', toolCount: 4 }],
        };
        const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            Response.json(payload)
        );
        const client = createDextoCloudClient({
            origin: 'https://app.dexto.ai',
            token: 'fixture-key',
            fetch,
        });
        expect(await client.sources({ limit: 3, offset: 2 })).toEqual(payload);
        const [url, init] = fetch.mock.calls[0] ?? [];
        expect(String(url)).toBe('https://app.dexto.ai/api/capabilities/sources?limit=3&offset=2');
        expect(new globalThis.Headers(init?.headers).get('authorization')).toBe(
            'Bearer fixture-key'
        );
        expect(init?.redirect).toBe('error');
    });
    it('searches one page and preserves descriptions and invocability metadata', async () => {
        const tool = {
            aliases: ['drive.list'],
            description: 'List files',
            execution: { mode: 'hosted', owner: 'cloud' },
            invocable: { mode: 'describe_only', reason: 'Connection required' },
            id: { sourceId: 'drive', toolId: 'list' },
            name: 'List files',
            sourceId: 'drive',
            tags: ['files'],
            inputSchema: { type: 'object' },
            usageNotes: ['Connect Drive first'],
        };
        const page = { hasMore: true, items: [tool], nextOffset: 4, total: 5 };
        const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            Response.json(page)
        );
        const client = createDextoCloudClient({
            origin: 'https://app.dexto.ai',
            token: 'fixture-key',
            fetch,
        });
        expect(await client.search({ query: ' drive files ', limit: 2, offset: 2 })).toEqual(page);
        expect(String(fetch.mock.calls[0]?.[0])).toBe(
            'https://app.dexto.ai/api/capabilities/search?limit=2&offset=2&q=drive+files'
        );
        fetch.mockImplementationOnce(async () => Response.json({ found: true, tool }));
        expect(await client.describe('drive.list')).toEqual({ found: true, tool });
        expect(fetch.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ path: 'drive.list' }));
        expect(fetch).toHaveBeenCalledTimes(2);
    });
    it('fails HTTP permission errors without trusting or exposing the response body', async () => {
        const fetch = vi.fn(async () =>
            Response.json({ error: { message: 'fixture-key' } }, { status: 403 })
        );
        const client = createDextoCloudClient({
            origin: 'https://app.dexto.ai',
            token: 'fixture-key',
            fetch,
        });
        await expect(client.sources({})).rejects.toMatchObject({ code: 'http_error', status: 403 });
        await expect(client.sources({})).rejects.not.toThrow('fixture-key');
    });
    it.each([{ sources: ['bad'] }, { sources: [{ id: 'x', title: 'x', kind: 'invented' }] }])(
        'rejects malformed successful responses: %j',
        async (payload) => {
            const client = createDextoCloudClient({
                origin: 'https://app.dexto.ai',
                token: 'fixture-key',
                fetch: async () => Response.json(payload),
            });
            await expect(client.sources({})).rejects.toMatchObject({ code: 'invalid_response' });
        }
    );
    it.each([
        'http://example.com',
        'https://app.dexto.ai/path',
        'https://user:pass@app.dexto.ai',
        'https://app.dexto.ai?key=x',
    ])('rejects unsafe or non-origin configuration %s', (origin) => {
        expect(() =>
            createDextoCloudClient({ origin, token: 'fixture-key', fetch: globalThis.fetch })
        ).toThrow();
    });
    it('rejects empty credentials and invalid request inputs before fetching', async () => {
        const fetch = vi.fn(async () => Response.json({ sources: [] }));
        expect(() =>
            createDextoCloudClient({ origin: 'https://app.dexto.ai', token: ' ', fetch })
        ).toThrow();
        const client = createDextoCloudClient({
            origin: 'http://127.0.0.1:3000',
            token: 'fixture',
            fetch,
        });
        expect(() => client.sources({ limit: 101 })).toThrow();
        expect(() => client.search({ query: ' ' })).toThrow();
        expect(() => client.describe('../admin')).toThrow();
        expect(fetch).not.toHaveBeenCalled();
    });
});
