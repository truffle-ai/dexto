import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { CloudApiError, createCloudClient, unwrap, type V1Body, type V1Response } from './index.js';

function fakeFetch(reply: (request: globalThis.Request) => Response) {
    const requests: globalThis.Request[] = [];
    const fetch = async (input: globalThis.Request | string | URL, init?: RequestInit) => {
        const request =
            input instanceof globalThis.Request ? input : new globalThis.Request(input, init);
        requests.push(request);
        return reply(request);
    };
    return { fetch, requests };
}

describe('createCloudClient', () => {
    it('drops trailing slashes from the API base URL, quickly however many there are', async () => {
        const server = fakeFetch(() => Response.json({ object: 'list', data: [] }));
        const client = createCloudClient({
            apiBaseUrl: 'https://api.dexto.ai///',
            token: 'token',
            cloudProject: null,
            fetch: server.fetch,
        });
        // A run of '/' followed by more text was slow with /\/+$/.
        const started = performance.now();
        createCloudClient({
            apiBaseUrl: `https://api.dexto.ai${'/'.repeat(50_000)}x`,
            token: 'token',
            cloudProject: null,
        });
        expect(performance.now() - started).toBeLessThan(1_000);

        await unwrap(await client.GET('/v1/secrets'));

        expect(server.requests[0]?.url).toBe('https://api.dexto.ai/v1/secrets');
    });

    it("signs each request with the current token and names the person's Cloud project", async () => {
        let issued = 0;
        const server = fakeFetch(() => Response.json({ object: 'list', data: [] }));
        const client = createCloudClient({
            apiBaseUrl: 'https://api.dexto.ai',
            token: async () => `token-${++issued}`,
            cloudProject: 'prj_main',
            fetch: server.fetch,
        });

        await unwrap(await client.GET('/v1/secrets'));
        await unwrap(await client.GET('/v1/secrets'));

        expect(server.requests.map((request) => request.url)).toEqual([
            'https://api.dexto.ai/v1/secrets',
            'https://api.dexto.ai/v1/secrets',
        ]);
        expect(server.requests.map((request) => request.headers.get('authorization'))).toEqual([
            'Bearer token-1',
            'Bearer token-2',
        ]);
        expect(server.requests[0]?.headers.get('dexto-cloud-project')).toBe('prj_main');
    });

    it('sends no project for a key, which acts in its own', async () => {
        const server = fakeFetch(() => Response.json({ object: 'list', data: [] }));
        const client = createCloudClient({
            apiBaseUrl: 'https://api.dexto.ai',
            token: 'dxt_key',
            cloudProject: null,
            fetch: server.fetch,
        });

        await unwrap(await client.GET('/v1/secrets'));

        expect(server.requests[0]?.headers.has('dexto-cloud-project')).toBe(false);
    });

    it("turns Dexto's error envelope into a CloudApiError", async () => {
        const server = fakeFetch(() =>
            Response.json(
                {
                    error: {
                        code: 'not_found',
                        message: 'Secret not found.',
                        requestId: 'req_1',
                        retryable: false,
                    },
                },
                { status: 404 }
            )
        );
        const client = createCloudClient({
            apiBaseUrl: 'https://api.dexto.ai',
            token: 'dxt_key',
            cloudProject: null,
            fetch: server.fetch,
        });

        const failure = await unwrap(
            await client.GET('/v1/secrets/{secret_id}', {
                params: { path: { secret_id: 'sec_missing' } },
            })
        ).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(CloudApiError);
        expect(failure).toMatchObject({
            status: 404,
            code: 'not_found',
            message: 'Secret not found.',
            requestId: 'req_1',
            retryable: false,
            retryAfterSeconds: null,
        });
    });

    it('carries how long Retry-After asks the caller to wait', async () => {
        const server = fakeFetch(() =>
            Response.json(
                {
                    error: {
                        code: 'rate_limited',
                        message: 'Too many requests.',
                        requestId: 'req_2',
                        retryable: true,
                    },
                },
                { status: 429, headers: { 'retry-after': '60' } }
            )
        );
        const client = createCloudClient({
            apiBaseUrl: 'https://api.dexto.ai',
            token: 'token',
            cloudProject: null,
            fetch: server.fetch,
        });

        const failure = await unwrap(await client.GET('/v1/secrets')).catch(
            (error: unknown) => error
        );

        expect(failure).toMatchObject({ status: 429, retryAfterSeconds: 60 });
    });

    it('reads an HTTP-date Retry-After as seconds from now, and ignores one it cannot read', async () => {
        const later = new Date(Date.now() + 120_000).toUTCString();
        for (const [header, expected] of [
            [later, 120],
            ['soon', null],
            ['-5', null],
        ] as const) {
            const server = fakeFetch(() =>
                Response.json(
                    { error: { code: 'payload_too_large', message: 'Too large.' } },
                    { status: 413, headers: { 'retry-after': header } }
                )
            );
            const client = createCloudClient({
                apiBaseUrl: 'https://api.dexto.ai',
                token: 'token',
                cloudProject: null,
                fetch: server.fetch,
            });

            const failure = await unwrap(await client.GET('/v1/secrets')).catch(
                (error: unknown) => error
            );

            expect(failure).toBeInstanceOf(CloudApiError);
            const seconds = failure instanceof CloudApiError ? failure.retryAfterSeconds : null;
            if (expected === null) expect(seconds).toBeNull();
            else expect(seconds).toBeGreaterThanOrEqual(expected - 2);
        }
    });
});

describe('V1Response and V1Body', () => {
    it("name an operation's success JSON and body", () => {
        type Secret = V1Response<'/v1/secrets', 'get'>['data'][number];
        type Create = V1Body<'/v1/secrets', 'post'>;
        const secret: Pick<Secret, 'id' | 'name'> = { id: 'sec_1', name: 'GITHUB' };
        const body: Pick<Create, 'name' | 'value'> = { name: 'GITHUB', value: 'x' };
        expect([secret.name, body.name]).toEqual(['GITHUB', 'GITHUB']);
    });
});
