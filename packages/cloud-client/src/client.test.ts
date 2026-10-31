import { describe, expect, it } from 'vitest';
import { CloudApiError, createCloudClient, unwrap } from './index.js';

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
        });
    });
});
