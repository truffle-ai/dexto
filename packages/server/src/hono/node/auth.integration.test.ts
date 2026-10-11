import { afterEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createNodeServer } from './index.js';
import {
    createAuthMiddleware,
    createHttpAuthorization,
    type HttpAuthorization,
} from '../middleware/auth.js';
import { logger } from '@dexto/core';
import { createMcpHttpHandlers, createMcpTransport } from '../../mcp/mcp-handler.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('@dexto/core', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

function setPolicy(mode = 'development', requireAuth = 'true', key = 'synthetic-server-key') {
    vi.stubEnv('NODE_ENV', mode);
    vi.stubEnv('DEXTO_SERVER_REQUIRE_AUTH', requireAuth);
    vi.stubEnv('DEXTO_SERVER_API_KEY', key);
}

const finishRequest = (_req: IncomingMessage, res: ServerResponse) => {
    res.end('MCP reached');
};

async function withServer(
    run: (baseUrl: string, handlers: ReturnType<typeof fixtureHandlers>) => Promise<void>,
    authorization: HttpAuthorization = createHttpAuthorization()
) {
    const app = Object.assign(new OpenAPIHono(), { httpAuthorization: authorization });
    app.use('*', createAuthMiddleware(authorization));
    app.get('/rest', (ctx) => ctx.json({ ok: true }));
    app.get('/mcp/servers', (ctx) => ctx.json({ rest: true }));
    app.get('/mcpx', (ctx) => ctx.json({ rest: true }));
    const handlers = fixtureHandlers();
    const { server } = createNodeServer(app, {
        getAgent: () => {
            throw new Error('agent not needed');
        },
        mcpHandlers: handlers,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture address missing');
    try {
        await run(`http://127.0.0.1:${address.port}`, handlers);
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

function fixtureHandlers() {
    return {
        handleGet: vi.fn(finishRequest),
        handlePost: vi.fn((req: IncomingMessage, res: ServerResponse, _body: unknown) =>
            finishRequest(req, res)
        ),
        handleDelete: vi.fn(finishRequest),
    };
}

describe('raw MCP HTTP authorization', () => {
    it('denies an unauthenticated MCP GET under the same required policy as REST', async () => {
        setPolicy();
        await withServer(async (baseUrl, handlers) => {
            expect((await fetch(`${baseUrl}/rest`)).status).toBe(401);
            expect((await fetch(`${baseUrl}/mcp`)).status).toBe(401);
            expect(handlers.handleGet).not.toHaveBeenCalled();
        });
    });
    it.each(['GET', 'POST', 'DELETE'])(
        'rejects wrong or missing bearer before %s dispatch/body parsing',
        async (method) => {
            setPolicy();
            await withServer(async (baseUrl, handlers) => {
                for (const authorization of ['', 'Bearer wrong', 'synthetic-server-key']) {
                    const response = await fetch(`${baseUrl}/mcp?probe=1`, {
                        method,
                        headers: { Authorization: authorization },
                        ...(method === 'POST' ? { body: 'invalid-json-secret-sentinel' } : {}),
                    });
                    expect(response.status).toBe(401);
                }
                expect(handlers.handleGet).not.toHaveBeenCalled();
                expect(handlers.handlePost).not.toHaveBeenCalled();
                expect(handlers.handleDelete).not.toHaveBeenCalled();
            });
        }
    );
    it.each(['GET', 'POST', 'DELETE'])('dispatches authenticated %s to MCP', async (method) => {
        setPolicy();
        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/mcp?probe=1`, {
                method,
                headers: { Authorization: 'Bearer synthetic-server-key' },
                ...(method === 'POST' ? { body: '{}' } : {}),
            });
            expect(response.status).toBe(200);
            expect(await response.text()).toBe('MCP reached');
        });
    });
    it('requires authentication in production without explicit opt-in', async () => {
        setPolicy('production', 'false');
        await withServer(async (baseUrl) => {
            expect((await fetch(`${baseUrl}/mcp`)).status).toBe(401);
        });
    });
    it('fails closed when required authentication has no configured key', async () => {
        setPolicy('production', 'false', '');
        await withServer(async (baseUrl, handlers) => {
            expect((await fetch(`${baseUrl}/mcp`)).status).toBe(500);
            expect((await fetch(`${baseUrl}/rest`)).status).toBe(500);
            expect(handlers.handleGet).not.toHaveBeenCalled();
        });
    });
    it('preserves the development default even if a server key is set', async () => {
        setPolicy('development', 'false');
        await withServer(async (baseUrl) => {
            expect((await fetch(`${baseUrl}/mcp`)).status).toBe(200);
        });
    });
    it('honors the shared external-auth opt-out rather than re-reading environment policy', async () => {
        setPolicy('production', 'true');
        await withServer(
            async (baseUrl) => {
                expect((await fetch(`${baseUrl}/rest`)).status).toBe(200);
                expect((await fetch(`${baseUrl}/mcp`)).status).toBe(200);
            },
            () => ({ allowed: true })
        );
    });
    it('matches only the exact MCP pathname and retains REST routes', async () => {
        setPolicy('development', 'false');
        await withServer(async (baseUrl, handlers) => {
            for (const path of ['/mcp/servers', '/mcpx']) {
                expect(await (await fetch(`${baseUrl}${path}`)).json()).toEqual({ rest: true });
            }
            expect(handlers.handleGet).not.toHaveBeenCalled();
        });
    });
    it('keeps transport bodies and failures out of logs and ends failed responses', async () => {
        setPolicy();
        const transport = await createMcpTransport('http');
        if (!(transport instanceof StreamableHTTPServerTransport))
            throw new Error('HTTP fixture expected');
        const mcp = createMcpHttpHandlers(transport);
        if (!mcp) throw new Error('HTTP handlers missing');
        vi.spyOn(transport, 'handleRequest').mockRejectedValue(new Error('error-secret-sentinel'));
        vi.mocked(logger.info).mockClear();
        vi.mocked(logger.error).mockClear();
        await withServer(async (baseUrl, handlers) => {
            handlers.handlePost.mockImplementation(mcp.handlePost);
            const response = await fetch(`${baseUrl}/mcp`, {
                method: 'POST',
                headers: { Authorization: 'Bearer synthetic-server-key' },
                body: JSON.stringify({ token: 'body-secret-sentinel' }),
            });
            expect(response.status).toBe(500);
            expect(await response.text()).not.toContain('sentinel');
            const logs = JSON.stringify([
                vi.mocked(logger.info).mock.calls,
                vi.mocked(logger.error).mock.calls,
            ]);
            expect(logs).not.toContain('body-secret-sentinel');
            expect(logs).not.toContain('error-secret-sentinel');
        });
        await transport.close();
    });
    it.each(['POST', 'GET', 'DELETE'])(
        'authenticates real SDK %s lifecycle requests',
        async (method) => {
            setPolicy();
            const transport = await createMcpTransport('http');
            const server = new McpServer({ name: 'auth-fixture', version: '1.0.0' });
            await server.connect(transport);
            const mcp = createMcpHttpHandlers(transport);
            if (!mcp) throw new Error('HTTP handlers missing');
            try {
                await withServer(async (baseUrl, handlers) => {
                    handlers.handlePost.mockImplementation(mcp.handlePost);
                    handlers.handleGet.mockImplementation(mcp.handleGet);
                    handlers.handleDelete.mockImplementation(mcp.handleDelete);
                    const response = await fetch(`${baseUrl}/mcp`, {
                        method,
                        headers: {
                            Authorization: 'Bearer synthetic-server-key',
                            Accept: 'application/json, text/event-stream',
                            'Content-Type': 'application/json',
                        },
                        ...(method === 'POST'
                            ? {
                                  body: JSON.stringify({
                                      jsonrpc: '2.0',
                                      id: 1,
                                      method: 'initialize',
                                      params: {
                                          protocolVersion: '2025-03-26',
                                          capabilities: {},
                                          clientInfo: { name: 'fixture', version: '1.0.0' },
                                      },
                                  }),
                              }
                            : {}),
                    });
                    if (method === 'POST') {
                        expect(response.status).toBe(200);
                        expect(await response.json()).toMatchObject({
                            jsonrpc: '2.0',
                            id: 1,
                            result: { serverInfo: { name: 'auth-fixture' } },
                        });
                    } else {
                        expect(response.status).toBe(200);
                        if (method === 'GET') {
                            expect(response.headers.get('content-type')).toContain(
                                'text/event-stream'
                            );
                        }
                    }
                });
            } finally {
                await server.close();
            }
        }
    );
});
