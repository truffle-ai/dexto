import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import type { DextoApp } from '../types.js';
import type { DextoAgent } from '@dexto/core';
import { logger } from '@dexto/core';
import type { WebhookEventSubscriber } from '../../events/webhook-subscriber.js';

type FetchRequest = globalThis.Request;
type FetchBodyInit = globalThis.BodyInit;

export type NodeBridgeOptions = {
    getAgent: () => DextoAgent;
    port?: number;
    hostname?: string;
    mcpHandlers?: {
        handlePost: (
            req: IncomingMessage,
            res: ServerResponse,
            body: unknown
        ) => Promise<void> | void;
        handleGet: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
    } | null;
};

export type NodeBridgeResult = {
    server: ReturnType<typeof createServer>;
    webhookSubscriber?: WebhookEventSubscriber;
};

export function createNodeServer(app: DextoApp, options: NodeBridgeOptions): NodeBridgeResult {
    const { getAgent: _getAgent } = options;
    const webhookSubscriber = app.webhookSubscriber;

    const server = createServer(async (req, res) => {
        const disconnectController = new AbortController();
        const abortOnDisconnect = () => {
            disconnectController.abort();
        };

        req.on('aborted', abortOnDisconnect);
        res.on('close', abortOnDisconnect);

        try {
            if (options.mcpHandlers && req.url?.startsWith('/mcp')) {
                if (req.method === 'GET') {
                    await options.mcpHandlers.handleGet(req, res);
                    return;
                }
                if (req.method === 'POST') {
                    req.setEncoding('utf8');
                    let body = '';
                    const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB limit
                    req.on('data', (chunk) => {
                        body += chunk;
                        if (body.length > MAX_BODY_SIZE) {
                            req.destroy();
                            res.statusCode = 413;
                            res.end('Payload too large');
                        }
                    });
                    req.on('end', async () => {
                        try {
                            const parsed = body.length > 0 ? JSON.parse(body) : undefined;
                            await options.mcpHandlers!.handlePost(req, res, parsed);
                        } catch (err) {
                            logger.error(`Failed to process MCP POST body: ${String(err)}`);
                            res.statusCode = 400;
                            res.end('Invalid JSON body');
                        }
                    });
                    req.on('error', (err: Error) => {
                        logger.error(`Error reading MCP POST body: ${String(err)}`);
                        res.statusCode = 500;
                        res.end('Failed to read request body');
                    });
                    return;
                }
            }

            const request = await toRequest(req, disconnectController.signal);
            const response = await app.fetch(request);
            await sendNodeResponse(res, response, disconnectController.signal);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Unhandled error in Node bridge: ${message}`, { error });
            res.statusCode = 500;
            res.end('Internal Server Error');
        } finally {
            req.off('aborted', abortOnDisconnect);
            res.off('close', abortOnDisconnect);
        }
    });

    server.on('close', () => {
        webhookSubscriber?.cleanup?.();
    });

    if (typeof options.port === 'number') {
        const hostname = options.hostname ?? '0.0.0.0';
        server.listen(options.port, hostname, () => {
            logger.info(`Hono Node bridge listening on http://${hostname}:${options.port}`);
        });
    }

    const result: NodeBridgeResult = {
        server,
    };

    if (webhookSubscriber) {
        result.webhookSubscriber = webhookSubscriber;
    }

    return result;
}

async function toRequest(req: IncomingMessage, signal: AbortSignal): Promise<FetchRequest> {
    const protocol = (req.socket as any)?.encrypted ? 'https' : 'http';
    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '/', `${protocol}://${host}`);

    const headers = new globalThis.Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            value.forEach((entry) => headers.append(key, entry));
        } else {
            headers.set(key, value);
        }
    }

    const method = req.method ?? 'GET';
    const body: FetchBodyInit | null =
        method === 'GET' || method === 'HEAD' ? null : (req as unknown as FetchBodyInit);

    return new globalThis.Request(url, {
        method,
        headers,
        body: body ?? undefined,
        signal,
        duplex: body ? 'half' : undefined,
    } as RequestInit);
}

async function sendNodeResponse(res: ServerResponse, response: Response, signal: AbortSignal) {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'content-length') {
            return;
        }
        res.setHeader(key, value);
    });

    if (!response.body) {
        res.end();
        return;
    }

    const webStream = response.body as unknown as NodeReadableStream<any>;
    const readable = Readable.fromWeb(webStream);
    await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (callback: () => void) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            callback();
        };
        const cleanup = () => {
            readable.off('error', handleError);
            readable.off('close', handleReadableClose);
            res.off('finish', handleFinish);
            res.off('close', handleClose);
            signal.removeEventListener('abort', handleAbort);
        };
        const handleError = (error: Error) => {
            settle(() => reject(error));
        };
        const handleReadableClose = () => {
            settle(resolve);
        };
        const handleFinish = () => {
            settle(resolve);
        };
        const handleAbort = () => {
            readable.destroy();
        };
        const handleClose = () => {
            readable.destroy();
            settle(resolve);
        };

        readable.on('error', handleError);
        readable.on('close', handleReadableClose);
        res.on('finish', handleFinish);
        res.on('close', handleClose);
        signal.addEventListener('abort', handleAbort, { once: true });
        readable.pipe(res);
    });
}
