import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DextoMcpClient } from './mcp-client.js';
import { McpServerConfigSchema } from './schemas.js';
import { createSilentMockLogger } from '../logger/v2/test-utils.js';

async function listen(server: Server): Promise<string> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP fixture address');
    return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
    );
}

describe('MCP HTTP SDK compatibility', () => {
    it.each(['direct', 'same-origin redirect'])(
        'preserves headers, complete results, resource reads and cleanup through %s',
        async (endpoint) => {
            const token = 'synthetic-fixture-token';
            const headers: string[] = [];
            const peers = new Set<McpServer>();
            const server = createServer(async (request, response) => {
                if (request.url === '/redirect') {
                    response.writeHead(307, { Location: '/mcp' }).end();
                    return;
                }
                headers.push(request.headers.authorization ?? '');
                const peer = new McpServer({ name: 'http-fixture', version: '1.0.0' });
                peers.add(peer);
                peer.registerTool(
                    'fixture',
                    { inputSchema: { value: z.string() } },
                    async ({ value }) => ({
                        content: [{ type: 'text', text: value }],
                        structuredContent: { value },
                        _meta: { fixtureMetadata: 'retained' },
                    })
                );
                peer.registerResource('page', 'fixture://page', {}, async () => ({
                    contents: [
                        {
                            uri: 'fixture://page',
                            mimeType: 'text/html;profile=mcp-app',
                            text: '<p>fixture</p>',
                            _meta: { fixtureMetadata: 'retained' },
                        },
                    ],
                }));
                const transport = new StreamableHTTPServerTransport({
                    enableJsonResponse: true,
                });
                try {
                    // @ts-expect-error SDK Node wrapper accessors include undefined, unlike its Transport contract under exactOptionalPropertyTypes.
                    await peer.connect(transport);
                    await transport.handleRequest(request, response);
                } catch {
                    if (!response.headersSent) response.writeHead(500);
                    response.end();
                }
            });
            const origin = await listen(server);
            const client = new DextoMcpClient(createSilentMockLogger());
            try {
                await client.connect(
                    McpServerConfigSchema.parse({
                        type: 'http',
                        url: `${origin}/${endpoint === 'direct' ? 'mcp' : 'redirect'}`,
                        headers: { Authorization: `Bearer ${token}` },
                        timeout: 2000,
                    }),
                    'fixture'
                );
                const sdk = await client.getConnectedClient();
                await expect(
                    sdk.callTool(
                        { name: 'fixture', arguments: { value: 'hello' } },
                        CallToolResultSchema,
                        { timeout: 2000, resetTimeoutOnProgress: true }
                    )
                ).resolves.toMatchObject({
                    content: [{ type: 'text', text: 'hello' }],
                    structuredContent: { value: 'hello' },
                    _meta: { fixtureMetadata: 'retained' },
                });
                await expect(
                    sdk.readResource({ uri: 'fixture://page' }, { timeout: 2000 })
                ).resolves.toEqual({
                    contents: [
                        {
                            uri: 'fixture://page',
                            mimeType: 'text/html;profile=mcp-app',
                            text: '<p>fixture</p>',
                            _meta: { fixtureMetadata: 'retained' },
                        },
                    ],
                });
                expect(headers.length).toBeGreaterThanOrEqual(4);
                expect(headers.every((value) => value === `Bearer ${token}`)).toBe(true);
            } finally {
                await client.disconnect();
                await Promise.all([...peers].map((peer) => peer.close()));
                await close(server);
            }
            expect(client.getConnectionStatus()).toBe(false);
            expect(server.address()).toBeNull();
        },
        15000
    );

    it.each(['http', 'sse'])(
        'requires the final %s endpoint URL for a cross-origin redirect',
        async (type) => {
            let redirectedRequests = 0;
            const destination = createServer((_request, response) => {
                redirectedRequests += 1;
                response.writeHead(500).end('Redirect target must not be contacted');
            });
            const destinationOrigin = await listen(destination);
            const redirect = createServer((_request, response) => {
                response.writeHead(307, { Location: `${destinationOrigin}/mcp` }).end();
            });
            const origin = await listen(redirect);
            const client = new DextoMcpClient(createSilentMockLogger());
            try {
                await expect(
                    client.connect(
                        McpServerConfigSchema.parse({
                            type,
                            url: `${origin}/mcp`,
                            timeout: 2000,
                        }),
                        'redirect-fixture'
                    )
                ).rejects.toThrow(/Redirect.*not followed/);
                expect(redirectedRequests).toBe(0);
                expect(client.getConnectionStatus()).toBe(false);
            } finally {
                await client.disconnect();
                await close(redirect);
                await close(destination);
            }
        },
        15000
    );
});
