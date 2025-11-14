/**
 * A2A SSE (Server-Sent Events) Streaming Routes
 *
 * Provides SSE endpoints for streaming task updates per A2A Protocol.
 * Uses standard text/event-stream format.
 */

import { Hono } from 'hono';
import type { DextoAgent } from '@dexto/core';
import { logger } from '@dexto/core';
import type { SSEEventSubscriber } from '../../events/sse-subscriber.js';

/**
 * Create A2A SSE router
 *
 * Exposes SSE endpoints for real-time task updates.
 *
 * Endpoints:
 * - GET /tasks/:taskId/stream - Stream events for a specific task
 *
 * Usage:
 * ```typescript
 * const sseRouter = createA2ASSERouter(getAgent, sseSubscriber);
 * app.route('/', sseRouter);
 * ```
 *
 * Client example:
 * ```javascript
 * const eventSource = new EventSource('/tasks/task-123/stream');
 *
 * eventSource.addEventListener('task.message', (e) => {
 *   const data = JSON.parse(e.data);
 *   console.log('Agent message:', data.message);
 * });
 *
 * eventSource.addEventListener('task.chunk', (e) => {
 *   const data = JSON.parse(e.data);
 *   console.log('Chunk:', data.content);
 * });
 * ```
 *
 * @param getAgent Function to get current DextoAgent instance
 * @param sseSubscriber SSE event subscriber instance
 * @returns Hono router with SSE endpoints
 */
export function createA2ASSERouter(getAgent: () => DextoAgent, sseSubscriber: SSEEventSubscriber) {
    const app = new Hono();

    /**
     * GET /tasks/:taskId/stream - Stream task events via SSE
     *
     * Returns a Server-Sent Events stream for a specific task.
     * Events are emitted in real-time as the agent processes the task.
     */
    app.get('/tasks/:taskId/stream', async (ctx) => {
        const taskId = ctx.req.param('taskId');

        logger.debug(`SSE stream requested for task ${taskId}`);

        // Verify task exists by trying to create/get the session
        try {
            await getAgent().createSession(taskId);
        } catch (error) {
            logger.warn(`SSE stream request for non-existent task ${taskId}`);
            return ctx.text('Task not found', 404);
        }

        // Create SSE stream
        const stream = sseSubscriber.createStream(taskId);

        // Set SSE headers
        ctx.header('Content-Type', 'text/event-stream');
        ctx.header('Cache-Control', 'no-cache');
        ctx.header('Connection', 'keep-alive');
        ctx.header('X-Accel-Buffering', 'no'); // Disable nginx buffering

        logger.info(`SSE stream opened for task ${taskId}`);

        return new Response(stream);
    });

    /**
     * GET /stream - Stream all task events (no filtering)
     *
     * Returns SSE stream for all tasks (useful for monitoring/debugging).
     * Use with caution in production as it broadcasts all agent activity.
     */
    app.get('/stream', (ctx) => {
        logger.warn('Global SSE stream requested (broadcasts all tasks)');

        // Create stream with wildcard taskId (will need to modify subscriber to support this)
        // For now, return error
        return ctx.json(
            {
                error: 'Global streaming not yet implemented',
                hint: 'Use /tasks/:taskId/stream for task-specific streaming',
            },
            501
        );
    });

    return app;
}
