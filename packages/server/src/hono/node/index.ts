import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import { WebSocketServer, type WebSocket } from 'ws';
import type { DextoApp } from '../types.js';
import type { DextoAgent } from '@dexto/core';
import {
    logger,
    validateInputForLLM,
    DextoValidationError,
    AgentErrorCode,
    ErrorScope,
    ErrorType,
    redactSensitiveData,
} from '@dexto/core';
import { WebSocketEventSubscriber } from '../../events/websocket-subscriber.js';
import {
    sendWebSocketError,
    sendWebSocketValidationError,
} from '../../events/websocket-error-handler.js';
import type { WebhookEventSubscriber } from '../../events/webhook-subscriber.js';

type FetchRequest = globalThis.Request;
type FetchBodyInit = globalThis.BodyInit;

export type NodeBridgeOptions = {
    agent: DextoAgent;
    port?: number;
    hostname?: string;
    websocketPath?: string;
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
    websocketServer: WebSocketServer;
    webSubscriber: WebSocketEventSubscriber;
    webhookSubscriber?: WebhookEventSubscriber;
};

export function createNodeServer(app: DextoApp, options: NodeBridgeOptions): NodeBridgeResult {
    const { agent } = options;
    const webhookSubscriber = app.webhookSubscriber;

    const server = createServer(async (req, res) => {
        try {
            if (options.mcpHandlers && req.url?.startsWith('/mcp')) {
                if (req.method === 'GET') {
                    await options.mcpHandlers.handleGet(req, res);
                    return;
                }
                if (req.method === 'POST') {
                    req.setEncoding('utf8');
                    let body = '';
                    req.on('data', (chunk) => {
                        body += chunk;
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

            const request = await toRequest(req);
            const response = await app.fetch(request);
            await sendNodeResponse(res, response);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Unhandled error in Node bridge: ${message}`, { error });
            res.statusCode = 500;
            res.end('Internal Server Error');
        }
    });

    const websocketServer = new WebSocketServer({ noServer: true });
    const webSubscriber = new WebSocketEventSubscriber(websocketServer);
    webSubscriber.subscribe(agent.agentEventBus);

    // Normalize connection handling so both our subscriber and the per-connection
    // message handler are wired via the same 'connection' event.
    websocketServer.on('connection', (ws) => {
        logger.info('WebSocket client connected.');
        handleWebsocketConnection(agent, ws);
    });

    const websocketPath = options.websocketPath ?? '/ws';

    server.on('close', () => {
        webSubscriber.cleanup();
        webhookSubscriber?.cleanup?.();
    });

    server.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith(websocketPath)) {
            socket.destroy();
            return;
        }

        websocketServer.handleUpgrade(req, socket, head, (ws) => {
            // Emit the standard 'connection' event so any listeners (like our
            // WebSocketEventSubscriber) can register this client.
            websocketServer.emit('connection', ws, req);
        });
    });

    if (typeof options.port === 'number') {
        const hostname = options.hostname ?? '0.0.0.0';
        server.listen(options.port, hostname, () => {
            logger.info(`Hono Node bridge listening on http://${hostname}:${options.port}`);
        });
    }

    const result: NodeBridgeResult = {
        server,
        websocketServer,
        webSubscriber,
    };

    if (webhookSubscriber) {
        result.webhookSubscriber = webhookSubscriber;
    }

    return result;
}

function handleWebsocketConnection(agent: DextoAgent, ws: WebSocket) {
    ws.on('message', async (messageBuffer: Buffer) => {
        const messageString = messageBuffer.toString();
        try {
            try {
                const parsedMessage = JSON.parse(messageString);
                const redactedMessage = redactSensitiveData(parsedMessage);
                logger.debug(`WebSocket received message: ${JSON.stringify(redactedMessage)}`);
            } catch {
                const redacted = String(redactSensitiveData(messageString));
                const truncated =
                    redacted.length > 200
                        ? `${redacted.substring(0, 200)}... (${redacted.length} total chars)`
                        : redacted;
                logger.debug(`WebSocket received message: ${truncated}`);
            }

            const data = JSON.parse(messageString);
            if (data.type === 'toolConfirmationResponse' && data.data) {
                agent.agentEventBus.emit('dexto:toolConfirmationResponse', data.data);
                return;
            }

            if (data.type === 'message' && (data.content || data.imageData || data.fileData)) {
                const imageDataInput = data.imageData
                    ? { image: data.imageData.base64, mimeType: data.imageData.mimeType }
                    : undefined;

                const fileDataInput = data.fileData
                    ? {
                          data: data.fileData.base64,
                          mimeType: data.fileData.mimeType,
                          ...(data.fileData.filename && { filename: data.fileData.filename }),
                      }
                    : undefined;

                const sessionId =
                    typeof data.sessionId === 'string' ? (data.sessionId as string) : undefined;
                if (!sessionId) {
                    logger.error('Received WebSocket message without sessionId. Dropping message.');
                    return;
                }
                const stream = data.stream === true;

                const currentConfig = agent.getEffectiveConfig(sessionId);
                const llmProvider = currentConfig.llm.provider;
                const llmModel = currentConfig.llm.model;
                const validation = validateInputForLLM(
                    {
                        text: data.content,
                        ...(imageDataInput && { imageData: imageDataInput }),
                        ...(fileDataInput && { fileData: fileDataInput }),
                    },
                    {
                        provider: llmProvider,
                        model: llmModel,
                    }
                );

                if (!validation.ok) {
                    const redactedIssues = redactSensitiveData(validation.issues);
                    logger.error('Invalid input for current LLM configuration', {
                        provider: llmProvider,
                        model: llmModel,
                        issues: redactedIssues,
                    });
                    const hierarchicalError = new DextoValidationError([
                        {
                            code: AgentErrorCode.API_VALIDATION_ERROR,
                            message: 'Invalid input for current LLM configuration',
                            scope: ErrorScope.AGENT,
                            type: ErrorType.USER,
                            severity: 'error',
                            context: {
                                provider: llmProvider,
                                model: llmModel,
                                detailedIssues: validation.issues,
                            },
                        },
                    ]);
                    sendWebSocketError(ws, hierarchicalError, sessionId);
                    return;
                }

                await agent.run(data.content, imageDataInput, fileDataInput, sessionId, stream);
                return;
            }

            if (data.type === 'reset') {
                const sessionId = data.sessionId as string | undefined;
                logger.info(
                    `Processing reset command from WebSocket${sessionId ? ` for session: ${sessionId}` : ''}.`
                );
                await agent.resetConversation(sessionId);
                return;
            }

            if (data.type === 'cancel') {
                const sessionId = data.sessionId as string | undefined;
                logger.info(
                    `Processing cancel command from WebSocket${sessionId ? ` for session: ${sessionId}` : ''}.`
                );
                const cancelled = await agent.cancel(sessionId);
                if (!cancelled) {
                    logger.debug('No in-flight run to cancel');
                }
                return;
            }

            logger.warn(`Received unknown WebSocket message type: ${data.type}`);
            if (typeof data.sessionId === 'string') {
                sendWebSocketValidationError(ws, 'Unknown message type', data.sessionId, {
                    messageType: data.type,
                });
            } else {
                logger.error('Cannot send error for unknown message type without sessionId.');
            }
        } catch (error) {
            logger.error(
                `Error processing WebSocket message: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            try {
                const maybe = JSON.parse(messageBuffer.toString());
                if (typeof maybe.sessionId === 'string') {
                    sendWebSocketError(ws, error, maybe.sessionId);
                } else {
                    logger.error(
                        'Cannot send WebSocket error without sessionId. Error will be logged only.'
                    );
                }
            } catch {
                logger.error(
                    'Cannot parse incoming message to extract sessionId for error reporting.'
                );
            }
        }
    });

    ws.on('close', () => {
        logger.info('WebSocket client disconnected.');
    });

    ws.on('error', (error: Error) => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`WebSocket error: ${errorMessage}`);
    });
}

async function toRequest(req: IncomingMessage): Promise<FetchRequest> {
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
        duplex: body ? 'half' : undefined,
    } as RequestInit);
}

async function sendNodeResponse(res: ServerResponse, response: Response) {
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
        readable.on('error', reject);
        res.on('finish', resolve);
        readable.pipe(res);
    });
}
