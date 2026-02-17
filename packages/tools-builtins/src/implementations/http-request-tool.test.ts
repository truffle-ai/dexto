import { describe, expect, it, vi } from 'vitest';

// NOTE: We intentionally import from the source file so the test
// exercises the exact dispatcher/lookup wiring.
import { createHttpRequestTool } from './http-request-tool.js';

describe('http_request tool', () => {
    it('can fetch via SAFE_DISPATCHER when undici uses lookup({ all: true })', async () => {
        type HttpResponsePayload = {
            ok: boolean;
            status: number;
            body: string;
        };

        // Regression coverage for a subtle bug:
        // undici can call our custom DNS lookup with options.all=true, in which case
        // the callback signature must be (err, addresses[]).
        //
        // We spy on dns.lookup but delegate to the real implementation to avoid
        // pinning example.com to an outdated IP (which can hang/fail).
        const dns = await import('node:dns');

        const realLookup = dns.promises.lookup.bind(dns.promises);
        const lookupSpy = vi.spyOn(dns.promises, 'lookup').mockImplementation(((
            hostname: string,
            options: unknown
        ) => {
            return realLookup(hostname, options as never) as never;
        }) as never);

        const tool = createHttpRequestTool();
        const result = (await tool.execute(
            {
                url: 'https://example.com',
                method: 'GET',
                timeoutMs: 15_000,
            },
            // ToolExecutionContext is not used by this tool.
            {} as never
        )) as HttpResponsePayload;

        expect(lookupSpy).toHaveBeenCalled();
        expect(result).toMatchObject({
            ok: true,
            status: 200,
        });
        expect(typeof result.body).toBe('string');
        expect(result.body.length).toBeGreaterThan(0);
    }, 20_000);

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
