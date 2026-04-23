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
import type { ListTasksParams, Message, MessageSendParams, Part } from '../../a2a/types.js';
import type { Context } from 'hono';
import {
    BadRequestErrorResponse,
    InternalErrorResponse,
    JsonObjectSchema,
} from '../schemas/responses.js';
type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

// Mount subrouters through a tiny helper so declaration emit does not explode on
// repeated `app.openapi(...)` / `app.route(...)` generic expansion in this file.
// See: https://github.com/honojs/hono/issues/2399
function mountA2ATasksSubrouter(app: OpenAPIHono, router: OpenAPIHono) {
    app.route('/', router);
}

// Request/Response Schemas for OpenAPI (using A2A-compliant schema)

const PartSchema = z
    .discriminatedUnion('kind', [
        z.object({
            kind: z.literal('text').describe('Part type discriminator'),
            text: z.string().describe('Text content'),
            metadata: JsonObjectSchema.optional().describe('Extension metadata'),
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
            metadata: JsonObjectSchema.optional().describe('Extension metadata'),
        }),
        z.object({
            kind: z.literal('data').describe('Part type discriminator'),
            data: JsonObjectSchema.describe('Structured JSON data'),
            metadata: JsonObjectSchema.optional().describe('Extension metadata'),
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
        metadata: JsonObjectSchema.optional().describe('Extension metadata'),
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

const ArtifactSchema = z
    .object({
        artifactId: z.string().describe('Unique artifact ID'),
        name: z.string().optional().describe('Artifact name'),
        description: z.string().optional().describe('Artifact description'),
        parts: z.array(PartSchema).describe('Artifact content parts'),
        metadata: JsonObjectSchema.optional().describe('Extension metadata'),
        extensions: z.array(z.string()).optional().describe('Extension identifiers'),
    })
    .describe('A2A protocol artifact');

const TaskSchema = z
    .object({
        id: z.string().describe('Unique task identifier'),
        contextId: z.string().describe('Context identifier across related tasks'),
        status: TaskStatusSchema.describe('Current task status'),
        history: z.array(MessageSchema).optional().describe('Conversation history'),
        artifacts: z.array(ArtifactSchema).optional().describe('Task artifacts'),
        metadata: JsonObjectSchema.optional().describe('Extension metadata'),
        kind: z.literal('task').describe('Object type discriminator'),
    })
    .describe('A2A Protocol task');

type TaskResponse = z.output<typeof TaskSchema>;
type MessageInput = z.output<typeof MessageSchema>;
type PartInput = z.output<typeof PartSchema>;

const TasksListResponseSchema = z
    .object({
        tasks: z.array(TaskSchema).describe('Array of tasks'),
        totalSize: z.number().describe('Total number of tasks'),
        pageSize: z.number().describe('Number of tasks in this page'),
        nextPageToken: z.string().describe('Token for next page'),
    })
    .describe('Response body for tasks/list');

type TasksListResponse = z.output<typeof TasksListResponseSchema>;

const TaskErrorResponseSchema = z
    .object({
        error: z.string().describe('Task error message'),
    })
    .strict()
    .describe('A2A task error response');

type TaskErrorResponse = z.output<typeof TaskErrorResponseSchema>;
type MessageSendRequest = z.output<typeof MessageSendRequestSchema>;
type TaskListQuery = z.output<typeof TaskListQuerySchema>;

// TODO: Replace these boundary conversion helpers with canonical A2A SDK types once
// the server and protocol layer share one source of truth for exact optional fields.
function toA2APart(part: PartInput): Part {
    switch (part.kind) {
        case 'text':
            return {
                kind: 'text',
                text: part.text,
                ...(part.metadata !== undefined ? { metadata: part.metadata } : {}),
            };
        case 'file': {
            const file =
                'bytes' in part.file
                    ? {
                          bytes: part.file.bytes,
                          ...(part.file.name !== undefined ? { name: part.file.name } : {}),
                          ...(part.file.mimeType !== undefined
                              ? { mimeType: part.file.mimeType }
                              : {}),
                      }
                    : {
                          uri: part.file.uri,
                          ...(part.file.name !== undefined ? { name: part.file.name } : {}),
                          ...(part.file.mimeType !== undefined
                              ? { mimeType: part.file.mimeType }
                              : {}),
                      };
            return {
                kind: 'file',
                file,
                ...(part.metadata !== undefined ? { metadata: part.metadata } : {}),
            };
        }
        case 'data':
            return {
                kind: 'data',
                data: part.data,
                ...(part.metadata !== undefined ? { metadata: part.metadata } : {}),
            };
    }
}

function toA2AMessage(message: MessageInput): Message {
    return {
        role: message.role,
        parts: message.parts.map(toA2APart),
        messageId: message.messageId,
        kind: 'message',
        ...(message.taskId !== undefined ? { taskId: message.taskId } : {}),
        ...(message.contextId !== undefined ? { contextId: message.contextId } : {}),
        ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
        ...(message.extensions !== undefined ? { extensions: message.extensions } : {}),
        ...(message.referenceTaskIds !== undefined
            ? { referenceTaskIds: message.referenceTaskIds }
            : {}),
    };
}

function toMessageSendParams(body: MessageSendRequest): MessageSendParams {
    const pushNotificationConfig = body.configuration?.pushNotificationConfig
        ? {
              url: body.configuration.pushNotificationConfig.url,
              ...(body.configuration.pushNotificationConfig.headers !== undefined
                  ? { headers: body.configuration.pushNotificationConfig.headers }
                  : {}),
          }
        : undefined;

    const configuration = body.configuration
        ? {
              ...(body.configuration.acceptedOutputModes !== undefined
                  ? { acceptedOutputModes: body.configuration.acceptedOutputModes }
                  : {}),
              ...(body.configuration.historyLength !== undefined
                  ? { historyLength: body.configuration.historyLength }
                  : {}),
              ...(pushNotificationConfig !== undefined ? { pushNotificationConfig } : {}),
              ...(body.configuration.blocking !== undefined
                  ? { blocking: body.configuration.blocking }
                  : {}),
          }
        : undefined;

    return {
        message: toA2AMessage(body.message),
        ...(configuration !== undefined ? { configuration } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    };
}

function toListTasksParams(query: TaskListQuery): ListTasksParams {
    return {
        ...(query.contextId !== undefined ? { contextId: query.contextId } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.pageToken !== undefined ? { pageToken: query.pageToken } : {}),
        ...(query.historyLength !== undefined ? { historyLength: query.historyLength } : {}),
        ...(query.lastUpdatedAfter !== undefined
            ? { lastUpdatedAfter: query.lastUpdatedAfter }
            : {}),
        ...(query.includeArtifacts !== undefined
            ? { includeArtifacts: query.includeArtifacts }
            : {}),
    };
}

function readCancelTaskParam(value: object): string | undefined {
    if (Object.prototype.hasOwnProperty.call(value, 'id')) {
        return undefined;
    }

    const raw = Object.entries(value).find(
        ([key, candidate]) => key === 'id:cancel' && typeof candidate === 'string'
    )?.[1];
    return typeof raw === 'string' ? raw : undefined;
}

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
                            .record(z.string(), z.string())
                            .optional()
                            .describe('HTTP headers for webhook'),
                    })
                    .optional()
                    .describe('Push notification configuration'),
                blocking: z.boolean().optional().describe('Wait for task completion'),
            })
            .optional()
            .describe('Optional configuration'),
        metadata: JsonObjectSchema.optional().describe('Optional metadata'),
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
export function createA2ATasksRouter(
    getAgent: GetAgentFn,
    sseSubscriber: A2ASseEventSubscriber
): OpenAPIHono {
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
            400: BadRequestErrorResponse,
            500: InternalErrorResponse,
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
                        schema: TasksListResponseSchema,
                    },
                },
            },
            400: BadRequestErrorResponse,
            500: InternalErrorResponse,
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
                content: {
                    'application/json': {
                        schema: TaskErrorResponseSchema,
                    },
                },
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
            params: z.preprocess(
                (value) => {
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        const raw = readCancelTaskParam(value);
                        if (raw !== undefined) {
                            return {
                                id: raw.endsWith(':cancel') ? raw.slice(0, -':cancel'.length) : raw,
                            };
                        }
                    }
                    return value;
                },
                z.object({
                    id: z.string().describe('Task ID'),
                })
            ),
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
                content: {
                    'application/json': {
                        schema: TaskErrorResponseSchema,
                    },
                },
            },
        },
    });

    // POST /v1/message:stream - Send message with streaming response
    // eslint-disable-next-line dexto-custom/require-openapi-route-contract -- SSE transport endpoint is an explicit protocol exception and is not documented as a normal JSON route.
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
            const { text, image, file } = a2aToInternalMessage(toA2AMessage(validatedBody.message));
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

    const messageSendRouter = new OpenAPIHono().openapi(messageSendRoute, async (ctx) => {
        const handlers = new A2AMethodHandlers(await getAgent(ctx));
        const body = ctx.req.valid('json');

        logger.info('REST: message/send', { hasMessage: !!body.message });

        const result = await handlers.messageSend(toMessageSendParams(body));
        const response: TaskResponse = result;
        return ctx.json(response, 200);
    });

    const listTasksRouter = new OpenAPIHono().openapi(listTasksRoute, async (ctx) => {
        const handlers = new A2AMethodHandlers(await getAgent(ctx));
        const query = ctx.req.valid('query');

        const result = await handlers.tasksList(toListTasksParams(query));

        const response: TasksListResponse = result;
        return ctx.json(response, 200);
    });

    const getTaskRouter = new OpenAPIHono().openapi(getTaskRoute, async (ctx) => {
        const handlers = new A2AMethodHandlers(await getAgent(ctx));
        const { id } = ctx.req.valid('param');

        try {
            const task = await handlers.tasksGet({ id });
            const response: TaskResponse = task;
            return ctx.json(response, 200);
        } catch (error) {
            logger.warn(`Task ${id} not found: ${error}`);
            const response: TaskErrorResponse = { error: 'Task not found' };
            return ctx.json(response, 404);
        }
    });

    const cancelTaskRouter = new OpenAPIHono().openapi(cancelTaskRoute, async (ctx) => {
        const handlers = new A2AMethodHandlers(await getAgent(ctx));
        const { id } = ctx.req.valid('param');

        logger.info(`REST: tasks/cancel ${id}`);

        try {
            const task = await handlers.tasksCancel({ id });
            const response: TaskResponse = task;
            return ctx.json(response, 200);
        } catch (error) {
            logger.error(`Failed to cancel task ${id}: ${error}`);
            const response: TaskErrorResponse = { error: 'Task not found' };
            return ctx.json(response, 404);
        }
    });

    mountA2ATasksSubrouter(app, messageSendRouter);
    mountA2ATasksSubrouter(app, listTasksRouter);
    mountA2ATasksSubrouter(app, getTaskRouter);
    mountA2ATasksSubrouter(app, cancelTaskRouter);

    return app;
}
