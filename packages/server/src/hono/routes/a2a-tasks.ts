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
import type { A2ASseEventSubscriber } from '../../events/a2a-sse-subscriber.js';
import { a2aToInternalMessage } from '../../a2a/adapters/message.js';
import type { Context } from 'hono';
type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

// Request/Response Schemas for OpenAPI (using A2A-compliant schema)

const PartSchema = z
    .discriminatedUnion('kind', [
        z.object({
            kind: z.literal('text').describe('Part type discriminator'),
            text: z.string().describe('Text content'),
            metadata: z.record(z.any()).optional().describe('Extension metadata'),
        }),
        z.object({
            kind: z.literal('file').describe('Part type discriminator'),
            file: z
                .union([
                    z.object({
                        bytes: z.string().describe('Base64-encoded file data'),
                        name: z.string().optional().describe('File name'),
                        mimeType: z.string().optional().describe('MIME type'),
                    }),
                    z.object({
                        uri: z.string().describe('File URI'),
                        name: z.string().optional().describe('File name'),
                        mimeType: z.string().optional().describe('MIME type'),
                    }),
                ])
                .describe('File data (bytes or URI)'),
            metadata: z.record(z.any()).optional().describe('Extension metadata'),
        }),
        z.object({
            kind: z.literal('data').describe('Part type discriminator'),
            data: z.record(z.any()).describe('Structured JSON data'),
            metadata: z.record(z.any()).optional().describe('Extension metadata'),
        }),
    ])
    .describe('Message part (text, file, or data)');

const MessageSchema = z
    .object({
        role: z.enum(['user', 'agent']).describe('Message role'),
        parts: z.array(PartSchema).describe('Message parts'),
        messageId: z.string().describe('Unique message identifier'),
        taskId: z.string().optional().describe('Associated task ID'),
        contextId: z.string().optional().describe('Context identifier'),
        metadata: z.record(z.any()).optional().describe('Extension metadata'),
        extensions: z.array(z.string()).optional().describe('Extension identifiers'),
        referenceTaskIds: z.array(z.string()).optional().describe('Referenced task IDs'),
        kind: z.literal('message').describe('Object type discriminator'),
    })
    .describe('A2A Protocol message');

const TaskStatusSchema = z
    .object({
        state: z
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
            .describe('Current task state'),
        message: MessageSchema.optional().describe('Status message'),
        timestamp: z.string().optional().describe('ISO 8601 timestamp'),
    })
    .describe('Task status');

const TaskSchema = z
    .object({
        id: z.string().describe('Unique task identifier'),
        contextId: z.string().describe('Context identifier across related tasks'),
        status: TaskStatusSchema.describe('Current task status'),
        history: z.array(MessageSchema).optional().describe('Conversation history'),
        artifacts: z.array(z.any()).optional().describe('Task artifacts'),
        metadata: z.record(z.any()).optional().describe('Extension metadata'),
        kind: z.literal('task').describe('Object type discriminator'),
    })
    .describe('A2A Protocol task');

const MessageSendRequestSchema = z
    .object({
        message: MessageSchema.describe('Message to send to the agent'),
        configuration: z
            .object({
                acceptedOutputModes: z
                    .array(z.string())
                    .optional()
                    .describe('Accepted output MIME types'),
                historyLength: z.number().optional().describe('Limit conversation history length'),
                pushNotificationConfig: z
                    .object({
                        url: z.string().describe('Push notification webhook URL'),
                        headers: z
                            .record(z.string())
                            .optional()
                            .describe('HTTP headers for webhook'),
                    })
                    .optional()
                    .describe('Push notification configuration'),
                blocking: z.boolean().optional().describe('Wait for task completion'),
            })
            .optional()
            .describe('Optional configuration'),
        metadata: z.record(z.any()).optional().describe('Optional metadata'),
    })
    .describe('Request body for message/send');

const TaskListQuerySchema = z
    .object({
        contextId: z.string().optional().describe('Filter by context ID'),
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
            .optional()
            .describe('Filter by task state'),
        pageSize: z
            .string()
            .optional()
            .transform((v) => {
                if (!v) return undefined;
                const n = Number.parseInt(v, 10);
                // Enforce 1-100 range, return undefined for invalid values
                if (Number.isNaN(n) || n < 1 || n > 100) return undefined;
                return n;
            })
            .describe('Number of results (1-100, default 50)'),
        pageToken: z
            .string()
            .optional()
            .describe('Pagination token (not yet implemented - reserved for future use)'),
        historyLength: z
            .string()
            .optional()
            .transform((v) => {
                if (!v) return undefined;
                const n = Number.parseInt(v, 10);
                return Number.isNaN(n) ? undefined : n;
            })
            .describe('Limit history items (not yet implemented - reserved for future use)'),
        lastUpdatedAfter: z
            .string()
            .optional()
            .transform((v) => {
                if (!v) return undefined;
                const n = Number.parseInt(v, 10);
                return Number.isNaN(n) ? undefined : n;
            })
            .describe('Unix timestamp filter (not yet implemented - reserved for future use)'),
        includeArtifacts: z
            .string()
            .optional()
            .transform((v) => v === 'true')
            .describe(
                'Include artifacts in response (not yet implemented - reserved for future use)'
            ),
    })
    .describe('Query parameters for tasks/list');

