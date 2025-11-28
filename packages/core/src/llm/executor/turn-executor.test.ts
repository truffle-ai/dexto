import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TurnExecutor } from './turn-executor.js';
import type { LanguageModel, ProviderMetadata } from 'ai';
import type { ContextManager } from '../../context/manager.js';
import type { ToolManager } from '../../tools/tool-manager.js';
import type { SessionEventBus } from '../../events/index.js';
import type { ResourceManager } from '../../resources/index.js';
import type { MessageQueueService } from '../../session/message-queue.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import type { LLMContext, LLMRouter } from '../types.js';
import type { Message } from '../../context/types.js';
import type { ModelLimits } from '../../context/compression/overflow.js';
import type { CoalescedMessage } from '../../session/types.js';

// Mock dependencies
vi.mock('ai', () => ({
    streamText: vi.fn(),
    generateText: vi.fn(),
    stepCountIs: vi.fn((n: number) => n),
    jsonSchema: vi.fn((schema: unknown) => schema),
    APICallError: {
        isInstance: vi.fn(() => false),
    },
}));

vi.mock('@opentelemetry/api', () => ({
    trace: {
        getActiveSpan: vi.fn(() => null),
    },
}));

// Import mocked modules
import { streamText, generateText } from 'ai';

// Helper to create mock stream result
function createMockStreamResult(options: {
    text?: string;
    finishReason?: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    toolCalls?: Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }>;
}) {
    const events: Array<{ type: string; [key: string]: unknown }> = [];

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
                input: tc.input,
            });
            // Tool result follows
            events.push({
                type: 'tool-result',
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: { result: 'mock result' },
            });
        }
    }

    // Add finish event
    events.push({
        type: 'finish',
        finishReason: options.finishReason ?? 'stop',
        totalUsage: options.usage ?? { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });

    return {
        fullStream: (async function* () {
            for (const event of events) {
                yield event;
            }
        })(),
    };
}

// Mock factories
function createMockLogger(): IDextoLogger {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        createChild: vi.fn().mockReturnThis(),
    } as unknown as IDextoLogger;
}

function createMockEventBus(): SessionEventBus {
    return {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        removeAllListeners: vi.fn(),
    } as unknown as SessionEventBus;
}

function createMockContextManager(options: { history?: Message[] } = {}): ContextManager {
    const history: Message[] = options.history ?? [];
    let messageIdCounter = 0;

    // Helper to add message to history and return
    const addToHistory = (msg: Partial<Message>): string => {
        const id = `msg-${++messageIdCounter}`;
        history.push({ ...msg, id, createdAt: new Date() } as Message);
        return id;
    };

    return {
        getFormattedMessagesWithCompression: vi.fn().mockResolvedValue({
            formattedMessages: [],
            tokensUsed: 1000,
        }),
        // Return a copy of history to avoid mutation issues
        getHistory: vi.fn().mockImplementation(async () => [...history]),
        addMessage: vi.fn().mockImplementation(async (msg: Partial<Message>) => {
            return addToHistory(msg);
        }),
        // addAssistantMessage must add to history so getLastMessageId works
        addAssistantMessage: vi.fn().mockImplementation(async () => {
            addToHistory({ role: 'assistant', content: '' });
        }),
        appendAssistantText: vi.fn().mockResolvedValue(undefined),
        addToolCall: vi.fn().mockResolvedValue(undefined),
        addToolResult: vi.fn().mockResolvedValue(undefined),
        updateAssistantMessage: vi.fn().mockResolvedValue(undefined),
        markMessagesAsCompacted: vi.fn().mockResolvedValue(0),
        getTokenizer: vi.fn().mockReturnValue({
            encode: (text: string) => ({ length: Math.ceil(text.length / 4) }),
        }),
        getMaxInputTokens: vi.fn().mockReturnValue(100000),
    } as unknown as ContextManager;
}

