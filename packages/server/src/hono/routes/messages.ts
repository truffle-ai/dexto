import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import type { ContentInput } from '@dexto/core';
import { LLM_PROVIDERS } from '@dexto/core';
import type { ApprovalCoordinator } from '../../approval/approval-coordinator.js';
import { TokenUsageSchema } from '../schemas/responses.js';
import type { GetAgentFn } from '../index.js';

// ContentPart schemas matching @dexto/core types
// TODO: The Zod-inferred types don't exactly match core's ContentInput due to
// exactOptionalPropertyTypes (Zod infers `mimeType?: string | undefined` vs core's `mimeType?: string`).
// We cast to ContentInput after validation. Fix by either:
// 1. Export Zod schemas from @dexto/core and reuse here
// 2. Use .transform() to convert to exact types
// 3. Relax exactOptionalPropertyTypes in tsconfig
const TextPartSchema = z
    .object({
        type: z.literal('text').describe('Content type identifier'),
        text: z.string().describe('Text content'),
    })
    .describe('Text content part');

const ImagePartSchema = z
    .object({
        type: z.literal('image').describe('Content type identifier'),
        image: z.string().describe('Base64-encoded image data or URL'),
        mimeType: z.string().optional().describe('MIME type (e.g., image/png)'),
    })
    .describe('Image content part');

const FilePartSchema = z
    .object({
        type: z.literal('file').describe('Content type identifier'),
        data: z.string().describe('Base64-encoded file data or URL'),
        mimeType: z.string().describe('MIME type (e.g., application/pdf)'),
        filename: z.string().optional().describe('Optional filename'),
    })
    .describe('File content part');

const ContentPartSchema = z
    .discriminatedUnion('type', [TextPartSchema, ImagePartSchema, FilePartSchema])
    .describe('Content part - text, image, or file');