/**
 * Create A2A REST Task router
 *
 * Exposes RESTful endpoints for A2A task management per v0.3.0 spec.
 *
 * Endpoints:
 * - POST   /v1/message:send        - Send message to agent
 * - POST   /v1/message:stream      - Send message with SSE streaming
 * - GET    /v1/tasks/{id}          - Get task
 * - GET    /v1/tasks               - List tasks
 * - POST   /v1/tasks/{id}:cancel   - Cancel task
 *
 * @param getAgent Function to get current DextoAgent instance
 * @param sseSubscriber SSE event subscriber for streaming
 * @returns OpenAPIHono router with REST task endpoints
 */
export function createA2ATasksRouter(getAgent: GetAgentFn, sseSubscriber: A2ASseEventSubscriber) {
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
                        schema: z
                            .object({
                                tasks: z.array(TaskSchema).describe('Array of tasks'),
                                totalSize: z.number().describe('Total number of tasks'),
                                pageSize: z.number().describe('Number of tasks in this page'),
                                nextPageToken: z.string().describe('Token for next page'),
                            })
                            .describe('Response body for tasks/list'),
                    },
                },
            },
        },
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
                id: z.string().describe('Task ID'),
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

    // POST /v1/tasks/{id}:cancel - Cancel task
    const cancelTaskRoute = createRoute({
        method: 'post',
        path: '/v1/tasks/{id}:cancel',
        summary: 'Cancel Task',
        description: 'Cancel a running task (A2A tasks/cancel)',
        tags: ['a2a'],
        request: {
            params: z.object({
                id: z.string().describe('Task ID'),
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

    // POST /v1/message:stream - Send message with streaming response
    app.post('/v1/message:stream', async (ctx) => {
        try {
            const body = await ctx.req.json();

            // Validate with Zod schema
            const parseResult = MessageSendRequestSchema.safeParse(body);
            if (!parseResult.success) {
                return ctx.json(
                    {
                        error: 'Invalid request body',
                        details: parseResult.error.issues,
                    },
                    400
                );
            }

            const validatedBody = parseResult.data;
            logger.info('REST: message/stream', { hasMessage: !!validatedBody.message });

            // Create or get session
            const taskId = validatedBody.message.taskId;
            const agent = await getAgent(ctx);
            const session = await agent.createSession(taskId);

            // Create SSE stream
            const stream = sseSubscriber.createStream(session.id);

            // Start agent processing in background
            // Note: Errors are automatically broadcast via the event bus (llm:error event)
            const { text, image, file } = a2aToInternalMessage(validatedBody.message as any);
            agent.run(text, image, file, session.id).catch((error) => {
                logger.error(`Error in streaming task ${session.id}: ${error}`);
            });

            logger.info(`REST SSE stream opened for task ${session.id}`);

            // Return stream with SSE headers
            return new Response(stream, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                    'X-Accel-Buffering': 'no',
                },
            });
        } catch (error) {
            logger.error(`Failed to handle message:stream: ${error}`);
            return ctx.json({ error: 'Failed to initiate streaming' }, 500);
        }
    });

    return app
        .openapi(messageSendRoute, async (ctx) => {
            const handlers = new A2AMethodHandlers(await getAgent(ctx));
            const body = ctx.req.valid('json');

            logger.info('REST: message/send', { hasMessage: !!body.message });

            // Type cast required: Zod infers readonly modifiers and exactOptionalPropertyTypes differs
            // from mutable handler types. Structurally compatible at runtime.
            const result = await handlers.messageSend(body as any);

            return ctx.json(result as any);
        })
        .openapi(listTasksRoute, async (ctx) => {
            const handlers = new A2AMethodHandlers(await getAgent(ctx));
            const query = ctx.req.valid('query');

            // Type cast required: Zod infers readonly modifiers and exactOptionalPropertyTypes differs
            // from mutable handler types. Structurally compatible at runtime.
            const result = await handlers.tasksList(query as any);

            return ctx.json(result);
        })
        .openapi(getTaskRoute, async (ctx) => {
            const handlers = new A2AMethodHandlers(await getAgent(ctx));
            const { id } = ctx.req.valid('param');

            try {
                const task = await handlers.tasksGet({ id });
                return ctx.json(task);
            } catch (error) {
                logger.warn(`Task ${id} not found: ${error}`);
                return ctx.json({ error: 'Task not found' }, 404);
            }
        })
        .openapi(cancelTaskRoute, async (ctx) => {
            const handlers = new A2AMethodHandlers(await getAgent(ctx));
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
}
