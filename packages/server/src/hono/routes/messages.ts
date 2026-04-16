import { OpenAPIHono, createRoute, type RouteConfigToTypedResponse, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import type { ToSchema } from 'hono/types';
import { HostRuntimeContextSchema, LLM_PROVIDERS, type StreamingEvent } from '@dexto/core';
import {
    ApiErrorResponseSchema,
    BadRequestErrorResponse,
    InternalErrorResponse,
    NotFoundErrorResponse,
    PricingStatusSchema,
    RequestContentSchema,
    TokenUsageSchema,
    toContentInput,
} from '../schemas/responses.js';
import type { GetAgentFn } from '../types.js';

const MessageBodySchema = z
    .object({
        content: RequestContentSchema,
        sessionId: z
            .string()
            .min(1, 'Session ID is required')
            .describe('The session to use for this message'),
    })
    .describe('Request body for sending a message to the agent');

const ResetBodySchema = z
    .object({
        sessionId: z
            .string()
            .min(1, 'Session ID is required')
            .describe('The ID of the session to reset'),
    })
    .describe('Request body for resetting a conversation');

const MessageAcceptedResponseSchema = z
    .object({
        accepted: z.literal(true).describe('Indicates request was accepted'),
        sessionId: z.string().describe('Session ID used for this message'),
    })
    .strict()
    .describe('Asynchronous message acceptance response');

const MessageSyncResponseSchema = z
    .object({
        response: z.string().describe('Agent response text'),
        sessionId: z.string().describe('Session ID used for this message'),
        tokenUsage: TokenUsageSchema.optional().describe('Token usage statistics'),
        messageId: z.string().uuid().optional().describe('Assistant message ID for this response'),
        usageScopeId: z
            .string()
            .optional()
            .describe('Optional usage scope identifier for runtime-scoped metering'),
        estimatedCost: z
            .number()
            .nonnegative()
            .optional()
            .describe('Estimated cost in USD for this response'),
        pricingStatus: PricingStatusSchema.optional().describe(
            'Whether pricing was resolved for this response'
        ),
        reasoning: z
            .string()
            .optional()
            .describe('Extended thinking content from reasoning models'),
        model: z.string().optional().describe('Model used for this response'),
        provider: z.enum(LLM_PROVIDERS).optional().describe('LLM provider'),
        hostRuntime: HostRuntimeContextSchema.optional().describe(
            'Host-owned runtime IDs surfaced by core runtime flows'
        ),
    })
    .strict()
    .describe('Synchronous message response');

const ResetResponseSchema = z
    .object({
        status: z.string().describe('Status message indicating reset was initiated'),
        sessionId: z.string().describe('Session ID that was reset'),
    })
    .strict()
    .describe('Session reset response');

const MessageStreamBusyResponseSchema = z
    .object({
        busy: z.literal(true).describe('Indicates session is busy'),
        sessionId: z.string().describe('The session ID'),
        queueLength: z.number().describe('Current number of messages in queue'),
        hint: z.string().describe('Instructions for the client'),
    })
    .strict()
    .describe('Busy response for streaming requests');

const messageRoute = createRoute({
    method: 'post',
    path: '/message',
    summary: 'Send Message (async)',
    description: 'Sends a message and returns immediately. The full response will be sent over SSE',
    tags: ['messages'],
    request: {
        body: {
            content: { 'application/json': { schema: MessageBodySchema } },
        },
    },
    responses: {
        202: {
            description: 'Message accepted for async processing; subscribe to SSE for results',
            content: {
                'application/json': {
                    schema: MessageAcceptedResponseSchema,
                },
            },
        },
        400: {
            description: 'Validation error',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        500: InternalErrorResponse,
    },
});

const messageSyncRoute = createRoute({
    method: 'post',
    path: '/message-sync',
    summary: 'Send Message (sync)',
    description: 'Sends a message and waits for the full response',
    tags: ['messages'],
    request: {
        body: { content: { 'application/json': { schema: MessageBodySchema } } },
    },
    responses: {
        200: {
            description: 'Synchronous response',
            content: {
                'application/json': {
                    schema: MessageSyncResponseSchema,
                },
            },
        },
        400: {
            description: 'Validation error',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        500: InternalErrorResponse,
    },
});

const resetRoute = createRoute({
    method: 'post',
    path: '/reset',
    summary: 'Reset Conversation',
    description: 'Resets the conversation history for a given session',
    tags: ['messages'],
    request: {
        body: { content: { 'application/json': { schema: ResetBodySchema } } },
    },
    responses: {
        200: {
            description: 'Reset initiated',
            content: {
                'application/json': {
                    schema: ResetResponseSchema,
                },
            },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        500: InternalErrorResponse,
    },
});

const messageStreamRoute = createRoute({
    method: 'post',
    path: '/message-stream',
    summary: 'Stream message response',
    description:
        'Sends a message and streams the response via Server-Sent Events (SSE). Returns SSE stream directly in response. Events include llm:thinking, llm:chunk, llm:tool-call, llm:tool-result, llm:response, and llm:error. Final llm:response events include token usage, assistant message ID, and pricing metadata when available. If the session is busy processing another message, returns 202 with queue information.',
    tags: ['messages'],
    request: {
        body: {
            content: { 'application/json': { schema: MessageBodySchema } },
        },
    },
    responses: {
        200: {
            description:
                'SSE stream of agent events. Standard SSE format with event type and JSON data.',
            headers: {
                'Content-Type': {
                    description: 'SSE content type',
                    schema: { type: 'string', example: 'text/event-stream' },
                },
                'Cache-Control': {
                    description: 'Disable caching for stream',
                    schema: { type: 'string', example: 'no-cache' },
                },
                Connection: {
                    description: 'Keep connection alive for streaming',
                    schema: { type: 'string', example: 'keep-alive' },
                },
                'X-Accel-Buffering': {
                    description: 'Disable nginx buffering',
                    schema: { type: 'string', example: 'no' },
                },
            },
            content: {
                'text/event-stream': {
                    schema: z
                        .string()
                        .describe(
                            'Server-Sent Events stream. Events: llm:thinking (start), llm:chunk (text fragments), llm:tool-call (tool execution), llm:tool-result (tool output), llm:response (final), llm:error (errors)' +
                                '. Final llm:response payloads include token usage, assistant message ID, and pricing metadata when available.'
                        ),
                },
            },
        },
        202: {
            description:
                'Session is busy processing another message. Use the queue endpoints to manage pending messages.',
            content: {
                'application/json': {
                    schema: MessageStreamBusyResponseSchema,
                },
            },
        },
        400: {
            description: 'Validation error',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        500: InternalErrorResponse,
    },
});

export function createMessagesRouter(getAgent: GetAgentFn, _approvalCoordinator?: unknown) {
    const app = new OpenAPIHono();

    return app
        .openapi(messageRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            agent.logger.info('Received message via POST /api/message');
            const { content: rawContent, sessionId } = ctx.req.valid('json');
            const content = toContentInput(rawContent);

            agent.logger.info(`Message for session: ${sessionId}`);

            // Fire and forget - start processing asynchronously
            // Results will be delivered via SSE
            agent.generate(content, sessionId).catch((error) => {
                agent.logger.error(
                    `Error in async message processing: ${error instanceof Error ? error.message : String(error)}`
                );
            });

            return ctx.json({ accepted: true as const, sessionId }, 202);
        })
        .openapi(messageSyncRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            agent.logger.info('Received message via POST /api/message-sync');
            const { content: rawContent, sessionId } = ctx.req.valid('json');
            const content = toContentInput(rawContent);

            agent.logger.info(`Message for session: ${sessionId}`);

            const result = await agent.generate(content, sessionId);

            return ctx.json(
                {
                    response: result.content,
                    sessionId: result.sessionId,
                    tokenUsage: result.usage,
                    messageId: result.messageId,
                    usageScopeId: result.usageScopeId,
                    estimatedCost: result.estimatedCost,
                    pricingStatus: result.pricingStatus,
                    reasoning: result.reasoning,
                    model: result.model,
                    provider: result.provider,
                    hostRuntime: result.hostRuntime,
                },
                200
            );
        })
        .openapi(resetRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            agent.logger.info('Received request via POST /api/reset');
            const { sessionId } = ctx.req.valid('json');
            await agent.resetConversation(sessionId);
            return ctx.json({ status: 'reset initiated', sessionId }, 200);
        })
        .openapi(messageStreamRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { content: rawContent, sessionId } = ctx.req.valid('json');
            const content = toContentInput(rawContent);

            // Check if session is busy before starting stream
            const isBusy = await agent.isSessionBusy(sessionId);
            if (isBusy) {
                const queuedMessages = await agent.getQueuedMessages(sessionId);
                return ctx.json(
                    {
                        busy: true as const,
                        sessionId,
                        queueLength: queuedMessages.length,
                        hint: 'Use POST /api/queue/{sessionId} to queue this message, or wait for the current request to complete.',
                    },
                    202
                );
            }

            // Create abort controller for cleanup
            const abortController = new AbortController();
            const { signal } = abortController;
            const requestDisconnectSignal = ctx.req.raw.signal;

            // Keep the underlying run alive if the browser disconnects so approvals and
            // completion can survive reloads. The disconnect signal only stops relaying
            // events to this SSE response.
            // TODO: This only preserves resumability while the current agent process stays
            // alive. To survive agent/server restarts, persist a resumable run checkpoint
            // for approval-blocked turns and resume from storage after approval.
            const streamWithDisconnectSignal = agent.stream.bind(agent) as (
                content: Parameters<typeof agent.stream>[0],
                sessionId: string,
                options: Parameters<typeof agent.stream>[2] & { disconnectSignal?: AbortSignal }
            ) => Promise<AsyncIterableIterator<StreamingEvent>>;
            const iterator = await streamWithDisconnectSignal(content, sessionId, {
                disconnectSignal: signal,
            });

            // Use Hono's streamSSE helper which handles backpressure correctly
            return streamSSE(ctx, async (stream) => {
                const abortOnDisconnect = () => {
                    abortController.abort();
                };
                stream.onAbort(abortOnDisconnect);
                requestDisconnectSignal.addEventListener('abort', abortOnDisconnect, {
                    once: true,
                });
                if (requestDisconnectSignal.aborted) {
                    abortOnDisconnect();
                }

                let writeChain = Promise.resolve();
                const enqueueSSEWrite = (event: string, data: unknown) => {
                    writeChain = writeChain
                        .then(async () => {
                            if (signal.aborted) {
                                return;
                            }
                            await stream.writeSSE({
                                event,
                                data: JSON.stringify(data),
                            });
                        })
                        .catch((error) => {
                            if (!signal.aborted) {
                                agent.logger.warn(
                                    `Failed to write SSE event '${event}': ${
                                        error instanceof Error ? error.message : String(error)
                                    }`
                                );
                            }
                        });

                    return writeChain;
                };

                try {
                    // Stream LLM/tool events from iterator
                    for await (const event of iterator) {
                        // Serialize errors properly since Error objects don't JSON.stringify well
                        const eventData =
                            event.name === 'llm:error' && event.error instanceof Error
                                ? {
                                      ...event,
                                      error: {
                                          message: event.error.message,
                                          name: event.error.name,
                                          stack: event.error.stack,
                                      },
                                  }
                                : event;
                        await enqueueSSEWrite(event.name, eventData);
                    }
                } catch (error) {
                    await enqueueSSEWrite('llm:error', {
                        error: {
                            message: error instanceof Error ? error.message : String(error),
                        },
                        recoverable: false,
                        sessionId,
                    });
                } finally {
                    requestDisconnectSignal.removeEventListener('abort', abortOnDisconnect);
                    abortController.abort(); // Cleanup subscriptions
                    await writeChain;
                }
            });
        });
}

type MessageRouteSchema = ToSchema<
    'post',
    '/message',
    { json: z.input<typeof MessageBodySchema> },
    RouteConfigToTypedResponse<typeof messageRoute>
>;

type MessageSyncRouteSchema = ToSchema<
    'post',
    '/message-sync',
    { json: z.input<typeof MessageBodySchema> },
    RouteConfigToTypedResponse<typeof messageSyncRoute>
>;

type ResetRouteSchema = ToSchema<
    'post',
    '/reset',
    { json: z.input<typeof ResetBodySchema> },
    RouteConfigToTypedResponse<typeof resetRoute>
>;

type MessageStreamRouteSchema = ToSchema<
    'post',
    '/message-stream',
    { json: z.input<typeof MessageBodySchema> },
    RouteConfigToTypedResponse<typeof messageStreamRoute>
>;

export type MessagesRouterSchema =
    | MessageRouteSchema
    | MessageSyncRouteSchema
    | ResetRouteSchema
    | MessageStreamRouteSchema;
