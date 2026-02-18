import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TurnExecutor } from './turn-executor.js';
import { ContextManager } from '../../context/manager.js';
import { ToolManager } from '../../tools/tool-manager.js';
import { SessionEventBus, AgentEventBus } from '../../events/index.js';
import { ResourceManager } from '../../resources/index.js';
import { MessageQueueService } from '../../session/message-queue.js';
import { SystemPromptManager } from '../../systemPrompt/manager.js';
import { VercelMessageFormatter } from '../formatters/vercel.js';
import { MemoryHistoryProvider } from '../../session/history/memory.js';
import { MCPManager } from '../../mcp/manager.js';
import { ApprovalManager } from '../../approval/manager.js';
import { createLogger } from '../../logger/factory.js';
import { StorageManager } from '../../storage/storage-manager.js';
import { MemoryManager } from '../../memory/index.js';
import { SystemPromptConfigSchema } from '../../systemPrompt/schemas.js';
import { createInMemoryStorageManager } from '../../test-utils/in-memory-storage.js';
import type { LanguageModel, ModelMessage } from 'ai';
import type { LLMContext } from '../types.js';
import type { ValidatedLLMConfig } from '../schemas.js';
import type { Logger } from '../../logger/v2/types.js';

// Only mock the AI SDK's streamText/generateText - everything else is real
vi.mock('ai', async (importOriginal) => {
    const actual = await importOriginal<typeof import('ai')>();
    return {
        ...actual,
        streamText: vi.fn(),
        generateText: vi.fn(),
    };
});

vi.mock('@opentelemetry/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@opentelemetry/api')>();
    return {
        ...actual,
        trace: {
            ...actual.trace,
            getActiveSpan: vi.fn(() => null),
        },
    };
});

import { streamText, generateText } from 'ai';

/**
 * Helper to create mock stream results that simulate Vercel AI SDK responses
 */
