/**
 * A2A REST Task API (Compliant with A2A Protocol v0.3.0)
 *
 * RESTful HTTP+JSON endpoints for A2A Protocol task management.
 * Follows the /v1/ URL pattern per A2A specification.
 *
 * Endpoint mappings per spec:
 * - POST /v1/message:send → message/send
 * - GET  /v1/tasks/{id} → tasks/get
 * - GET  /v1/tasks → tasks/list
 * - POST /v1/tasks/{id}:cancel → tasks/cancel
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { A2AMethodHandlers } from '../../a2a/jsonrpc/methods.js';
import { logger } from '@dexto/core';

// Request/Response Schemas for OpenAPI (using A2A-compliant schema)

const PartSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('text'),
        text: z.string(),
        metadata: z.record(z.any()).optional(),
    }),
    z.object({
        kind: z.literal('file'),
        file: z.union([
            z.object({
                bytes: z.string(),
                name: z.string().optional(),
                mimeType: z.string().optional(),
            }),
            z.object({
                uri: z.string(),
                name: z.string().optional(),
                mimeType: z.string().optional(),
            }),
        ]),
        metadata: z.record(z.any()).optional(),
    }),
    z.object({
        kind: z.literal('data'),
        data: z.record(z.any()),
        metadata: z.record(z.any()).optional(),
    }),
]);

const MessageSchema = z.object({
    role: z.enum(['user', 'agent']),
    parts: z.array(PartSchema),
    messageId: z.string(),
    taskId: z.string().optional(),
    contextId: z.string().optional(),
    metadata: z.record(z.any()).optional(),
    extensions: z.array(z.string()).optional(),
    referenceTaskIds: z.array(z.string()).optional(),
    kind: z.literal('message'),
});

const TaskStatusSchema = z.object({
    state: z.enum([
        'submitted',
        'working',
        'input-required',
        'completed',
        'canceled',
        'failed',
        'rejected',
        'auth-required',
        'unknown',
    ]),
    message: MessageSchema.optional(),
    timestamp: z.string().optional(),
});

const TaskSchema = z.object({
    id: z.string(),
    contextId: z.string(),
    status: TaskStatusSchema,
    history: z.array(MessageSchema).optional(),
    artifacts: z.array(z.any()).optional(),
    metadata: z.record(z.any()).optional(),
    kind: z.literal('task'),
});

const MessageSendRequestSchema = z.object({
    message: MessageSchema.describe('Message to send to the agent'),
    configuration: z
        .object({
            acceptedOutputModes: z.array(z.string()).optional(),
            historyLength: z.number().optional(),
            pushNotificationConfig: z
                .object({
                    url: z.string(),
                    headers: z.record(z.string()).optional(),
                })
                .optional(),
            blocking: z.boolean().optional(),
        })
        .optional()
        .describe('Optional configuration'),
    metadata: z.record(z.any()).optional().describe('Optional metadata'),
});

const TaskListQuerySchema = z.object({
    contextId: z.string().optional(),
    status: z
        .enum([
            'submitted',
            'working',
            'input-required',
            'completed',
            'canceled',
            'failed',
            'rejected',
            'auth-required',
            'unknown',
        ])
        .optional(),
    pageSize: z
        .string()
        .optional()
        .transform((v) => (v ? parseInt(v) : undefined)),
    pageToken: z.string().optional(),
    historyLength: z
        .string()
        .optional()
        .transform((v) => (v ? parseInt(v) : undefined)),
    lastUpdatedAfter: z
        .string()
        .optional()
        .transform((v) => (v ? parseInt(v) : undefined)),
    includeArtifacts: z
        .string()
        .optional()
        .transform((v) => v === 'true'),
});

/**
 * Create A2A REST Task router
 *
 * Exposes RESTful endpoints for A2A task management per v0.3.0 spec.
 *
 * Endpoints:
 * - POST   /v1/message:send        - Send message to agent
 * - GET    /v1/tasks/{id}          - Get task
 * - GET    /v1/tasks               - List tasks
 * - POST   /v1/tasks/{id}:cancel   - Cancel task
 *
 * @param getAgent Function to get current DextoAgent instance
 * @returns OpenAPIHono router with REST task endpoints
 */
