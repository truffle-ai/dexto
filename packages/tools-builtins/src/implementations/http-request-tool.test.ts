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
});
