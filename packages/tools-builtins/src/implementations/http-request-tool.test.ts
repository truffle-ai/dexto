import type { LookupAddress, LookupOptions } from 'node:dns';
import { describe, expect, it, vi } from 'vitest';

// NOTE: We intentionally import from the source file so the test exercises
// the exact dispatcher/lookup wiring (no barrel exports).
import { createHttpRequestTool, createSafeLookup } from './http-request-tool.js';

describe('http_request tool', () => {
    it('supports undici lookup({ all: true }) callback signature', async () => {
        // Regression coverage for a subtle bug:
        // undici can call our custom DNS lookup with options.all=true, in which case
        // the callback signature must be (err, addresses[]).

        const records: LookupAddress[] = [
            { address: '93.184.216.34', family: 4 },
            { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
        ];

        const dnsLookup = vi.fn().mockResolvedValue(records);
        const safeLookup = createSafeLookup({ dnsLookup });

        const result = await new Promise<LookupAddress[]>((resolve, reject) => {
            safeLookup(
                'example.com',
                { all: true } as LookupOptions,
                ((err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(addresses);
                }) as never
            );
        });

        expect(dnsLookup).toHaveBeenCalledWith(
            'example.com',
            expect.objectContaining({
                all: true,
                verbatim: true,
            })
        );
        expect(result).toEqual(records);
    });

    it('blocks localhost hostnames', async () => {
        const tool = createHttpRequestTool();

        await expect(
            tool.execute(
                {
                    url: 'http://localhost:1234',
                    method: 'GET',
                    timeoutMs: 1000,
                },
                {} as never
            )
        ).rejects.toMatchObject({
            name: 'DextoRuntimeError',
            code: 'HTTP_REQUEST_UNSAFE_TARGET',
        });
    });

    it.each([
        '[::1]',
        '[0:0:0:0:0:0:0:1]',
        '[::ffff:127.0.0.1]',
        '[::ffff:10.0.0.1]',
        '[64:ff9b:1::a00:1]',
    ])('blocks private IPv6 literal %s before fetching', async (host) => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        try {
            await expect(
                createHttpRequestTool().execute(
                    { url: `http://${host}/`, method: 'GET', timeoutMs: 1000 },
                    {} as never
                )
            ).rejects.toMatchObject({ code: 'HTTP_REQUEST_UNSAFE_TARGET' });
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('blocks a redirect to a private literal before the next request', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(
                new Response(null, { status: 302, headers: { location: 'http://[::1]/secret' } })
            );
        try {
            await expect(
                createHttpRequestTool().execute(
                    { url: 'https://example.com/', method: 'GET', timeoutMs: 1000 },
                    {} as never
                )
            ).rejects.toMatchObject({ code: 'HTTP_REQUEST_UNSAFE_TARGET' });
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('follows relative redirects and limits redirect loops', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(
                async () => new Response(null, { status: 302, headers: { location: '/next' } })
            );
        try {
            await expect(
                createHttpRequestTool().execute(
                    { url: 'https://example.com/', method: 'GET', timeoutMs: 1000 },
                    {} as never
                )
            ).rejects.toMatchObject({ code: 'HTTP_REQUEST_TOO_MANY_REDIRECTS' });
            expect(fetchSpy).toHaveBeenCalledTimes(21);
            expect(fetchSpy.mock.calls[1]?.[0]).toBe('https://example.com/next');
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('drops credentials when following a cross-origin redirect', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(
                new Response(null, { status: 302, headers: { location: 'https://other.example/' } })
            )
            .mockResolvedValueOnce(new Response('ok'));
        try {
            await createHttpRequestTool().execute(
                {
                    url: 'https://example.com/',
                    method: 'GET',
                    headers: {
                        Authorization: 'secret',
                        Cookie: 'session=value',
                        'X-API-Key': 'secret',
                    },
                    timeoutMs: 1000,
                },
                {} as never
            );
            expect(fetchSpy.mock.calls[1]?.[1]?.headers).toEqual({});
        } finally {
            fetchSpy.mockRestore();
        }
    });
});