export function createA2ATasksRouter(getAgent: () => DextoAgent) {
    const app = new OpenAPIHono();

    // POST /v1/message:send - Send message to agent
    const messageSendRoute = createRoute({
        method: 'post',
        path: '/v1/message:send',
        summary: 'Send Message',
        description: 'Send a message to the agent (A2A message/send)',
        tags: ['a2a'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: MessageSendRequestSchema,
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Task with agent response',
                content: {
                    'application/json': {
                        schema: TaskSchema,
                    },
                },
            },
        },
    });

    app.openapi(messageSendRoute, async (ctx) => {
        const handlers = new A2AMethodHandlers(getAgent());
        const body = ctx.req.valid('json');

        logger.info('REST: message/send', { hasMessage: !!body.message });

        const result = await handlers.messageSend(body as any);

        // Always return Task (blocking mode) - spec allows Task or Message
        // For now, we only implement blocking mode which returns Task
        return ctx.json(result as any);
    });

    // GET /v1/tasks - List tasks
    const listTasksRoute = createRoute({
        method: 'get',
        path: '/v1/tasks',
        summary: 'List Tasks',
        description: 'List all A2A tasks with optional filtering (A2A tasks/list)',
        tags: ['a2a'],
        request: {
            query: TaskListQuerySchema,
        },
        responses: {
            200: {
                description: 'Task list',
                content: {
                    'application/json': {
                        schema: z.object({
                            tasks: z.array(TaskSchema),
                            totalSize: z.number(),
                            pageSize: z.number(),
                            nextPageToken: z.string(),
                        }),
                    },
                },
            },
        },
    });

    app.openapi(listTasksRoute, async (ctx) => {
        const handlers = new A2AMethodHandlers(getAgent());
        const query = ctx.req.valid('query');

        const result = await handlers.tasksList(query as any);

        return ctx.json(result);
    });

    // GET /v1/tasks/{id} - Get a specific task
    const getTaskRoute = createRoute({
        method: 'get',
        path: '/v1/tasks/{id}',
        summary: 'Get Task',
        description: 'Retrieve a specific task by ID (A2A tasks/get)',
        tags: ['a2a'],
        request: {
            params: z.object({
                id: z.string(),
            }),
        },
        responses: {
            200: {
                description: 'Task details',
                content: {
                    'application/json': {
                        schema: TaskSchema,
                    },
                },
            },
            404: {
                description: 'Task not found',
            },
        },
    });

    app.openapi(getTaskRoute, async (ctx) => {
        const handlers = new A2AMethodHandlers(getAgent());
        const { id } = ctx.req.valid('param');

        try {
            const task = await handlers.tasksGet({ id });
            return ctx.json(task);
        } catch (error) {
            logger.warn(`Task ${id} not found: ${error}`);
            return ctx.json({ error: 'Task not found' }, 404);
        }
    });

    // POST /v1/tasks/{id}:cancel - Cancel task
    const cancelTaskRoute = createRoute({
        method: 'post',
        path: '/v1/tasks/{id}:cancel',
        summary: 'Cancel Task',
        description: 'Cancel a running task (A2A tasks/cancel)',
        tags: ['a2a'],
        request: {
            params: z.object({
                id: z.string(),
            }),
        },
        responses: {
            200: {
                description: 'Task cancelled',
                content: {
                    'application/json': {
                        schema: TaskSchema,
                    },
                },
            },
            404: {
                description: 'Task not found',
            },
        },
    });

    app.openapi(cancelTaskRoute, async (ctx) => {
        const handlers = new A2AMethodHandlers(getAgent());
        const { id } = ctx.req.valid('param');

        logger.info(`REST: tasks/cancel ${id}`);

        try {
            const task = await handlers.tasksCancel({ id });
            return ctx.json(task);
        } catch (error) {
            logger.error(`Failed to cancel task ${id}: ${error}`);
            return ctx.json({ error: 'Task not found' }, 404);
        }
    });

    return app;
}
