import { isIP } from 'node:net';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ValidatedServersConfig } from '@dexto/core/mcp';
import type { HttpAuthorization } from '@dexto/server/hono/auth';
import { initializeMcpToolAggregationHost } from './tool-aggregation-handler.js';

export interface McpHttpAggregationGateway {
    port: number;
    close(): Promise<void>;
}

interface HttpAggregationOptions {
    name: string;
    version: string;
    strict: boolean;
    host: string;
    port: number;
    authorize: HttpAuthorization;
}

/** HTTP authority checks protect open loopback listeners against browser rebinding. */
export function allowsMcpHttpRequestOrigin(
    host: string,
    port: number,
    headers: IncomingHttpHeaders
): boolean {
    const listenerHost = isIP(host) === 6 ? `[${host}]` : host;
    const listener = new URL(`http://${listenerHost}:${port}`);
    const loopback = host === '127.0.0.1' || host === '::1';
    return (
        (!loopback || headers.host === listener.host) &&
        (headers.origin === undefined || headers.origin === listener.origin)
    );
}

/** Stateless MCP HTTP requests share one host-owned upstream discovery snapshot. */
export async function startMcpHttpAggregationGateway(
    configs: ValidatedServersConfig,
    options: HttpAggregationOptions
): Promise<McpHttpAggregationGateway> {
    const owner = await initializeMcpToolAggregationHost(
        configs,
        options.name,
        options.version,
        options.strict
    );
    const server = createServer((request, response) => {
        // Authorization precedes routing, body parsing and downstream protocol allocation.
        const authorization = options.authorize(request.headers.authorization);
        if (!authorization.allowed) {
            response.writeHead(authorization.status, { 'content-type': 'application/json' });
            response.end(JSON.stringify(authorization.body));
            return;
        }
        const address = server.address();
        if (address === null || typeof address === 'string') {
            response.writeHead(503).end();
            return;
        }
        if (!allowsMcpHttpRequestOrigin(options.host, address.port, request.headers)) {
            response.writeHead(403).end();
            return;
        }
        if (request.url?.split('?')[0] !== '/mcp') {
            response.writeHead(404).end();
            return;
        }
        if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' }).end();
            return;
        }
        // SDK stateless transports cannot be reused, even by a single HTTP client.
        const transport = new StreamableHTTPServerTransport({
            enableJsonResponse: true,
        });
        // The SDK class implements Transport, but its callback getters include undefined,
        // conflicting with Transport's optional properties under exactOptionalPropertyTypes.
        const peer = owner.connect(transport as Transport);
        let closePromise: Promise<void> | undefined;
        const closeRequest = () => {
            response.off('close', closeRequest);
            response.off('finish', closeRequest);
            if (closePromise !== undefined) return;
            closePromise = peer.then((connection) => connection.close());
            void closePromise.catch(() => {
                process.stderr.write('MCP HTTP request cleanup failed.\n');
            });
        };
        response.once('close', closeRequest);
        response.once('finish', closeRequest);
        void peer
            .then(() => transport.handleRequest(request, response))
            .catch(() => {
                if (!response.headersSent) response.writeHead(500);
                response.end();
                closeRequest();
            });
    });
    let closePromise: Promise<void> | undefined;
    const close = () => {
        closePromise ??= Promise.resolve().then(async () => {
            const listenerClosed = server.listening
                ? new Promise<void>((resolve, reject) => {
                      server.close((error) => (error ? reject(error) : resolve()));
                      server.closeAllConnections();
                  })
                : Promise.resolve();
            const results = await Promise.allSettled([listenerClosed, owner.close()]);
            const failures = results.filter((result) => result.status === 'rejected');
            if (failures.length > 0) {
                throw new AggregateError(
                    failures.map((result) => result.reason),
                    'MCP HTTP gateway cleanup failed'
                );
            }
        });
        return closePromise;
    };
    try {
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => {
                server.off('listening', onListening);
                reject(error);
            };
            const onListening = () => {
                server.off('error', onError);
                resolve();
            };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(options.port, options.host);
        });
        const address = server.address();
        if (address === null || typeof address === 'string')
            throw new Error('MCP HTTP listener address unavailable');
        return { port: address.port, close };
    } catch (error) {
        await close().catch(() => undefined);
        throw error;
    }
}
