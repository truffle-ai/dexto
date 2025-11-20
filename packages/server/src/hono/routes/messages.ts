import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import type { DextoAgent } from '@dexto/core';
import type { ApprovalCoordinator } from '../../approval/approval-coordinator.js';

const MessageBodySchema = z
    .object({
        message: z.string().optional().describe('The user message text'),
        sessionId: z
            .string()
            .min(1, 'Session ID is required')
            .describe('The session to use for this message'),
        imageData: z
            .object({
                base64: z.string().describe('Base64-encoded image data'),
                mimeType: z.string().describe('The MIME type of the image (e.g., image/png)'),
            })
            .optional()
            .describe('Optional image data to include with the message'),
        fileData: z
            .object({
                base64: z.string().describe('Base64-encoded file data'),
                mimeType: z.string().describe('The MIME type of the file (e.g., application/pdf)'),
                filename: z.string().optional().describe('The filename'),
            })
            .optional()
            .describe('Optional file data to include with the message'),
    })
    .refine(
        (data) => {
            const msg = (data.message ?? '').trim();
            return msg.length > 0 || !!data.imageData || !!data.fileData;
        },
        { message: 'Must provide either message text, image data, or file data' }
    )
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
    getAgent: () => DextoAgent,
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
    app.openapi(messageRoute, async (ctx) => {
        const agent = getAgent();
        agent.logger.info('Received message via POST /api/message');
        const { message, sessionId, imageData, fileData } = ctx.req.valid('json');

        const imageDataInput = imageData
            ? { image: imageData.base64, mimeType: imageData.mimeType }
            : undefined;

        const fileDataInput = fileData
            ? {
                  data: fileData.base64,
                  mimeType: fileData.mimeType,
                  ...(fileData.filename && { filename: fileData.filename }),
              }
            : undefined;

        if (imageDataInput) agent.logger.info('Image data included in message.');
        if (fileDataInput) agent.logger.info('File data included in message.');
        agent.logger.info(`Message for session: ${sessionId}`);

        // Fire and forget - start processing asynchronously
        // Results will be delivered via SSE
        agent.run(message || '', imageDataInput, fileDataInput, sessionId, false).catch((error) => {
            agent.logger.error(
                `Error in async message processing: ${error instanceof Error ? error.message : String(error)}`
            );
        });

        return ctx.json({ accepted: true, sessionId }, 202);
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
                                tokenUsage: z
                                    .object({
                                        inputTokens: z
                                            .number()
                                            .optional()
                                            .describe('Number of input tokens'),
                                        outputTokens: z
                                            .number()
                                            .optional()
                                            .describe('Number of output tokens'),
                                        totalTokens: z
                                            .number()
                                            .optional()
                                            .describe('Total number of tokens'),
                                        reasoningTokens: z
                                            .number()
                                            .optional()
                                            .describe(
                                                'Number of reasoning tokens (for reasoning models)'
                                            ),
                                    })
                                    .optional()
                                    .describe('Token usage statistics'),
                                reasoning: z
                                    .string()
                                    .optional()
                                    .describe('Extended thinking content from reasoning models'),
                                model: z
                                    .string()
                                    .optional()
                                    .describe('Model used for this response'),
                                provider: z.string().optional().describe('LLM provider'),
                                router: z
                                    .string()
                                    .optional()
                                    .describe('Router used (e.g., vercel)'),
                            })
                            .strict(),
                    },
                },
            },
            400: { description: 'Validation error' },
        },
    });
    app.openapi(messageSyncRoute, async (ctx) => {
        const agent = getAgent();
        agent.logger.info('Received message via POST /api/message-sync');
        const { message, sessionId, imageData, fileData } = ctx.req.valid('json');

        const imageDataInput = imageData
            ? { image: imageData.base64, mimeType: imageData.mimeType }
            : undefined;

        const fileDataInput = fileData
            ? {
                  data: fileData.base64,
                  mimeType: fileData.mimeType,
                  ...(fileData.filename && { filename: fileData.filename }),
              }
            : undefined;

        if (imageDataInput) agent.logger.info('Image data included in message.');
        if (fileDataInput) agent.logger.info('File data included in message.');
        agent.logger.info(`Message for session: ${sessionId}`);

        // Use generate() instead of run() to get metadata
        const result = await agent.generate(message || '', {
            sessionId,
            imageData: imageDataInput,
            fileData: fileDataInput,
        });

        // Get the session's current LLM config to include model/provider/router info
        const llmConfig = agent.stateManager.getLLMConfig(sessionId);

        return ctx.json({
            response: result.content,
            sessionId: result.sessionId,
            tokenUsage: result.usage,
            reasoning: result.reasoning,
            model: llmConfig.model,
            provider: llmConfig.provider,
            router: 'vercel', // Hardcoded for now since we only use Vercel AI SDK
        });
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
    app.openapi(resetRoute, async (ctx) => {
        const agent = getAgent();
        agent.logger.info('Received request via POST /api/reset');
        const { sessionId } = ctx.req.valid('json');
        await agent.resetConversation(sessionId);
        return ctx.json({ status: 'reset initiated', sessionId });
    });

    if (approvalCoordinator) {
        const messageStreamRoute = createRoute({
            method: 'post',
            path: '/message-stream',
            summary: 'Stream message response',
            description:
                'Sends a message and streams the response via Server-Sent Events (SSE). Returns SSE stream directly in response.',
            tags: ['messages'],
            request: {
                body: {
                    content: { 'application/json': { schema: MessageBodySchema } },
                },
            },
            responses: {
                200: {
                    description: 'SSE stream of agent events',
                    content: {
                        'text/event-stream': {
                            schema: z.string(),
                        },
                    },
                },
                400: { description: 'Validation error' },
            },
        });

        app.openapi(messageStreamRoute, async (ctx) => {
            const agent = getAgent();
            const body = ctx.req.valid('json');

            const { message = '', sessionId, imageData, fileData } = body;

            const imageDataInput = imageData
                ? { image: imageData.base64, mimeType: imageData.mimeType }
                : undefined;

            const fileDataInput = fileData
                ? {
                      data: fileData.base64,
                      mimeType: fileData.mimeType,
                      ...(fileData.filename && { filename: fileData.filename }),
                  }
                : undefined;

            // Create abort controller for cleanup
            const abortController = new AbortController();
            const { signal } = abortController;

            // Start agent streaming
            const iterator = await agent.stream(message, {
                sessionId,
                imageData: imageDataInput,
                fileData: fileDataInput,
                signal,
            });

            // Use Hono's streamSSE helper which handles backpressure correctly
            return streamSSE(ctx, async (stream) => {
                // Store pending approval events to be written to stream
                const pendingApprovalEvents: Array<{ event: string; data: unknown }> = [];

                // Subscribe to approval events from coordinator
                approvalCoordinator.onRequest(
                    (request) => {
                        if (request.sessionId === sessionId) {
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
                        await stream.writeSSE({
                            event: event.type,
                            data: JSON.stringify(event),
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

    return app;
}
