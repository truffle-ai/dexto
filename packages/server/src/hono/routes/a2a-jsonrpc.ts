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

/**
 * Create A2A JSON-RPC router
 *
 * Exposes POST /jsonrpc endpoint for A2A Protocol communication.
 *
 * Usage:
 * ```typescript
 * const a2aRouter = createA2AJsonRpcRouter(getAgent);
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
 *   "method": "agent.createTask",
 *   "params": {
 *     "message": {
 *       "role": "user",
 *       "content": [{ "type": "text", "text": "Hello!" }],
 *       "timestamp": "2025-11-13T00:00:00Z"
 *     }
 *   },
 *   "id": 1
 * }
 * ```
 *
 * @param getAgent Function to get current DextoAgent instance
 * @returns Hono router with /jsonrpc endpoint
 */
export function createA2AJsonRpcRouter(getAgent: () => DextoAgent) {
    const app = new Hono();

    /**
     * POST /jsonrpc - JSON-RPC 2.0 endpoint
     *
     * Accepts JSON-RPC requests (single or batch) and returns JSON-RPC responses.
     */
    app.post('/jsonrpc', async (ctx) => {
        try {
            const agent = getAgent();

            // Create method handlers
            const handlers = new A2AMethodHandlers(agent);

            // Create JSON-RPC server
            const rpcServer = new JsonRpcServer({
                methods: handlers.getMethods(),
                onError: (error, request) => {
                    logger.error(`JSON-RPC error for method ${request?.method}: ${error.message}`, {
                        error,
                        request,
                    });
                },
            });

            // Parse request body
            const requestBody = await ctx.req.json();

            logger.debug(`A2A JSON-RPC request received`, {
                method: Array.isArray(requestBody)
                    ? `batch(${requestBody.length})`
                    : requestBody.method,
            });

            // Handle request
            const response = await rpcServer.handle(requestBody);

            // Return JSON-RPC response
            return ctx.json(response);
        } catch (error) {
            // Parsing error or other unexpected error
            logger.error(`Failed to process JSON-RPC request: ${error}`, { error });

            // Return JSON-RPC error response
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