function createMockStream(options: {
    text?: string;
    finishReason?: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    providerMetadata?: Record<string, unknown>;
    toolCalls?: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>;
    reasoning?: string;
}) {
    const events: Array<{ type: string; [key: string]: unknown }> = [];

    // Add reasoning delta if present
    if (options.reasoning) {
        for (const char of options.reasoning) {
            events.push({ type: 'reasoning-delta', text: char });
        }
    }

    // Add text delta events
    if (options.text) {
        for (const char of options.text) {
            events.push({ type: 'text-delta', text: char });
        }
    }

    // Add tool call events
    if (options.toolCalls) {
        for (const tc of options.toolCalls) {
            events.push({
                type: 'tool-call',
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                args: tc.args,
            });
        }
    }

    // Add finish event
    events.push({
        type: 'finish',
        finishReason: options.finishReason ?? 'stop',
        totalUsage: options.usage ?? { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        ...(options.providerMetadata && { providerMetadata: options.providerMetadata }),
    });

    return {
        fullStream: (async function* () {
            for (const event of events) {
                yield event;
            }
        })(),
    };
}

/**
 * Creates a mock LanguageModel
 */
function createMockModel(): LanguageModel {
    return {
        modelId: 'test-model',
        provider: 'test-provider',
        specificationVersion: 'v1',
        doStream: vi.fn(),
        doGenerate: vi.fn(),
    } as unknown as LanguageModel;
}

describe('TurnExecutor Integration Tests', () => {
    let executor: TurnExecutor;
    let contextManager: ContextManager<ModelMessage>;
    let toolManager: ToolManager;
    let sessionEventBus: SessionEventBus;
    let agentEventBus: AgentEventBus;
    let resourceManager: ResourceManager;
    let messageQueue: MessageQueueService;
    let logger: Logger;
    let historyProvider: MemoryHistoryProvider;
    let mcpManager: MCPManager;
    let approvalManager: ApprovalManager;
    let storageManager: StorageManager;

    const sessionId = 'test-session';
    const llmContext: LLMContext = { provider: 'openai', model: 'gpt-4' };

    beforeEach(async () => {
        vi.clearAllMocks();

        // Create real logger
        logger = createLogger({
            config: {
                level: 'warn', // Use warn to reduce noise in tests
                transports: [{ type: 'console', colorize: false }],
            },
            agentId: 'test-agent',
        });

        // Create real event buses
        agentEventBus = new AgentEventBus();
        sessionEventBus = new SessionEventBus();

        // Create real storage manager with in-memory backends
        storageManager = await createInMemoryStorageManager(logger);

        // Create real MCP manager
        mcpManager = new MCPManager(logger, agentEventBus);

        // Create real resource manager with proper wiring
        resourceManager = new ResourceManager(
            mcpManager,
            {
                resourcesConfig: [],
                blobStore: storageManager.getBlobStore(),
            },
            agentEventBus,
            logger
        );
        await resourceManager.initialize();

        // Create real history provider
        historyProvider = new MemoryHistoryProvider(logger);

        // Create real memory manager and system prompt manager
        const memoryManager = new MemoryManager(storageManager.getDatabase(), logger);
        const systemPromptConfig = SystemPromptConfigSchema.parse('You are a helpful assistant.');
        const systemPromptManager = new SystemPromptManager(
            systemPromptConfig,
            memoryManager,
            undefined, // memoriesConfig
            logger
        );

        // Create real context manager with Vercel formatter
        const formatter = new VercelMessageFormatter(logger);
        // Cast to ValidatedLLMConfig since we know test data is valid
        const llmConfig = {
            provider: 'openai',
            model: 'gpt-4',
            apiKey: 'test-api-key',
            maxInputTokens: 100000,
            maxOutputTokens: 4096,
            temperature: 0.7,
            maxIterations: 10,
        } as unknown as ValidatedLLMConfig;

        contextManager = new ContextManager<ModelMessage>(
            llmConfig,
            formatter,
            systemPromptManager,
            100000,
            historyProvider,
            sessionId,
            resourceManager,
            logger
        );

        // Create real approval manager
        approvalManager = new ApprovalManager(
            {
                permissions: { mode: 'auto-approve', timeout: 120000 },
                elicitation: { enabled: false, timeout: 120000 },
            },
            logger
        );

        // Create real tool manager (minimal setup - no internal tools)
        const mockAllowedToolsProvider = {
            isToolAllowed: vi.fn().mockResolvedValue(false),
            allowTool: vi.fn(),
            disallowTool: vi.fn(),
        };

        toolManager = new ToolManager(
            mcpManager,
            approvalManager,
            mockAllowedToolsProvider,
            'auto-approve',
            agentEventBus,
            { alwaysAllow: [], alwaysDeny: [] },
            [],
            logger
        );
        await toolManager.initialize();

        // Create real message queue
        messageQueue = new MessageQueueService(sessionEventBus, logger);

        // Default streamText mock - simple text response
        vi.mocked(streamText).mockImplementation(
            () =>
                createMockStream({ text: 'Hello!', finishReason: 'stop' }) as unknown as ReturnType<
                    typeof streamText
                >
        );

        // Create executor with real components
        executor = new TurnExecutor(
            createMockModel(),
            toolManager,
            contextManager,
            sessionEventBus,
            resourceManager,
            sessionId,
            { maxSteps: 10, maxOutputTokens: 4096, temperature: 0.7 },
            llmContext,
            logger,
            messageQueue
        );
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        logger.destroy();
    });

    describe('Basic Execution Flow', () => {
        it('should execute and return result with real context manager', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            const result = await executor.execute({ mcpManager }, true);

            expect(result.finishReason).toBe('stop');
            expect(result.text).toBe('Hello!');
            expect(result.usage).toEqual({
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
            });
        });

        it('should persist assistant response to history', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor.execute({ mcpManager }, true);

            const history = await contextManager.getHistory();
            expect(history.length).toBeGreaterThanOrEqual(2);

            const assistantMessages = history.filter((m) => m.role === 'assistant');
            expect(assistantMessages.length).toBeGreaterThan(0);
        });

        it('should emit events through real event bus', async () => {
            const thinkingHandler = vi.fn();
            const responseHandler = vi.fn();
            const runCompleteHandler = vi.fn();

            sessionEventBus.on('llm:thinking', thinkingHandler);
            sessionEventBus.on('llm:response', responseHandler);
            sessionEventBus.on('run:complete', runCompleteHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor.execute({ mcpManager }, true);

            expect(thinkingHandler).toHaveBeenCalled();
            expect(responseHandler).toHaveBeenCalled();
            expect(runCompleteHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    finishReason: 'stop',
                    stepCount: 0,
                })
            );
        });

        it('should emit chunk events when streaming', async () => {
            const chunkHandler = vi.fn();
            sessionEventBus.on('llm:chunk', chunkHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor.execute({ mcpManager }, true);

            expect(chunkHandler).toHaveBeenCalled();
            expect(chunkHandler.mock.calls.some((call) => call[0].chunkType === 'text')).toBe(true);
        });

        it('should not emit chunk events when not streaming', async () => {
            const chunkHandler = vi.fn();
            sessionEventBus.on('llm:chunk', chunkHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor.execute({ mcpManager }, false);

            expect(chunkHandler).not.toHaveBeenCalled();
        });
    });

    describe('Multi-Step Tool Execution', () => {
        it('should continue looping on tool-calls finish reason', async () => {
            let callCount = 0;
            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                if (callCount < 3) {
                    return createMockStream({
                        text: `Step ${callCount}`,
                        finishReason: 'tool-calls',
                        toolCalls: [
                            { toolCallId: `call-${callCount}`, toolName: 'test_tool', args: {} },
                        ],
                    }) as unknown as ReturnType<typeof streamText>;
                }
                return createMockStream({
                    text: 'Final response',
                    finishReason: 'stop',
                }) as unknown as ReturnType<typeof streamText>;
            });

            await contextManager.addUserMessage([{ type: 'text', text: 'Do something' }]);
            const result = await executor.execute({ mcpManager }, true);

            expect(result.finishReason).toBe('stop');
            expect(result.stepCount).toBe(2);
            expect(callCount).toBe(3);
        });

        it('should stop at maxSteps limit', async () => {
            vi.mocked(streamText).mockImplementation(
                () =>
                    createMockStream({
                        text: 'Tool step',
                        finishReason: 'tool-calls',
                        toolCalls: [{ toolCallId: 'call-1', toolName: 'test', args: {} }],
                    }) as unknown as ReturnType<typeof streamText>
            );

            const limitedExecutor = new TurnExecutor(
                createMockModel(),
                toolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 3, maxOutputTokens: 4096, temperature: 0.7 },
                llmContext,
                logger,
                messageQueue
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Keep going' }]);
            const result = await limitedExecutor.execute({ mcpManager }, true);

            expect(result.finishReason).toBe('max-steps');
            expect(result.stepCount).toBe(3);
        });
    });

    describe('Message Queue Injection', () => {
        it('should inject queued messages into context', async () => {
            messageQueue.enqueue({
                content: [{ type: 'text', text: 'User guidance: focus on performance' }],
            });

            await contextManager.addUserMessage([{ type: 'text', text: 'Initial request' }]);
            await executor.execute({ mcpManager }, true);

            const history = await contextManager.getHistory();
            const userMessages = history.filter((m) => m.role === 'user');
            expect(userMessages.length).toBe(2);

            const injectedMsg = userMessages.find((m) => {
                const content = Array.isArray(m.content) ? m.content : [];
                return content.some((p) => p.type === 'text' && p.text.includes('User guidance'));
            });
            expect(injectedMsg).toBeDefined();
        });

        it('should continue processing when queue has messages on termination', async () => {
            let callCount = 0;
            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    messageQueue.enqueue({
                        content: [{ type: 'text', text: 'Follow-up question' }],
                    });
                    return createMockStream({
                        text: 'First response',
                        finishReason: 'stop',
                    }) as unknown as ReturnType<typeof streamText>;
                }
                return createMockStream({
                    text: 'Second response',
                    finishReason: 'stop',
                }) as unknown as ReturnType<typeof streamText>;
            });

            await contextManager.addUserMessage([{ type: 'text', text: 'Initial' }]);
            const result = await executor.execute({ mcpManager }, true);

            expect(callCount).toBe(2);
            expect(result.text).toBe('Second response');
        });
    });

    describe('Tool Support Validation', () => {
        it('should skip validation for providers without baseURL', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor.execute({ mcpManager }, true);

            expect(generateText).not.toHaveBeenCalled();
        });

        it('should validate and cache tool support for custom baseURL', async () => {
            vi.mocked(generateText).mockResolvedValue(
                {} as Awaited<ReturnType<typeof generateText>>
            );

            const executor1 = new TurnExecutor(
                createMockModel(),
                toolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10, baseURL: 'https://custom.api.com' },
                llmContext,
                logger,
                messageQueue
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor1.execute({ mcpManager }, true);

            expect(generateText).toHaveBeenCalledTimes(1);

            // Second executor with same baseURL should use cache
            const newMessageQueue = new MessageQueueService(sessionEventBus, logger);
            const executor2 = new TurnExecutor(
                createMockModel(),
                toolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                'session-2',
                { maxSteps: 10, baseURL: 'https://custom.api.com' },
                llmContext,
                logger,
                newMessageQueue
            );

            await executor2.execute({ mcpManager }, true);
            expect(generateText).toHaveBeenCalledTimes(1);
        });

        it('should use empty tools when model does not support them', async () => {
            vi.mocked(generateText).mockRejectedValue(new Error('Model does not support tools'));

            const executorWithBaseURL = new TurnExecutor(
                createMockModel(),
                toolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10, baseURL: 'https://no-tools.api.com' },
                llmContext,
                logger,
                messageQueue
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executorWithBaseURL.execute({ mcpManager }, true);

            expect(streamText).toHaveBeenCalledWith(
                expect.objectContaining({
                    tools: {},
                })
            );
        });

        it('should validate tool support for local providers even without custom baseURL', async () => {
            vi.mocked(generateText).mockRejectedValue(new Error('Model does not support tools'));

            const ollamaLlmContext = {
                provider: 'ollama' as const,
                model: 'gemma3n:e2b',
            };

            const ollamaExecutor = new TurnExecutor(
                createMockModel(),
                toolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10 }, // No baseURL
                ollamaLlmContext,
                logger,
                messageQueue
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await ollamaExecutor.execute({ mcpManager }, true);

            // Should call generateText for validation even without baseURL
            expect(generateText).toHaveBeenCalledTimes(1);

            // Should use empty tools in actual execution
            expect(streamText).toHaveBeenCalledWith(
                expect.objectContaining({
                    tools: {},
                })
            );
        });

        it('should emit llm:unsupported-input warning when model does not support tools', async () => {
            vi.mocked(generateText).mockRejectedValue(new Error('Model does not support tools'));

            const warningHandler = vi.fn();
            sessionEventBus.on('llm:unsupported-input', warningHandler);

            const executorWithBaseURL = new TurnExecutor(
                createMockModel(),
                toolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10, baseURL: 'https://no-tools.api.com' },
                llmContext,
                logger,
                messageQueue
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executorWithBaseURL.execute({ mcpManager }, true);

            expect(warningHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    errors: expect.arrayContaining([
                        expect.stringContaining('does not support tool calling'),
                        expect.stringContaining('You can still chat'),
                    ]),
                    provider: llmContext.provider,
                    model: llmContext.model,
                    details: expect.objectContaining({
                        feature: 'tool-calling',
                        supported: false,
                    }),
                })
            );
        });
    });

    describe('Error Handling', () => {
        it('should emit llm:error and run:complete on failure', async () => {
            vi.mocked(streamText).mockImplementation(() => {
                throw new Error('Stream failed');
            });

            const errorHandler = vi.fn();
            const completeHandler = vi.fn();
            sessionEventBus.on('llm:error', errorHandler);
            sessionEventBus.on('run:complete', completeHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await expect(executor.execute({ mcpManager }, true)).rejects.toThrow();

            expect(errorHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    context: 'TurnExecutor',
                    recoverable: false,
                })
            );
            expect(completeHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    finishReason: 'error',
                })
            );
        });

        it('should map rate limit errors correctly', async () => {
            const { APICallError } = await import('ai');

            // Create a real APICallError instance
            const rateLimitError = new APICallError({
                message: 'Rate limit exceeded',
                statusCode: 429,
                responseHeaders: { 'retry-after': '60' },
                responseBody: 'Rate limit exceeded',
                url: 'https://api.openai.com/v1/responses',
                requestBodyValues: {},
                isRetryable: true,
            });

            vi.mocked(streamText).mockImplementation(() => {
                throw rateLimitError;
            });

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            await expect(executor.execute({ mcpManager }, true)).rejects.toMatchObject({
                code: 'llm_rate_limit_exceeded',
                type: 'rate_limit',
            });
        });
    });

    describe('Cleanup and Resource Management', () => {
        it('should clear message queue on normal completion', async () => {
            messageQueue.enqueue({ content: [{ type: 'text', text: 'Pending' }] });

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor.execute({ mcpManager }, true);

            expect(messageQueue.dequeueAll()).toBeNull();
        });

        it('should clear message queue on error', async () => {
            messageQueue.enqueue({ content: [{ type: 'text', text: 'Pending' }] });

            vi.mocked(streamText).mockImplementation(() => {
                throw new Error('Failed');
            });

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await expect(executor.execute({ mcpManager }, true)).rejects.toThrow();

            expect(messageQueue.dequeueAll()).toBeNull();
        });
    });

    describe('External Abort Signal', () => {
        it('should handle external abort signal', async () => {
            const abortController = new AbortController();
            let callCount = 0;

            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    abortController.abort();
                    return createMockStream({
                        finishReason: 'tool-calls',
                        toolCalls: [{ toolCallId: 'call-1', toolName: 'test', args: {} }],
                    }) as unknown as ReturnType<typeof streamText>;
                }
                return createMockStream({ finishReason: 'stop' }) as unknown as ReturnType<
                    typeof streamText
                >;
            });

            const executorWithSignal = new TurnExecutor(
                createMockModel(),
                toolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10 },
                llmContext,
                logger,
                messageQueue,
                undefined,
                abortController.signal
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            const result = await executorWithSignal.execute({ mcpManager }, true);

            expect(result.finishReason).toBe('cancelled');
        });
    });

    describe('Reasoning Token Support', () => {
        it('should handle reasoning tokens in usage', async () => {
            vi.mocked(streamText).mockImplementation(
                () =>
                    createMockStream({
                        text: 'Response',
                        reasoning: 'Let me think...',
                        finishReason: 'stop',
                        usage: {
                            inputTokens: 100,
                            outputTokens: 50,
                            totalTokens: 170,
                        },
                    }) as unknown as ReturnType<typeof streamText>
            );

            const responseHandler = vi.fn();
            sessionEventBus.on('llm:response', responseHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Think about this' }]);
            const result = await executor.execute({ mcpManager }, true);

            expect(result.usage).toMatchObject({
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 170,
            });
            expect(responseHandler).toHaveBeenCalled();
        });
    });

    describe('Context Formatting', () => {
        it('should format messages correctly for LLM', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor.execute({ mcpManager }, true);

            expect(streamText).toHaveBeenCalledWith(
                expect.objectContaining({
                    messages: expect.arrayContaining([
                        expect.objectContaining({
                            role: 'user',
                        }),
                    ]),
                })
            );
        });

        it('should include system prompt in formatted messages', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor.execute({ mcpManager }, true);

            const call = vi.mocked(streamText).mock.calls[0]?.[0];
            expect(call).toBeDefined();
            expect(call?.messages).toBeDefined();

            const messages = call?.messages as ModelMessage[];
            const hasSystemContent = messages.some(
                (m) =>
                    m.role === 'system' ||
                    (m.role === 'user' &&
                        Array.isArray(m.content) &&
                        m.content.some(
                            (c) =>
                                typeof c === 'object' &&
                                'text' in c &&
                                c.text.includes('helpful assistant')
                        ))
            );
            expect(hasSystemContent).toBe(true);
        });
    });

    describe('Context Token Tracking', () => {
        it('should store actual input tokens from LLM response in ContextManager', async () => {
            const expectedInputTokens = 1234;

            vi.mocked(streamText).mockImplementation(
                () =>
                    createMockStream({
                        text: 'Response',
                        finishReason: 'stop',
                        usage: {
                            inputTokens: expectedInputTokens,
                            outputTokens: 50,
                            totalTokens: expectedInputTokens + 50,
                        },
                    }) as unknown as ReturnType<typeof streamText>
            );

            // Before LLM call, should be null
            expect(contextManager.getLastActualInputTokens()).toBeNull();

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor.execute({ mcpManager }, true);

            // After LLM call, should have the actual token count
            expect(contextManager.getLastActualInputTokens()).toBe(expectedInputTokens);
        });

        it('should update actual tokens on each LLM call', async () => {
            // First call
            vi.mocked(streamText).mockImplementationOnce(
                () =>
                    createMockStream({
                        text: 'First response',
                        finishReason: 'stop',
                        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
                    }) as unknown as ReturnType<typeof streamText>
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'First message' }]);
            await executor.execute({ mcpManager }, true);
            expect(contextManager.getLastActualInputTokens()).toBe(100);

            // Second call with different token count
            vi.mocked(streamText).mockImplementationOnce(
                () =>
                    createMockStream({
                        text: 'Second response',
                        finishReason: 'stop',
                        usage: { inputTokens: 250, outputTokens: 30, totalTokens: 280 },
                    }) as unknown as ReturnType<typeof streamText>
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Second message' }]);
            await executor.execute({ mcpManager }, true);
            expect(contextManager.getLastActualInputTokens()).toBe(250);
        });

        it('should make actual tokens available via getContextTokenEstimate', async () => {
            const expectedInputTokens = 5000;

            vi.mocked(streamText).mockImplementation(
                () =>
                    createMockStream({
                        text: 'Response',
                        finishReason: 'stop',
                        usage: {
                            inputTokens: expectedInputTokens,
                            outputTokens: 100,
                            totalTokens: expectedInputTokens + 100,
                        },
                    }) as unknown as ReturnType<typeof streamText>
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor.execute({ mcpManager }, true);

            // getContextTokenEstimate should return the actual value
            const estimate = await contextManager.getContextTokenEstimate({ mcpManager }, {});
            expect(estimate.actual).toBe(expectedInputTokens);
        });

        it('should include cached tokens in actual context input tracking', async () => {
            const noCacheTokens = 200;
            const cacheReadTokens = 800;

            vi.mocked(streamText).mockImplementation(
                () =>
                    createMockStream({
                        text: 'Response',
                        finishReason: 'stop',
                        usage: {
                            inputTokens: noCacheTokens,
                            outputTokens: 10,
                            totalTokens: noCacheTokens + 10,
                        },
                        providerMetadata: {
                            anthropic: {
                                cacheReadInputTokens: cacheReadTokens,
                                cacheCreationInputTokens: 0,
                            },
                        },
                    }) as unknown as ReturnType<typeof streamText>
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor.execute({ mcpManager }, true);

            expect(contextManager.getLastActualInputTokens()).toBe(noCacheTokens + cacheReadTokens);
        });
    });
});