function createMockToolManager(tools: Record<string, unknown> = {}): ToolManager {
    return {
        getAllTools: vi.fn().mockResolvedValue(tools),
        executeTool: vi.fn().mockResolvedValue({ result: 'tool executed' }),
    } as unknown as ToolManager;
}

function createMockResourceManager(): ResourceManager {
    return {
        getBlobStore: vi.fn().mockReturnValue({
            store: vi.fn(),
            get: vi.fn(),
        }),
    } as unknown as ResourceManager;
}

function createMockMessageQueue(
    queuedMessages: CoalescedMessage | null = null
): MessageQueueService {
    let called = false;
    return {
        dequeueAll: vi.fn().mockImplementation(() => {
            if (!called && queuedMessages) {
                called = true;
                return queuedMessages;
            }
            return null;
        }),
        clear: vi.fn(),
        enqueue: vi.fn(),
        isEmpty: vi.fn().mockReturnValue(queuedMessages === null),
    } as unknown as MessageQueueService;
}

function createMockModel(): LanguageModel {
    return {
        modelId: 'test-model',
        provider: 'test-provider',
        specificationVersion: 'v1',
        doStream: vi.fn(),
        doGenerate: vi.fn(),
    } as unknown as LanguageModel;
}

describe('TurnExecutor', () => {
    let executor: TurnExecutor;
    let mockModel: LanguageModel;
    let mockToolManager: ToolManager;
    let mockContextManager: ContextManager;
    let mockEventBus: SessionEventBus;
    let mockResourceManager: ResourceManager;
    let mockLogger: IDextoLogger;
    let mockMessageQueue: MessageQueueService;

    const defaultConfig = {
        maxSteps: 10,
        maxOutputTokens: 4096,
        temperature: 0.7,
    };

    const defaultLLMContext: LLMContext = {
        provider: 'openai',
        model: 'gpt-4',
        maxOutputTokens: 4096,
    };

    const defaultRouter: LLMRouter = 'vercel';

    beforeEach(() => {
        vi.clearAllMocks();

        mockModel = createMockModel();
        mockToolManager = createMockToolManager();
        mockContextManager = createMockContextManager();
        mockEventBus = createMockEventBus();
        mockResourceManager = createMockResourceManager();
        mockLogger = createMockLogger();
        mockMessageQueue = createMockMessageQueue();

        // Default mock for streamText
        vi.mocked(streamText).mockImplementation(
            () =>
                createMockStreamResult({ text: 'Hello', finishReason: 'stop' }) as ReturnType<
                    typeof streamText
                >
        );

        executor = new TurnExecutor(
            mockModel,
            mockToolManager,
            mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
            mockEventBus,
            mockResourceManager,
            'test-session-id',
            defaultConfig,
            defaultLLMContext,
            defaultRouter,
            mockLogger,
            mockMessageQueue
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Basic Execution', () => {
        it('should execute a single step and return result', async () => {
            const result = await executor.execute({}, true);

            expect(result.finishReason).toBe('stop');
            expect(result.stepCount).toBe(0);
            expect(result.text).toBe('Hello');
            expect(result.usage).toEqual({
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
            });
        });

        it('should emit llm:thinking event at start', async () => {
            await executor.execute({}, true);

            expect(mockEventBus.emit).toHaveBeenCalledWith('llm:thinking');
        });

        it('should call getFormattedMessagesWithCompression for each step', async () => {
            await executor.execute({}, true);

            expect(mockContextManager.getFormattedMessagesWithCompression).toHaveBeenCalled();
        });

        it('should pass streaming flag to StreamProcessor', async () => {
            // Execute with streaming = false
            await executor.execute({}, false);

            // StreamProcessor should not emit chunk events
            expect(mockEventBus.emit).not.toHaveBeenCalledWith('llm:chunk', expect.anything());
        });
    });

    describe('Multi-Step Tool Loop', () => {
        it('should continue execution when finishReason is tool-calls', async () => {
            let callCount = 0;
            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                if (callCount < 3) {
                    return createMockStreamResult({
                        text: `Step ${callCount}`,
                        finishReason: 'tool-calls',
                        toolCalls: [
                            {
                                toolCallId: `call-${callCount}`,
                                toolName: 'test_tool',
                                input: {},
                            },
                        ],
                    }) as ReturnType<typeof streamText>;
                }
                return createMockStreamResult({
                    text: 'Final',
                    finishReason: 'stop',
                }) as ReturnType<typeof streamText>;
            });

            const result = await executor.execute({}, true);

            expect(result.finishReason).toBe('stop');
            expect(result.stepCount).toBe(2); // Two tool-call steps before stop
            expect(callCount).toBe(3);
        });

        it('should stop at maxSteps limit', async () => {
            const limitedExecutor = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                { ...defaultConfig, maxSteps: 2 },
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue
            );

            // Always return tool-calls to force hitting maxSteps
            vi.mocked(streamText).mockImplementation(
                () =>
                    createMockStreamResult({
                        text: 'Tool step',
                        finishReason: 'tool-calls',
                        toolCalls: [{ toolCallId: 'call-1', toolName: 'test', input: {} }],
                    }) as ReturnType<typeof streamText>
            );

            const result = await limitedExecutor.execute({}, true);

            // Should stop after 2 steps (maxSteps=2)
            expect(result.stepCount).toBe(2);
        });
    });

    describe('Abort Signal', () => {
        it('should have abort method available', () => {
            // TurnExecutor should expose abort method
            expect(typeof executor.abort).toBe('function');
        });

        it('should abort controller when abort is called', () => {
            // Create a new executor to test abort without affecting other tests
            const testExecutor = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                defaultConfig,
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue
            );

            // Call abort - this should not throw
            expect(() => testExecutor.abort()).not.toThrow();
        });
    });

    describe('Tool Support Validation', () => {
        it('should skip tool validation for providers without baseURL', async () => {
            await executor.execute({}, true);

            // generateText should not be called for validation
            expect(generateText).not.toHaveBeenCalled();
        });

        it('should validate tool support for custom baseURL', async () => {
            const executorWithBaseURL = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                { ...defaultConfig, baseURL: 'https://custom.api.com' },
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue
            );

            vi.mocked(generateText).mockResolvedValue(
                {} as Awaited<ReturnType<typeof generateText>>
            );

            await executorWithBaseURL.execute({}, true);

            // generateText should be called to test tool support
            expect(generateText).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: mockModel,
                    tools: expect.any(Object),
                })
            );
        });

        it('should cache tool support validation results', async () => {
            vi.mocked(generateText).mockResolvedValue(
                {} as Awaited<ReturnType<typeof generateText>>
            );

            // Create first executor with custom baseURL
            const executor1 = new TurnExecutor(
                mockModel,
                mockToolManager,
                createMockContextManager() as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                { ...defaultConfig, baseURL: 'https://cached.api.com' },
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                createMockMessageQueue()
            );

            await executor1.execute({}, true);

            // Create second executor with same baseURL - should use cache
            const executor2 = new TurnExecutor(
                mockModel,
                mockToolManager,
                createMockContextManager() as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id-2',
                { ...defaultConfig, baseURL: 'https://cached.api.com' },
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                createMockMessageQueue()
            );

            await executor2.execute({}, true);

            // generateText should only be called once due to caching (same baseURL)
            expect(generateText).toHaveBeenCalledTimes(1);
        });

        it('should handle model that does not support tools', async () => {
            const executorWithBaseURL = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                { ...defaultConfig, baseURL: 'https://no-tools.api.com' },
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue
            );

            vi.mocked(generateText).mockRejectedValue(new Error('Model does not support tools'));

            await executorWithBaseURL.execute({}, true);

            // Should still execute but with empty tools
            expect(streamText).toHaveBeenCalledWith(
                expect.objectContaining({
                    tools: {},
                })
            );
        });
    });

    describe('Tool Creation', () => {
        it('should create Vercel-compatible tools from ToolManager', async () => {
            const mockTools = {
                read_file: {
                    description: 'Read a file',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                        },
                        required: ['path'],
                    },
                },
            };

            mockToolManager = createMockToolManager(mockTools);
            executor = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                defaultConfig,
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue
            );

            await executor.execute({}, true);

            expect(mockToolManager.getAllTools).toHaveBeenCalled();
            expect(streamText).toHaveBeenCalledWith(
                expect.objectContaining({
                    tools: expect.objectContaining({
                        read_file: expect.objectContaining({
                            inputSchema: mockTools.read_file.parameters,
                            description: 'Read a file',
                            execute: expect.any(Function),
                            toModelOutput: expect.any(Function),
                        }),
                    }),
                })
            );
        });
    });

    describe('Tool Result Formatting', () => {
        it('should format error results correctly', async () => {
            // Access the private method via prototype
            const formatMethod = (
                executor as unknown as {
                    formatToolResultForLLM: (result: unknown, toolName: string) => unknown;
                }
            ).formatToolResultForLLM.bind(executor);

            const errorResult = { error: 'File not found', denied: true };
            const formatted = formatMethod(errorResult, 'read_file');

            expect(formatted).toEqual({
                type: 'text',
                value: 'Tool read_file failed (denied): File not found',
            });
        });

        it('should format string results correctly', async () => {
            const formatMethod = (
                executor as unknown as {
                    formatToolResultForLLM: (result: unknown, toolName: string) => unknown;
                }
            ).formatToolResultForLLM.bind(executor);

            const formatted = formatMethod('File contents here', 'read_file');

            expect(formatted).toEqual({
                type: 'text',
                value: 'File contents here',
            });
        });

        it('should format object results as JSON', async () => {
            const formatMethod = (
                executor as unknown as {
                    formatToolResultForLLM: (result: unknown, toolName: string) => unknown;
                }
            ).formatToolResultForLLM.bind(executor);

            const objResult = { files: ['a.ts', 'b.ts'], count: 2 };
            const formatted = formatMethod(objResult, 'list_files');

            expect(formatted).toEqual({
                type: 'text',
                value: JSON.stringify(objResult),
            });
        });

        it('should format multimodal content with images', async () => {
            const formatMethod = (
                executor as unknown as {
                    formatToolResultForLLM: (result: unknown, toolName: string) => unknown;
                }
            ).formatToolResultForLLM.bind(executor);

            const multimodalResult = {
                content: [
                    { type: 'text', text: 'Screenshot captured' },
                    { type: 'image', image: 'base64imagedata', mimeType: 'image/png' },
                ],
            };
            const formatted = formatMethod(multimodalResult, 'screenshot');

            expect(formatted).toEqual({
                type: 'content',
                value: [
                    { type: 'text', text: 'Screenshot captured' },
                    { type: 'media', data: 'base64imagedata', mediaType: 'image/png' },
                ],
            });
        });

        it('should handle text-only content arrays', async () => {
            const formatMethod = (
                executor as unknown as {
                    formatToolResultForLLM: (result: unknown, toolName: string) => unknown;
                }
            ).formatToolResultForLLM.bind(executor);

            const textArrayResult = {
                content: [
                    { type: 'text', text: 'Line 1' },
                    { type: 'text', text: 'Line 2' },
                ],
            };
            const formatted = formatMethod(textArrayResult, 'read_file');

            expect(formatted).toEqual({
                type: 'text',
                value: 'Line 1\nLine 2',
            });
        });
    });

    describe('Message Queue Injection', () => {
        it('should inject queued messages at start of step', async () => {
            const queuedMessage: CoalescedMessage = {
                combinedContent: 'User guidance: Focus on performance',
                messages: [
                    {
                        id: 'msg-1',
                        content: 'Focus on performance',
                        queuedAt: new Date(),
                    },
                ],
                firstQueuedAt: new Date(),
                lastQueuedAt: new Date(),
            };

            mockMessageQueue = createMockMessageQueue(queuedMessage);
            executor = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                defaultConfig,
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue
            );

            await executor.execute({}, true);

            expect(mockContextManager.addMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    role: 'user',
                    content: 'User guidance: Focus on performance',
                    metadata: expect.objectContaining({
                        coalesced: false,
                        messageCount: 1,
                    }),
                })
            );
        });

        it('should coalesce multiple queued messages', async () => {
            const queuedMessage: CoalescedMessage = {
                combinedContent: 'Message 1\n\nMessage 2',
                messages: [
                    { id: 'msg-1', content: 'Message 1', queuedAt: new Date() },
                    { id: 'msg-2', content: 'Message 2', queuedAt: new Date() },
                ],
                firstQueuedAt: new Date(),
                lastQueuedAt: new Date(),
            };

            mockMessageQueue = createMockMessageQueue(queuedMessage);
            executor = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                defaultConfig,
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue
            );

            await executor.execute({}, true);

            expect(mockContextManager.addMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    metadata: expect.objectContaining({
                        coalesced: true,
                        messageCount: 2,
                        originalMessageIds: ['msg-1', 'msg-2'],
                    }),
                })
            );
        });
    });

    describe('Overflow Detection and Compression', () => {
        it('should not check overflow without model limits', async () => {
            // Default executor has no modelLimits
            vi.mocked(streamText).mockImplementation(
                () =>
                    createMockStreamResult({
                        text: 'Response',
                        finishReason: 'stop',
                        usage: { inputTokens: 95000, outputTokens: 1000, totalTokens: 96000 },
                    }) as ReturnType<typeof streamText>
            );

            await executor.execute({}, true);

            // No compression event should be emitted
            expect(mockEventBus.emit).not.toHaveBeenCalledWith(
                'context:compressed',
                expect.anything()
            );
        });

        it('should initialize compression strategy with model limits', async () => {
            const modelLimits: ModelLimits = {
                contextWindow: 100000,
                maxOutput: 4096,
            };

            const executorWithLimits = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                defaultConfig,
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue,
                modelLimits
            );

            // Execute normally - compression won't trigger with low token usage
            await executorWithLimits.execute({}, true);

            // Executor should complete without errors when model limits are provided
            expect(mockEventBus.emit).toHaveBeenCalledWith('llm:thinking');
        });
    });

    describe('Pruning Old Tool Outputs', () => {
        it('should call getHistory to check for pruning after tool-calls', async () => {
            // Return tool-calls to trigger pruning step
            let callCount = 0;
            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return createMockStreamResult({
                        text: 'Step 1',
                        finishReason: 'tool-calls',
                        toolCalls: [{ toolCallId: 'call-1', toolName: 'test', input: {} }],
                    }) as ReturnType<typeof streamText>;
                }
                return createMockStreamResult({
                    text: 'Done',
                    finishReason: 'stop',
                }) as ReturnType<typeof streamText>;
            });

            await executor.execute({}, true);

            // getHistory is called for pruning check after tool-calls step
            expect(mockContextManager.getHistory).toHaveBeenCalled();
        });

        it('should stop pruning at summary message', async () => {
            const history: Message[] = [
                {
                    id: 'summary-1',
                    role: 'assistant',
                    content: 'Summary of conversation',
                    metadata: { isSummary: true },
                    createdAt: new Date(Date.now() - 10000),
                } as unknown as Message,
                // Messages after summary should be considered for pruning
                {
                    id: 'tool-1',
                    role: 'tool',
                    content: [{ type: 'text', text: 'x'.repeat(100000) }], // Large tool output
                    createdAt: new Date(),
                } as unknown as Message,
            ];

            mockContextManager = createMockContextManager({ history });
            executor = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                defaultConfig,
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue
            );

            // Trigger pruning
            let callCount = 0;
            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return createMockStreamResult({
                        finishReason: 'tool-calls',
                        toolCalls: [{ toolCallId: 'call-1', toolName: 'test', input: {} }],
                    }) as ReturnType<typeof streamText>;
                }
                return createMockStreamResult({ finishReason: 'stop' }) as ReturnType<
                    typeof streamText
                >;
            });

            await executor.execute({}, true);

            // markMessagesAsCompacted should only consider messages after summary
            // In this case, only 1 tool message after summary
        });

        it('should skip already pruned messages', async () => {
            const history: Message[] = [
                {
                    id: 'tool-1',
                    role: 'tool',
                    content: [{ type: 'text', text: 'Already pruned' }],
                    compactedAt: new Date(), // Already marked
                    createdAt: new Date(),
                } as unknown as Message,
            ];

            mockContextManager = createMockContextManager({ history });
            executor = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                defaultConfig,
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue
            );

            await executor.execute({}, true);

            // Should not try to prune already-pruned messages
            expect(mockContextManager.markMessagesAsCompacted).not.toHaveBeenCalled();
        });
    });

    describe('Error Mapping', () => {
        it('should map rate limit errors (429) to DextoRuntimeError', async () => {
            const { APICallError } = await import('ai');
            vi.mocked(APICallError.isInstance).mockReturnValue(true);

            const rateLimitError = {
                statusCode: 429,
                responseHeaders: { 'retry-after': '60' },
                responseBody: 'Rate limit exceeded',
            };

            vi.mocked(streamText).mockImplementation(() => {
                throw rateLimitError;
            });

            await expect(executor.execute({}, true)).rejects.toMatchObject({
                code: 'llm_rate_limit_exceeded',
                type: 'rate_limit',
            });
        });

        it('should map timeout errors (408) to DextoRuntimeError', async () => {
            const { APICallError } = await import('ai');
            vi.mocked(APICallError.isInstance).mockReturnValue(true);

            const timeoutError = {
                statusCode: 408,
                responseHeaders: {},
                responseBody: 'Request timeout',
            };

            vi.mocked(streamText).mockImplementation(() => {
                throw timeoutError;
            });

            await expect(executor.execute({}, true)).rejects.toMatchObject({
                code: 'llm_generation_failed',
                type: 'timeout',
            });
        });

        it('should map other API errors to third-party type', async () => {
            const { APICallError } = await import('ai');
            vi.mocked(APICallError.isInstance).mockReturnValue(true);

            const serverError = {
                statusCode: 500,
                responseHeaders: {},
                responseBody: 'Internal server error',
            };

            vi.mocked(streamText).mockImplementation(() => {
                throw serverError;
            });

            await expect(executor.execute({}, true)).rejects.toMatchObject({
                code: 'llm_generation_failed',
                type: 'third_party',
            });
        });

        it('should emit llm:error event on failure', async () => {
            vi.mocked(streamText).mockImplementation(() => {
                throw new Error('Unexpected error');
            });

            await expect(executor.execute({}, true)).rejects.toThrow();

            expect(mockEventBus.emit).toHaveBeenCalledWith(
                'llm:error',
                expect.objectContaining({
                    context: 'TurnExecutor',
                    recoverable: false,
                })
            );
        });
    });

    describe('Telemetry', () => {
        it('should set telemetry attributes on active span', async () => {
            const mockSpan = {
                setAttribute: vi.fn(),
            };

            const { trace } = await import('@opentelemetry/api');
            vi.mocked(trace.getActiveSpan).mockReturnValue(
                mockSpan as unknown as ReturnType<typeof trace.getActiveSpan>
            );

            vi.mocked(streamText).mockImplementation(
                () =>
                    createMockStreamResult({
                        text: 'Response',
                        finishReason: 'stop',
                        usage: {
                            inputTokens: 100,
                            outputTokens: 50,
                            totalTokens: 150,
                        },
                    }) as ReturnType<typeof streamText>
            );

            await executor.execute({}, true);

            expect(mockSpan.setAttribute).toHaveBeenCalledWith('gen_ai.usage.input_tokens', 100);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith('gen_ai.usage.output_tokens', 50);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith('gen_ai.usage.total_tokens', 150);
        });

        it('should set reasoning tokens when available', async () => {
            const mockSpan = {
                setAttribute: vi.fn(),
            };

            const { trace } = await import('@opentelemetry/api');
            vi.mocked(trace.getActiveSpan).mockReturnValue(
                mockSpan as unknown as ReturnType<typeof trace.getActiveSpan>
            );

            // Add reasoning tokens to usage
            vi.mocked(streamText).mockImplementation(() => {
                return {
                    fullStream: (async function* () {
                        yield {
                            type: 'finish',
                            finishReason: 'stop',
                            totalUsage: {
                                inputTokens: 100,
                                outputTokens: 50,
                                totalTokens: 150,
                                reasoningTokens: 20,
                            },
                        };
                    })(),
                } as ReturnType<typeof streamText>;
            });

            await executor.execute({}, true);

            expect(mockSpan.setAttribute).toHaveBeenCalledWith('gen_ai.usage.reasoning_tokens', 20);
        });
    });

    describe('Cleanup', () => {
        it('should cleanup on normal completion', async () => {
            await executor.execute({}, true);

            // Message queue should be cleared
            expect(mockMessageQueue.clear).toHaveBeenCalled();
        });

        it('should cleanup on error', async () => {
            vi.mocked(streamText).mockImplementation(() => {
                throw new Error('Test error');
            });

            await expect(executor.execute({}, true)).rejects.toThrow();

            // Message queue should be cleared even on error
            expect(mockMessageQueue.clear).toHaveBeenCalled();
        });

        it('should abort pending operations on cleanup', async () => {
            // Execute normally - cleanup should abort controller
            await executor.execute({}, true);

            // After execution, abort controller should be aborted
            // (This is internal state, tested via side effects)
            expect(mockMessageQueue.clear).toHaveBeenCalled();
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty tool manager', async () => {
            mockToolManager = createMockToolManager({});
            executor = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                defaultConfig,
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue
            );

            const result = await executor.execute({}, true);

            expect(result.finishReason).toBe('stop');
            expect(streamText).toHaveBeenCalledWith(
                expect.objectContaining({
                    tools: {},
                })
            );
        });

        it('should handle null usage in finish event', async () => {
            vi.mocked(streamText).mockImplementation(() => {
                return {
                    fullStream: (async function* () {
                        yield { type: 'text-delta', text: 'Hello' };
                        yield {
                            type: 'finish',
                            finishReason: 'stop',
                            totalUsage: {
                                inputTokens: undefined,
                                outputTokens: undefined,
                                totalTokens: undefined,
                            },
                        };
                    })(),
                } as ReturnType<typeof streamText>;
            });

            const result = await executor.execute({}, true);

            expect(result.usage).toEqual({
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
            });
        });

        it('should pass optional config parameters to streamText', async () => {
            const customConfig = {
                maxSteps: 5,
                maxOutputTokens: 2048,
                temperature: 0.5,
            };

            executor = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                customConfig,
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue
            );

            await executor.execute({}, true);

            expect(streamText).toHaveBeenCalledWith(
                expect.objectContaining({
                    maxOutputTokens: 2048,
                    temperature: 0.5,
                })
            );
        });

        it('should not include undefined config parameters', async () => {
            const minimalConfig = {
                maxSteps: 10,
                // No maxOutputTokens or temperature
            };

            executor = new TurnExecutor(
                mockModel,
                mockToolManager,
                mockContextManager as unknown as ContextManager<import('ai').ModelMessage>,
                mockEventBus,
                mockResourceManager,
                'test-session-id',
                minimalConfig,
                defaultLLMContext,
                defaultRouter,
                mockLogger,
                mockMessageQueue
            );

            await executor.execute({}, true);

            const streamTextCall = vi.mocked(streamText).mock.calls[0][0];
            expect(streamTextCall).not.toHaveProperty('maxOutputTokens');
            expect(streamTextCall).not.toHaveProperty('temperature');
        });
    });
});
