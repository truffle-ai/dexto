/**
 * A2A JSON-RPC HTTP Endpoint
 *
 * Exposes A2A Protocol JSON-RPC methods via HTTP POST endpoint.
 * Implements JSON-RPC 2.0 over HTTP transport.
 */

import { Hono } from 'hono';
import type { DextoAgent } from '@dexto/core';
import { JsonRpcServer } from '../../a2a/jsonrpc/server.js';
import { A2AMethodHandlers } from '../../a2a/jsonrpc/methods.js';
import { logger } from '@dexto/core';
import type { SSEEventSubscriber } from '../../events/sse-subscriber.js';
import { a2aToInternalMessage } from '../../a2a/adapters/message.js';

/**
 * Create A2A JSON-RPC router
 *
 * Exposes POST /jsonrpc endpoint for A2A Protocol communication.
 *
 * Usage:
 * ```typescript
 * const a2aRouter = createA2AJsonRpcRouter(getAgent, sseSubscriber);
 * app.route('/', a2aRouter);
 * ```
 *
 * Example request:
 * ```json
 * POST /jsonrpc
 * Content-Type: application/json
 *
 * {
 *   "jsonrpc": "2.0",
 *   "method": "message/send",
 *   "params": {
 *     "message": {
 *       "role": "user",
 *       "parts": [{ "kind": "text", "text": "Hello!" }],
 *       "messageId": "msg-123",
 *       "kind": "message"
 *     }
 *   },
 *   "id": 1
 * }
 * ```
 *
 * @param getAgent Function to get current DextoAgent instance
 * @param sseSubscriber SSE event subscriber for streaming methods
 * @returns Hono router with /jsonrpc endpoint
 */
export function createA2AJsonRpcRouter(
    getAgent: () => DextoAgent,
    sseSubscriber: SSEEventSubscriber
) {
    const app = new Hono();

    /**
     * POST /jsonrpc - JSON-RPC 2.0 endpoint
     *
     * Accepts JSON-RPC requests (single or batch) and returns JSON-RPC responses.
     * For streaming methods (message/stream), returns SSE stream.
     */
    app.post('/jsonrpc', async (ctx) => {
        try {
            const agent = getAgent();
            const requestBody = await ctx.req.json();

            // Check if this is a streaming method request
            const isStreamingRequest =
                !Array.isArray(requestBody) && requestBody.method === 'message/stream';

            if (isStreamingRequest) {
                // Handle streaming request with SSE
                logger.info('JSON-RPC streaming request: message/stream');

                const params = requestBody.params;
                if (!params?.message) {
                    return ctx.json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32602,
                            message: 'Invalid params: message is required',
                        },
                        id: requestBody.id,
                    });
                }

                // Create or get session
                const taskId = params.message.taskId;
                const session = await agent.createSession(taskId);

                // Create SSE stream
                const stream = sseSubscriber.createStream(session.id);

                // Start agent processing in background
                const { text, image, file } = a2aToInternalMessage(params.message);
                agent.run(text, image, file, session.id).catch((error) => {
                    logger.error(`Error in streaming task ${session.id}: ${error}`);
                });

                // Set SSE headers and return stream
                ctx.header('Content-Type', 'text/event-stream');
                ctx.header('Cache-Control', 'no-cache');
                ctx.header('Connection', 'keep-alive');
                ctx.header('X-Accel-Buffering', 'no');

                logger.info(`JSON-RPC SSE stream opened for task ${session.id}`);

                return new Response(stream);
            }

            // Handle regular (non-streaming) JSON-RPC request
            const handlers = new A2AMethodHandlers(agent);
            const rpcServer = new JsonRpcServer({
                methods: handlers.getMethods(),
                onError: (error, request) => {
                    logger.error(`JSON-RPC error for method ${request?.method}: ${error.message}`, {
                        error,
                        request,
                    });
                },
            });

            logger.debug(`A2A JSON-RPC request received`, {
                method: Array.isArray(requestBody)
                    ? `batch(${requestBody.length})`
                    : requestBody.method,
            });

            const response = await rpcServer.handle(requestBody);
            return ctx.json(response);
        } catch (error) {
            logger.error(`Failed to process JSON-RPC request: ${error}`, { error });

            return ctx.json({
                jsonrpc: '2.0',
                error: {
                    code: -32700,
                    message: 'Parse error',
                    data: error instanceof Error ? error.message : String(error),
                },
                id: null,
            });
        }
    });

    /**
     * GET /jsonrpc - Info endpoint (non-standard, for debugging)
     *
     * Returns information about available JSON-RPC methods.
     */
    app.get('/jsonrpc', (ctx) => {
        const agent = getAgent();
        const handlers = new A2AMethodHandlers(agent);

        return ctx.json({
            service: 'A2A JSON-RPC 2.0',
            version: '0.3.0',
            endpoint: '/jsonrpc',
            methods: Object.keys(handlers.getMethods()),
            usage: {
                method: 'POST',
                contentType: 'application/json',
                example: {
                    jsonrpc: '2.0',
                    method: 'agent.getInfo',
                    params: {},
                    id: 1,
                },
            },
        });
    });

    return app;
}
