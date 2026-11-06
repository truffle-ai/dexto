import { afterEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
    DEXTO_REQUEST_HEADER,
    createRequestGuard,
    createRequestGuardMiddleware,
    isAllowedHostHeader,
    isAllowedRequestOrigin,
} from './request-guard.js';
import { createNodeServer } from '../node/index.js';

vi.mock('@dexto/core', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

afterEach(() => {
    vi.unstubAllEnvs();
});

function headersOf(values: Record<string, string>) {
    const lower = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
    );
    return (name: string) => lower[name.toLowerCase()];
}

describe('origin and host allowlists', () => {
    it('allows loopback origins and DEXTO_ALLOWED_ORIGINS only', () => {
        vi.stubEnv('DEXTO_ALLOWED_ORIGINS', 'https://app.example.com');
        expect(isAllowedRequestOrigin('http://localhost:3000')).toBe(true);
        expect(isAllowedRequestOrigin('http://127.0.0.1:5173')).toBe(true);
        expect(isAllowedRequestOrigin('http://[::1]:3001')).toBe(true);
        expect(isAllowedRequestOrigin('https://app.example.com')).toBe(true);
        expect(isAllowedRequestOrigin('https://evil.example')).toBe(false);
        expect(isAllowedRequestOrigin('http://localhost.evil.example')).toBe(false);
        expect(isAllowedRequestOrigin('null')).toBe(false);
    });

    it('allows loopback Host headers and DEXTO_ALLOWED_HOSTS only', () => {
        expect(isAllowedHostHeader('localhost:3001')).toBe(true);
        expect(isAllowedHostHeader('127.0.0.1:3001')).toBe(true);
        expect(isAllowedHostHeader('[::1]:3001')).toBe(true);
        expect(isAllowedHostHeader('localhost')).toBe(true);
        expect(isAllowedHostHeader('rebind.evil.example:3001')).toBe(false);
        expect(isAllowedHostHeader('192.168.1.10:3001')).toBe(false);
        expect(isAllowedHostHeader(undefined)).toBe(false);
        vi.stubEnv('DEXTO_ALLOWED_HOSTS', 'dexto.internal');
        expect(isAllowedHostHeader('dexto.internal:3001')).toBe(true);
    });
});

describe('createRequestGuard', () => {
    const open = createRequestGuard({ enforceLoopbackHost: true });
    const authed = createRequestGuard({ enforceLoopbackHost: false });
    const local = { host: 'localhost:3001' };

    it('rejects non-loopback Host on any method when the server is open', () => {
        expect(
            open({ method: 'GET', header: headersOf({ host: 'rebind.evil.example:3001' }) })
        ).toMatchObject({ allowed: false });
        expect(open({ method: 'GET', header: headersOf(local) })).toEqual({ allowed: true });
    });

    it('does not check Host when the server requires auth', () => {
        expect(authed({ method: 'GET', header: headersOf({ host: 'dexto.example.com' }) })).toEqual(
            { allowed: true }
        );
    });

    it('rejects simple cross-site state-changing requests', () => {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            expect(
                open({
                    method,
                    header: headersOf({ ...local, 'content-type': 'text/plain' }),
                })
            ).toMatchObject({ allowed: false });
            expect(open({ method, header: headersOf(local) })).toMatchObject({
                allowed: false,
            });
        }
        expect(
            open({
                method: 'POST',
                header: headersOf({
                    ...local,
                    'content-type': 'application/x-www-form-urlencoded',
                }),
            })
        ).toMatchObject({ allowed: false });
    });

    it('rejects a disallowed or null Origin even with a JSON body', () => {
        for (const origin of ['https://evil.example', 'null']) {
            expect(
                open({
                    method: 'POST',
                    header: headersOf({ ...local, origin, 'content-type': 'application/json' }),
                })
            ).toMatchObject({ allowed: false });
        }
    });

    it('rejects Sec-Fetch-Site: cross-site', () => {
        expect(
            open({
                method: 'POST',
                header: headersOf({
                    ...local,
                    'sec-fetch-site': 'cross-site',
                    [DEXTO_REQUEST_HEADER]: '1',
                }),
            })
        ).toMatchObject({ allowed: false });
    });

    it('accepts state-changing requests carrying a non-simple signal', () => {
        for (const extra of [
            { [DEXTO_REQUEST_HEADER]: '1' },
            { authorization: 'Bearer key' },
            { 'content-type': 'application/json; charset=utf-8' },
        ]) {
            expect(open({ method: 'POST', header: headersOf({ ...local, ...extra }) })).toEqual({
                allowed: true,
            });
        }
        expect(
            open({
                method: 'POST',
                header: headersOf({
                    ...local,
                    origin: 'http://localhost:3000',
                    'sec-fetch-site': 'same-site',
                    'content-type': 'application/json',
                }),
            })
        ).toEqual({ allowed: true });
    });
});

describe('request guard middleware', () => {
    function appWithGuard() {
        const app = new OpenAPIHono();
        app.use(
            '*',
            createRequestGuardMiddleware(createRequestGuard({ enforceLoopbackHost: true }))
        );
        app.post('/api/sessions', (ctx) => ctx.json({ created: true }));
        app.get('/api/sessions', (ctx) => ctx.json({ sessions: [] }));
        return app;
    }

    it('returns 403 for a cross-site form-style POST and passes a client POST', async () => {
        const app = appWithGuard();
        const blocked = await app.request('http://localhost:3001/api/sessions', {
            method: 'POST',
            headers: {
                host: 'localhost:3001',
                origin: 'https://evil.example',
                'content-type': 'text/plain',
            },
            body: '{}',
        });
        expect(blocked.status).toBe(403);

        const allowed = await app.request('http://localhost:3001/api/sessions', {
            method: 'POST',
            headers: { host: 'localhost:3001', [DEXTO_REQUEST_HEADER]: '1' },
        });
        expect(allowed.status).toBe(200);
    });

    it('returns 403 for a rebinding Host on reads', async () => {
        const app = appWithGuard();
        const response = await app.request('http://rebind.evil.example:3001/api/sessions', {
            headers: { host: 'rebind.evil.example:3001' },
        });
        expect(response.status).toBe(403);
    });
});

describe('node bridge /mcp', () => {
    it('applies the guard before the MCP handler', async () => {
        vi.stubEnv('DEXTO_SERVER_API_KEY', '');
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('DEXTO_SERVER_REQUIRE_AUTH', '');
        const handlePost = vi.fn((_req: unknown, res: { end: (body: string) => void }) => {
            res.end('MCP reached');
        });
        const { server } = createNodeServer(new OpenAPIHono(), {
            getAgent: () => {
                throw new Error('agent not needed');
            },
            mcpHandlers: { handlePost, handleGet: vi.fn() },
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const { port } = server.address() as AddressInfo;

        const post = (headers: Record<string, string>) =>
            new Promise<number>((resolve, reject) => {
                const req = httpRequest(
                    { host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers },
                    (res) => {
                        res.resume();
                        resolve(res.statusCode ?? 0);
                    }
                );
                req.on('error', reject);
                req.end('{}');
            });

        try {
            expect(
                await post({ host: 'rebind.evil.example', 'content-type': 'application/json' })
            ).toBe(403);
            expect(
                await post({
                    host: `localhost:${port}`,
                    origin: 'https://evil.example',
                    'content-type': 'application/json',
                })
            ).toBe(403);
            expect(handlePost).not.toHaveBeenCalled();
            expect(
                await post({ host: `localhost:${port}`, 'content-type': 'application/json' })
            ).toBe(200);
            expect(handlePost).toHaveBeenCalledTimes(1);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