const MessageBodySchema = z
    .object({
        content: z
            .union([z.string(), z.array(ContentPartSchema)])
            .describe('Message content - string for text, or ContentPart[] for multimodal'),
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

export function createMessagesRouter(
    getAgent: GetAgentFn,
    approvalCoordinator?: ApprovalCoordinator
) {
    const app = new OpenAPIHono();

    // TODO: Deprecate this endpoint - this async pattern is problematic and should be replaced
    // with a proper job queue or streaming-only approach. Consider removing in next major version.
    // Users should use /message/sync for synchronous responses or SSE for streaming.
    const messageRoute = createRoute({
        method: 'post',
        path: '/message',
        summary: 'Send Message (async)',
        description:
            'Sends a message and returns immediately. The full response will be sent over SSE',
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
                        schema: z
                            .object({
                                accepted: z
                                    .literal(true)
                                    .describe('Indicates request was accepted'),
                                sessionId: z.string().describe('Session ID used for this message'),
                            })
                            .strict(),
                    },
                },
            },
            400: { description: 'Validation error' },
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
                        schema: z
                            .object({
                                response: z.string().describe('Agent response text'),
                                sessionId: z.string().describe('Session ID used for this message'),
                                tokenUsage:
                                    TokenUsageSchema.optional().describe('Token usage statistics'),
                                reasoning: z
                                    .string()
                                    .optional()
                                    .describe('Extended thinking content from reasoning models'),
                                model: z
                                    .string()
                                    .optional()
                                    .describe('Model used for this response'),
                                provider: z.enum(LLM_PROVIDERS).optional().describe('LLM provider'),
                            })
                            .strict(),
                    },
                },
            },
            400: { description: 'Validation error' },
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
                        schema: z
                            .object({
                                status: z
                                    .string()
                                    .describe('Status message indicating reset was initiated'),
                                sessionId: z.string().describe('Session ID that was reset'),
                            })
                            .strict(),
                    },
                },
            },
        },
    });

    const messageStreamRoute = createRoute({
        method: 'post',
        path: '/message-stream',
        summary: 'Stream message response',
        description:
            'Sends a message and streams the response via Server-Sent Events (SSE). Returns SSE stream directly in response. Events include llm:thinking, llm:chunk, llm:tool-call, llm:tool-result, llm:response, and llm:error. If the session is busy processing another message, returns 202 with queue information.',
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
                                'Server-Sent Events stream. Events: llm:thinking (start), llm:chunk (text fragments), llm:tool-call (tool execution), llm:tool-result (tool output), llm:response (final), llm:error (errors)'
                            ),
                    },
                },
            },
            202: {
                description:
                    'Session is busy processing another message. Use the queue endpoints to manage pending messages.',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                busy: z.literal(true).describe('Indicates session is busy'),
                                sessionId: z.string().describe('The session ID'),
                                queueLength: z
                                    .number()
                                    .describe('Current number of messages in queue'),
                                hint: z.string().describe('Instructions for the client'),
                            })
                            .strict(),
                    },
                },
            },
            400: { description: 'Validation error' },
        },
    });

    return app
        .openapi(messageRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            agent.logger.info('Received message via POST /api/message');
            const { content, sessionId } = ctx.req.valid('json');

            agent.logger.info(`Message for session: ${sessionId}`);

            // Fire and forget - start processing asynchronously
            // Results will be delivered via SSE
            agent.generate(content as ContentInput, sessionId).catch((error) => {
                agent.logger.error(
                    `Error in async message processing: ${error instanceof Error ? error.message : String(error)}`
                );
            });

            return ctx.json({ accepted: true, sessionId }, 202);
        })
        .openapi(messageSyncRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            agent.logger.info('Received message via POST /api/message-sync');
            const { content, sessionId } = ctx.req.valid('json');

            agent.logger.info(`Message for session: ${sessionId}`);

            const result = await agent.generate(content as ContentInput, sessionId);

            // Get the session's current LLM config to include model/provider info
            const llmConfig = agent.stateManager.getLLMConfig(sessionId);

            return ctx.json({
                response: result.content,
                sessionId: result.sessionId,
                tokenUsage: result.usage,
                reasoning: result.reasoning,
                model: llmConfig.model,
                provider: llmConfig.provider,
            });
        })
        .openapi(resetRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            agent.logger.info('Received request via POST /api/reset');
            const { sessionId } = ctx.req.valid('json');
            await agent.resetConversation(sessionId);
            return ctx.json({ status: 'reset initiated', sessionId });
        })
        .openapi(messageStreamRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { content, sessionId } = ctx.req.valid('json');

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

            // Start agent streaming
            const iterator = await agent.stream(content as ContentInput, sessionId, { signal });

            // Use Hono's streamSSE helper which handles backpressure correctly
            return streamSSE(ctx, async (stream) => {
                // Store pending approval events to be written to stream (only if coordinator available)
                const pendingApprovalEvents: Array<{ event: string; data: unknown }> = [];

                // Subscribe to approval events from coordinator (if available)
                if (approvalCoordinator) {
                    approvalCoordinator.onRequest(
                        (request) => {
                            if (request.sessionId === sessionId) {
                                // No transformation needed - SSE uses 'name' discriminant, payload keeps 'type'
                                pendingApprovalEvents.push({
                                    event: 'approval:request',
                                    data: request,
                                });
                            }
                        },
                        { signal }
                    );

                    approvalCoordinator.onResponse(
                        (response) => {
                            if (response.sessionId === sessionId) {
                                pendingApprovalEvents.push({
                                    event: 'approval:response',
                                    data: response,
                                });
                            }
                        },
                        { signal }
                    );
                }

                try {
                    // Stream LLM/tool events from iterator
                    for await (const event of iterator) {
                        // First, write any pending approval events
                        while (pendingApprovalEvents.length > 0) {
                            const approvalEvent = pendingApprovalEvents.shift()!;
                            await stream.writeSSE({
                                event: approvalEvent.event,
                                data: JSON.stringify(approvalEvent.data),
                            });
                        }

                        // Then write the LLM/tool event
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
                        await stream.writeSSE({
                            event: event.name,
                            data: JSON.stringify(eventData),
                        });
                    }

                    // Write any remaining approval events
                    while (pendingApprovalEvents.length > 0) {
                        const approvalEvent = pendingApprovalEvents.shift()!;
                        await stream.writeSSE({
                            event: approvalEvent.event,
                            data: JSON.stringify(approvalEvent.data),
                        });
                    }
                } catch (error) {
                    await stream.writeSSE({
                        event: 'llm:error',
                        data: JSON.stringify({
                            error: {
                                message: error instanceof Error ? error.message : String(error),
                            },
                            recoverable: false,
                            sessionId,
                        }),
                    });
                } finally {
                    abortController.abort(); // Cleanup subscriptions
                }
            });
        });
}
