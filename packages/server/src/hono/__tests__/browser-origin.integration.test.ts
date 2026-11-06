import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { request as nodeRequest } from 'node:http';
import { createTestAgent, startTestServer, type TestServer } from './test-fixtures.js';

/**
 * End-to-end browser origin checks against a real server and agent, without auth.
 * Requests are sent with the headers a browser would send for each scenario (Node's HTTP
 * client lets the test set Origin and Sec-Fetch-Site, which page scripts cannot).
 */

type RawResponse = { status: number; headers: Record<string, string | string[] | undefined> };

function send(
    port: number,
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string
): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
        const req = nodeRequest(
            {
                host: '127.0.0.1',
                port,
                method,
                path,
                headers: { host: `localhost:${port}`, ...headers },
            },
            (res) => {
                res.resume();
                res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
            }
        );
        req.on('error', reject);
        req.end(body);
    });
}

function preflight(port: number, origin: string, path: string, fetchSite: string) {
    return send(port, 'OPTIONS', path, {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-dexto-request',
        'sec-fetch-site': fetchSite,
        'sec-fetch-mode': 'cors',
    });
}

describe('browser origin policy (real server, no auth)', () => {
    let server: TestServer;

    beforeAll(async () => {
        vi.stubEnv('DEXTO_SERVER_API_KEY', '');
        vi.stubEnv('DEXTO_SERVER_REQUIRE_AUTH', '');
        vi.stubEnv('NODE_ENV', 'development');
        server = await startTestServer(await createTestAgent());
    }, 30000);

    afterAll(async () => {
        await server?.cleanup();
        vi.unstubAllEnvs();
    });

    afterEach(() => {
        vi.stubEnv('DEXTO_ALLOWED_ORIGINS', '');
    });

    it('refuses a page on another localhost port: preflight, GET and write', async () => {
        const evil = 'http://localhost:8000';

        const pre = await preflight(server.port, evil, '/api/sessions', 'same-site');
        expect(pre.headers['access-control-allow-origin']).toBeUndefined();

        const read = await send(server.port, 'GET', '/api/sessions', {
            origin: evil,
            'sec-fetch-site': 'same-site',
            'sec-fetch-mode': 'cors',
        });
        expect(read.status).toBe(403);
        expect(read.headers['access-control-allow-origin']).toBeUndefined();

        const write = await send(
            server.port,
            'POST',
            '/api/sessions',
            {
                origin: evil,
                'sec-fetch-site': 'same-site',
                'sec-fetch-mode': 'cors',
                'content-type': 'application/json',
                'x-dexto-request': '1',
            },
            JSON.stringify({ sessionId: 'from-other-port' })
        );
        expect(write.status).toBe(403);

        // A simple (non-preflighted) write from the same page is also refused.
        const simple = await send(
            server.port,
            'POST',
            '/api/sessions',
            { origin: evil, 'sec-fetch-site': 'same-site', 'content-type': 'text/plain' },
            '{}'
        );
        expect(simple.status).toBe(403);

        // 127.0.0.1 and [::1] on other ports are other origins too.
        for (const origin of ['http://127.0.0.1:8000', 'http://[::1]:8000']) {
            const res = await send(server.port, 'GET', '/api/sessions', { origin });
            expect(res.status).toBe(403);
        }
    });

    it("accepts the server's own origin (bundled Web UI) for reads and writes", async () => {
        const own = `http://localhost:${server.port}`;
        const read = await send(server.port, 'GET', '/api/sessions', {
            'sec-fetch-site': 'same-origin',
        });
        expect(read.status).toBe(200);

        const write = await send(
            server.port,
            'POST',
            '/api/sessions',
            {
                origin: own,
                'sec-fetch-site': 'same-origin',
                'sec-fetch-mode': 'cors',
                'content-type': 'application/json',
            },
            JSON.stringify({ sessionId: 'from-web-ui' })
        );
        expect(write.status).toBe(201);
    });

    it('accepts a cross-site origin listed in DEXTO_ALLOWED_ORIGINS: preflight and write', async () => {
        const trusted = 'https://app.example.com';
        vi.stubEnv('DEXTO_ALLOWED_ORIGINS', `${trusted}/`);

        const pre = await preflight(server.port, trusted, '/api/sessions', 'cross-site');
        expect(pre.status).toBe(204);
        expect(pre.headers['access-control-allow-origin']).toBe(trusted);
        expect(String(pre.headers['access-control-allow-headers']).toLowerCase()).toContain(
            'x-dexto-request'
        );

        const write = await send(
            server.port,
            'POST',
            '/api/sessions',
            {
                origin: trusted,
                'sec-fetch-site': 'cross-site',
                'sec-fetch-mode': 'cors',
                'content-type': 'application/json',
                'x-dexto-request': '1',
            },
            JSON.stringify({ sessionId: 'from-trusted-origin' })
        );
        expect(write.status).toBe(201);
        expect(write.headers['access-control-allow-origin']).toBe(trusted);

        const read = await send(server.port, 'GET', '/api/sessions', {
            origin: trusted,
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': 'cors',
        });
        expect(read.status).toBe(200);
        expect(read.headers['access-control-allow-origin']).toBe(trusted);

        // A different, unlisted cross-site origin is still refused.
        const other = await send(
            server.port,
            'POST',
            '/api/sessions',
            {
                origin: 'https://evil.example',
                'sec-fetch-site': 'cross-site',
                'content-type': 'application/json',
            },
            '{}'
        );
        expect(other.status).toBe(403);
    });

    it('still serves a top-level navigation from another site (no Origin)', async () => {
        const res = await send(server.port, 'GET', '/health', {
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': 'navigate',
        });
        expect(res.status).toBe(200);
    });
});
