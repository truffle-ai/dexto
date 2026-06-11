import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { context as otelContext, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ChatSession } from './chat-session.js';
import { type ValidatedLLMConfig } from '../llm/schemas.js';
import { LLMConfigSchema } from '../llm/schemas.js';
import { SessionErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import type { SessionEventMap } from '../events/index.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { HookErrorCode } from '../hooks/error-codes.js';

// Mock all dependencies
vi.mock('../llm/services/factory.js', () => ({
    createLLMService: vi.fn(),
}));
vi.mock('../llm/registry/index.js', async (importOriginal) => {
    const actual = (await importOriginal()) as typeof import('../llm/registry/index.js');
    return {
        ...actual,
        getEffectiveMaxInputTokens: vi.fn(),
    };
});
vi.mock('../logger/index.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        silly: vi.fn(),
    },
}));

import { createLLMService } from '../llm/services/factory.js';
import { getEffectiveMaxInputTokens } from '../llm/registry/index.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

const mockCreateLLMService = vi.mocked(createLLMService);
const mockGetEffectiveMaxInputTokens = vi.mocked(getEffectiveMaxInputTokens);

type ModelResponseEvent = SessionEventMap['llm:response'];

function createModelResponseEvent(overrides: Partial<ModelResponseEvent>): ModelResponseEvent {
    return {
        content: 'Test response',
        finishReason: 'stop',
        provider: 'openai',
        model: 'gpt-4',
        tokenUsage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
        },
        ...overrides,
    };
}

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createMockTurnDriver() {
    return {
        prepareNextModelStep: vi.fn().mockResolvedValue({
            stepCount: 0,
        }),
        runNextModelStep: vi.fn().mockResolvedValue({
            result: {
                text: 'driver response',
                finishReason: 'stop',
                usage: {
                    inputTokens: 1,
                    outputTokens: 2,
                    totalTokens: 3,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                },
                toolCalls: [],
            },
            stepCount: 0,
        }),
        executeToolCalls: vi.fn().mockResolvedValue(undefined),
        decideNextStep: vi.fn().mockResolvedValue({
            kind: 'stop',
            stepCount: 0,
            finishReason: 'stop',
        }),
        finish: vi.fn().mockResolvedValue({
            text: 'driver response',
            stepCount: 0,
            usage: {
                inputTokens: 1,
                outputTokens: 2,
                totalTokens: 3,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
            },
            finishReason: 'stop',
        }),
        fail: vi.fn().mockRejectedValue(new Error('driver failed')),
        getState: vi.fn().mockReturnValue({
            phase: 'model-step-complete',
            stepCount: 0,
            startedAtMs: 123,
            supportsTools: true,
            modelStepId: 'model-step-1',
            result: {
                text: 'driver response',
                finishReason: 'stop',
                usage: {
                    inputTokens: 1,
                    outputTokens: 2,
                    totalTokens: 3,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                },
                toolCalls: [],
            },
            toolCallsExecuted: true,
        }),
        checkpoint: vi.fn().mockReturnValue({
            phase: 'model-step-complete',
            stepCount: 0,
            startedAtMs: 123,
            supportsTools: true,
            modelStepId: 'model-step-1',
            result: {
                text: 'driver response',
                finishReason: 'stop',
                usage: {
                    inputTokens: 1,
                    outputTokens: 2,
                    totalTokens: 3,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                },
                toolCalls: [],
            },
            toolCallsExecuted: true,
        }),
        dispose: vi.fn(),
    };
}

describe('ChatSession', () => {
    let chatSession: ChatSession;
    let mockServices: any;
    let mockLLMService: any;
    let mockCache: any;
    let mockDatabase: any;
    let mockBlobStore: any;
    let mockContextManager: any;
    const mockLogger = createMockLogger();

    const sessionId = 'test-session-123';
    const mockLLMConfig = LLMConfigSchema.parse({
        provider: 'openai',
        model: 'gpt-5',
        apiKey: 'test-key',
        maxIterations: 50,
        maxInputTokens: 128000,
    });

    beforeEach(() => {
        vi.resetAllMocks();

        // Mock LLM service
        mockContextManager = {
            resetConversation: vi.fn().mockResolvedValue(undefined),
            addUserMessage: vi.fn().mockResolvedValue(undefined),
        };
        mockLLMService = {
            stream: vi.fn().mockResolvedValue('Mock response'),
            createTurnDriver: vi.fn(),
            switchLLM: vi.fn().mockResolvedValue(undefined),
            getContextManager: vi.fn().mockReturnValue(mockContextManager),
            eventBus: {
                emit: vi.fn(),
                on: vi.fn(),
                off: vi.fn(),
            },
        };

        // Mock storage manager with proper getter structure
        mockCache = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(true),
            list: vi.fn().mockResolvedValue([]),
            clear: vi.fn().mockResolvedValue(undefined),
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            isConnected: vi.fn().mockReturnValue(true),
            getBackendType: vi.fn().mockReturnValue('memory'),
        };

        mockDatabase = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(true),
            list: vi.fn().mockResolvedValue([]),
            clear: vi.fn().mockResolvedValue(undefined),
            append: vi.fn().mockResolvedValue(undefined),
            getRange: vi.fn().mockResolvedValue([]),
            getLength: vi.fn().mockResolvedValue(0),
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            isConnected: vi.fn().mockReturnValue(true),
            getBackendType: vi.fn().mockReturnValue('memory'),
        };

        mockBlobStore = {
            store: vi.fn().mockResolvedValue({ id: 'test', uri: 'blob:test' }),
            retrieve: vi.fn().mockResolvedValue({ data: '', metadata: {} }),
            exists: vi.fn().mockResolvedValue(false),
            delete: vi.fn().mockResolvedValue(undefined),
            cleanup: vi.fn().mockResolvedValue(0),
            getStats: vi.fn().mockResolvedValue({ count: 0, totalSize: 0, backendType: 'local' }),
            listBlobs: vi.fn().mockResolvedValue([]),
            getStoragePath: vi.fn().mockReturnValue(undefined),
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            isConnected: vi.fn().mockReturnValue(true),
            getStoreType: vi.fn().mockReturnValue('local'),
        };

        const mockStorageManager = {
            getCache: vi.fn().mockReturnValue(mockCache),
            getDatabase: vi.fn().mockReturnValue(mockDatabase),
            getBlobStore: vi.fn().mockReturnValue(mockBlobStore),
            disconnect: vi.fn().mockResolvedValue(undefined),
        };
        const mockConversationStore = {
            listMessages: vi.fn(async ({ sessionId }) =>
                mockDatabase.getRange(`messages:${sessionId}`, 0)
            ),
            saveMessage: vi.fn(async ({ sessionId, message }) =>
                mockDatabase.append(`messages:${sessionId}`, message)
            ),
            updateMessage: vi.fn(async ({ sessionId, message }) =>
                mockDatabase.append(`messages:${sessionId}`, message)
            ),
            clearMessages: vi.fn(async ({ sessionId }) =>
                mockDatabase.delete(`messages:${sessionId}`)
            ),
            flush: vi.fn().mockResolvedValue(undefined),
        };

        // Mock services
        mockServices = {
            stateManager: {
                getLLMConfig: vi.fn().mockReturnValue(mockLLMConfig),
                getRuntimeConfig: vi.fn().mockReturnValue({
                    llm: mockLLMConfig,
                    compression: { type: 'noop', enabled: true },
                }),
                updateLLM: vi.fn().mockReturnValue({ isValid: true, errors: [], warnings: [] }),
            },
            systemPromptManager: {
                getSystemPrompt: vi.fn().mockReturnValue('System prompt'),
            },
            mcpManager: {
                getAllTools: vi.fn().mockResolvedValue({}),
            },
            agentEventBus: {
                emit: vi.fn(),
                on: vi.fn(),
                off: vi.fn(),
            },
            compactionStrategy: null,
            storageManager: mockStorageManager,
            conversationStore: mockConversationStore,
            resourceManager: {
                getBlobStore: vi.fn(),
                readResource: vi.fn(),
                listResources: vi.fn(),
            },
            toolManager: {
                getAllTools: vi.fn().mockReturnValue([]),
            },
            steerQueueStore: {
                listSessionIds: vi.fn().mockResolvedValue([]),
                list: vi.fn().mockResolvedValue([]),
                append: vi.fn().mockResolvedValue({ position: 1 }),
                takeAll: vi.fn().mockResolvedValue([]),
                remove: vi.fn().mockResolvedValue(false),
                clear: vi.fn().mockResolvedValue(undefined),
            },
            followUpQueueStore: {
                listSessionIds: vi.fn().mockResolvedValue([]),
                list: vi.fn().mockResolvedValue([]),
                append: vi.fn().mockResolvedValue({ position: 1 }),
                takeAll: vi.fn().mockResolvedValue([]),
                remove: vi.fn().mockResolvedValue(false),
                clear: vi.fn().mockResolvedValue(undefined),
            },
            hookManager: {
                executeHooks: vi.fn().mockImplementation(async (_point, payload) => payload),
                cleanup: vi.fn(),
            },
            sessionManager: {
                accumulateTokenUsage: vi.fn().mockResolvedValue(undefined),
                markUntrackedChatGPTLoginUsage: vi.fn().mockResolvedValue(undefined),
            },
            workspaceManager: {
                getWorkspace: vi.fn().mockResolvedValue(undefined),
            },
        };

        mockCreateLLMService.mockReturnValue(mockLLMService);
        mockGetEffectiveMaxInputTokens.mockReturnValue(128000);

        // Create ChatSession instance
        chatSession = new ChatSession(mockServices, sessionId, mockLogger);
    });

    afterEach(() => {
        // Clean up any resources
        if (chatSession) {
            chatSession.dispose();
        }
        Reflect.deleteProperty(globalThis, '__TELEMETRY__');
        trace.disable();
    });

    describe('Session Identity and Lifecycle', () => {
        test('should maintain session identity throughout lifecycle', () => {
            expect(chatSession.id).toBe(sessionId);
            expect(chatSession.eventBus).toBeDefined();
        });

        test('should initialize with unified storage system', async () => {
            await chatSession.init();

            expect(mockServices.conversationStore.listMessages).not.toHaveBeenCalled();
            expect(mockCreateLLMService).toHaveBeenCalledWith(
                mockLLMConfig,
                mockServices.toolManager,
                mockServices.systemPromptManager,
                expect.any(Object),
                chatSession.eventBus,
                sessionId,
                mockServices.resourceManager,
                expect.any(Object),
                expect.any(Object),
                undefined
            );
        });

        test('passes the active workspace path to createLLMService when one is set', async () => {
            mockServices.workspaceManager.getWorkspace.mockResolvedValue({
                id: 'workspace-1',
                path: '/tmp/dexto-cloud',
                createdAt: 1,
                lastActiveAt: 1,
            });

            await chatSession.init();

            expect(mockCreateLLMService).toHaveBeenCalledWith(
                mockLLMConfig,
                mockServices.toolManager,
                mockServices.systemPromptManager,
                expect.any(Object),
                chatSession.eventBus,
                sessionId,
                mockServices.resourceManager,
                expect.any(Object),
                expect.objectContaining({
                    usageScopeId: undefined,
                    compactionStrategy: null,
                    cwd: '/tmp/dexto-cloud',
                    steerQueue: expect.any(Object),
                }),
                undefined
            );
        });

        test('passes a host-provided languageModelFactory through to createLLMService', async () => {
            const languageModelFactory = vi.fn();

            mockServices.languageModelFactory = languageModelFactory;
            chatSession.dispose();
            chatSession = new ChatSession(mockServices, sessionId, mockLogger);

            await chatSession.init();

            expect(mockCreateLLMService).toHaveBeenCalledWith(
                mockLLMConfig,
                mockServices.toolManager,
                mockServices.systemPromptManager,
                expect.any(Object),
                chatSession.eventBus,
                sessionId,
                mockServices.resourceManager,
                expect.any(Object),
                expect.objectContaining({
                    usageScopeId: undefined,
                    compactionStrategy: null,
                    steerQueue: expect.any(Object),
                }),
                languageModelFactory
            );
            expect(chatSession.getLLMService()).toBe(mockLLMService);
        });

        test('passes a host-provided authResolver through to createLLMService', async () => {
            const authResolver = {
                resolveRuntimeAuth: vi.fn().mockReturnValue({ baseURL: 'codex://chatgpt' }),
            };

            mockServices.authResolver = authResolver;
            chatSession.dispose();
            chatSession = new ChatSession(mockServices, sessionId, mockLogger);

            await chatSession.init();

            expect(mockCreateLLMService).toHaveBeenCalledWith(
                mockLLMConfig,
                mockServices.toolManager,
                mockServices.systemPromptManager,
                expect.any(Object),
                chatSession.eventBus,
                sessionId,
                mockServices.resourceManager,
                expect.any(Object),
                expect.objectContaining({
                    authResolver,
                }),
                undefined
            );
        });

        test('exposes split steer and follow-up queues with structured content intact', async () => {
            mockCreateLLMService.mockImplementation(
                (
                    _llmConfig,
                    _toolManager,
                    _systemPromptManager,
                    _contextManager,
                    _eventBus,
                    _sessionId,
                    _resourceManager,
                    _hookManager,
                    queueOptions
                ) => {
                    mockLLMService.getSteerQueue = vi.fn().mockReturnValue(queueOptions.steerQueue);
                    mockLLMService.getFollowUpQueue = vi
                        .fn()
                        .mockReturnValue(queueOptions.followUpQueue);
                    return mockLLMService;
                }
            );
            const steerContent = [
                { type: 'text' as const, text: 'revise the plan' },
                {
                    type: 'resource' as const,
                    uri: 'file:///tmp/plan.md',
                    name: 'plan.md',
                    mimeType: 'text/markdown',
                    kind: 'text' as const,
                },
            ];
            const followUpContent = [
                { type: 'text' as const, text: 'then summarize the result' },
                {
                    type: 'file' as const,
                    data: 'base64-log',
                    mimeType: 'text/plain',
                    filename: 'run.log',
                },
            ];

            await chatSession.init();
            const steer = await chatSession.steer({ content: steerContent });
            const followUp = await chatSession.followUp({ content: followUpContent });

            expect(chatSession.getSteerMessages()).toEqual([
                expect.objectContaining({ id: steer.id, content: steerContent }),
            ]);
            expect(chatSession.getFollowUpMessages()).toEqual([
                expect.objectContaining({ id: followUp.id, content: followUpContent }),
            ]);

            await expect(chatSession.removeSteerMessage(steer.id)).resolves.toBe(true);
            expect(chatSession.getSteerMessages()).toEqual([]);
            expect(chatSession.getFollowUpMessages()).toHaveLength(1);
            await expect(chatSession.clearFollowUpQueue()).resolves.toBe(1);
            expect(chatSession.getFollowUpMessages()).toEqual([]);
        });

        test('should properly dispose resources to prevent memory leaks', () => {
            const eventSpy = vi.spyOn(chatSession.eventBus, 'off');

            chatSession.dispose();
            chatSession.dispose(); // Should not throw on multiple calls

            expect(eventSpy).toHaveBeenCalled();
        });
    });

    describe('Event System Integration', () => {
        test('should forward session events with host runtime from the active run context', async () => {
            await chatSession.init();
            const hostRuntime = {
                ids: {
                    runId: 'run-1',
                    attemptId: 'attempt-1',
                },
            };

            mockLLMService.stream.mockImplementation(async () => {
                chatSession.eventBus.emit('llm:thinking', {});
                return { text: 'Mock response' };
            });

            await chatSession.stream('hello', {
                runContext: {
                    sessionId,
                    hostRuntime,
                    telemetryContext: {} as any,
                },
            });

            expect(mockServices.agentEventBus.emit).toHaveBeenCalledWith('llm:thinking', {
                sessionId,
                hostRuntime,
            });
        });

        test('should forward all session events to agent bus with session context', async () => {
            await chatSession.init();

            mockLLMService.stream.mockImplementation(async () => {
                chatSession.eventBus.emit('llm:thinking', {});
                return { text: 'Mock response' };
            });

            await chatSession.stream('hello', {
                runContext: {
                    sessionId,
                    telemetryContext: {} as any,
                },
            });

            expect(mockServices.agentEventBus.emit).toHaveBeenCalledWith(
                'llm:thinking',
                expect.objectContaining({
                    sessionId,
                })
            );
        });

        test('should not emit llm switched directly on the agent bus', async () => {
            await chatSession.init();

            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'anthropic',
                model: 'claude-4-opus-20250514',
            };

            await chatSession.switchLLM(newConfig);

            expect(mockServices.agentEventBus.emit).not.toHaveBeenCalledWith(
                'llm:switched',
                expect.anything()
            );
        });

        test('should emit dexto:conversationReset event when conversation is reset', async () => {
            await chatSession.init();

            await chatSession.reset();

            // Should reset conversation via ContextManager
            expect(mockContextManager.resetConversation).toHaveBeenCalled();

            // Should emit dexto:conversationReset event with session context
            expect(mockServices.agentEventBus.emit).toHaveBeenCalledWith('session:reset', {
                sessionId,
            });
        });
    });

    describe('Turn driver boundary', () => {
        test('starts a session turn driver through hooks, message persistence, and event forwarding', async () => {
            await chatSession.init();
            const innerDriver = createMockTurnDriver();
            const runContext = {
                sessionId,
                hostRuntime: {
                    ids: {
                        runId: 'run-1',
                        attemptId: 'attempt-1',
                    },
                },
                telemetryContext: {} as any,
            };
            mockLLMService.createTurnDriver.mockResolvedValue(innerDriver);
            mockServices.hookManager.executeHooks.mockImplementation(
                async (point: string, payload: Record<string, unknown>) => {
                    if (point === 'beforeLLMRequest') {
                        return { ...payload, text: 'modified prompt' };
                    }
                    if (point === 'beforeResponse') {
                        return { ...payload, content: 'modified response' };
                    }
                    return payload;
                }
            );

            const driver = await chatSession.createTurnDriver({
                kind: 'start',
                content: 'hello',
                runContext,
            });

            expect(chatSession.isBusy()).toBe(true);
            expect(mockContextManager.addUserMessage).toHaveBeenCalledWith([
                { type: 'text', text: 'modified prompt' },
            ]);
            expect(mockLLMService.createTurnDriver).toHaveBeenCalledWith(
                expect.objectContaining({
                    signal: expect.any(AbortSignal),
                    streaming: true,
                    runContext,
                })
            );

            chatSession.eventBus.emit('llm:thinking', {});
            expect(mockServices.agentEventBus.emit).toHaveBeenCalledWith('llm:thinking', {
                sessionId,
                hostRuntime: runContext.hostRuntime,
            });

            await driver.runNextModelStep();
            await driver.executeToolCalls();
            await driver.decideNextStep();
            driver.getState();
            expect(innerDriver.runNextModelStep).toHaveBeenCalledTimes(1);
            expect(innerDriver.executeToolCalls).toHaveBeenCalledTimes(1);
            expect(innerDriver.decideNextStep).toHaveBeenCalledTimes(1);
            expect(innerDriver.getState).toHaveBeenCalledTimes(1);

            await expect(driver.finish()).resolves.toEqual(
                expect.objectContaining({
                    text: 'modified response',
                    finishReason: 'stop',
                })
            );
            expect(innerDriver.dispose).toHaveBeenCalledTimes(1);
            expect(chatSession.isBusy()).toBe(false);
            mockServices.agentEventBus.emit.mockClear();
            chatSession.eventBus.emit('llm:thinking', {});
            expect(mockServices.agentEventBus.emit).not.toHaveBeenCalled();
        });

        test('records setup spans under the active trace parent', async () => {
            const exporter = new InMemorySpanExporter();
            const provider = new BasicTracerProvider();
            const contextManager = new AsyncHooksContextManager().enable();
            provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
            provider.register({ contextManager });
            Reflect.set(globalThis, '__TELEMETRY__', { isInitialized: () => true });

            await chatSession.init();
            mockLLMService.createTurnDriver.mockResolvedValue(createMockTurnDriver());

            const parentSpan = trace.getTracer('test').startSpan('cloud.parent_turn');
            try {
                await otelContext.with(trace.setSpan(otelContext.active(), parentSpan), () =>
                    chatSession.createTurnDriver({
                        kind: 'start',
                        content: 'hello',
                    })
                );

                const spans = exporter.getFinishedSpans();
                const parentContext = parentSpan.spanContext();
                const setupSpans = spans.filter((span) =>
                    [
                        'chat_session.prepare_turn_input',
                        'chat_session.add_user_message',
                        'chat_session.create_llm_turn_driver',
                    ].includes(span.name)
                );

                expect(setupSpans.map((span) => span.name)).toEqual([
                    'chat_session.prepare_turn_input',
                    'chat_session.add_user_message',
                    'chat_session.create_llm_turn_driver',
                ]);
                expect(setupSpans).toHaveLength(3);
                for (const span of setupSpans) {
                    expect(span.spanContext().traceId).toBe(parentContext.traceId);
                    expect(span).toHaveProperty('parentSpanId', parentContext.spanId);
                    expect(span.attributes).toEqual(
                        expect.objectContaining({
                            'session.id': sessionId,
                            'turn.kind': 'start',
                        })
                    );
                }
            } finally {
                parentSpan.end();
                await provider.shutdown();
                contextManager.disable();
            }
        });

        test('checkpoints through the session driver and resumes that state without a new user message', async () => {
            await chatSession.init();
            const firstInnerDriver = createMockTurnDriver();
            const resumedInnerDriver = createMockTurnDriver();
            mockLLMService.createTurnDriver
                .mockResolvedValueOnce(firstInnerDriver)
                .mockResolvedValueOnce(resumedInnerDriver);

            const driver = await chatSession.createTurnDriver({
                kind: 'start',
                content: 'hello',
            });
            const state = driver.checkpoint();
            expect(chatSession.isBusy()).toBe(false);

            const resumedDriver = await chatSession.createTurnDriver({
                kind: 'resume',
                state,
                streaming: false,
            });

            expect(state).toEqual(
                expect.objectContaining({
                    phase: 'model-step-complete',
                    modelStepId: 'model-step-1',
                })
            );
            expect(firstInnerDriver.checkpoint).toHaveBeenCalledTimes(1);
            expect(firstInnerDriver.dispose).not.toHaveBeenCalled();
            expect(mockContextManager.addUserMessage).toHaveBeenCalledTimes(1);
            expect(mockLLMService.createTurnDriver).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    state,
                    streaming: false,
                })
            );
            expect(chatSession.isBusy()).toBe(true);
            resumedDriver.dispose();
            expect(chatSession.isBusy()).toBe(false);
        });

        test('cleans up busy state and event forwarding after fail and dispose', async () => {
            await chatSession.init();
            const failingInnerDriver = createMockTurnDriver();
            const disposedInnerDriver = createMockTurnDriver();
            mockLLMService.createTurnDriver
                .mockResolvedValueOnce(failingInnerDriver)
                .mockResolvedValueOnce(disposedInnerDriver);

            const failingDriver = await chatSession.createTurnDriver({
                kind: 'start',
                content: 'fail',
            });
            await expect(failingDriver.fail(new Error('boom'))).rejects.toThrow('driver failed');
            expect(failingInnerDriver.dispose).toHaveBeenCalledTimes(1);
            expect(chatSession.isBusy()).toBe(false);
            mockServices.agentEventBus.emit.mockClear();
            chatSession.eventBus.emit('llm:thinking', {});
            expect(mockServices.agentEventBus.emit).not.toHaveBeenCalled();

            const disposedDriver = await chatSession.createTurnDriver({
                kind: 'start',
                content: 'dispose',
            });
            disposedDriver.dispose();
            expect(disposedInnerDriver.dispose).toHaveBeenCalledTimes(1);
            expect(chatSession.isBusy()).toBe(false);
            mockServices.agentEventBus.emit.mockClear();
            chatSession.eventBus.emit('llm:thinking', {});
            expect(mockServices.agentEventBus.emit).not.toHaveBeenCalled();
        });

        test('preserves blocked hook interactions when creating a start driver', async () => {
            await chatSession.init();
            const blocked = new DextoRuntimeError(
                HookErrorCode.HOOK_BLOCKED_EXECUTION,
                ErrorScope.HOOK,
                ErrorType.FORBIDDEN,
                'blocked by policy'
            );
            mockServices.hookManager.executeHooks.mockRejectedValue(blocked);

            await expect(
                chatSession.createTurnDriver({
                    kind: 'start',
                    content: 'blocked prompt',
                })
            ).rejects.toThrow('blocked by policy');

            expect(mockServices.conversationStore.saveMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    sessionId,
                    message: expect.objectContaining({
                        role: 'assistant',
                        content: [{ type: 'text', text: 'Error: blocked by policy' }],
                    }),
                })
            );
            expect(mockServices.agentEventBus.emit).toHaveBeenCalledWith(
                'interaction:blocked',
                expect.objectContaining({
                    sessionId,
                    content: 'Error: blocked by policy',
                    provider: mockLLMConfig.provider,
                    model: mockLLMConfig.model,
                    messageId: expect.any(String),
                })
            );
            expect(mockServices.agentEventBus.emit).toHaveBeenCalledWith(
                'run:complete',
                expect.objectContaining({
                    sessionId,
                    finishReason: 'stop',
                    stepCount: 0,
                })
            );
            expect(chatSession.isBusy()).toBe(false);
        });
    });

    describe('LLM Configuration Management', () => {
        beforeEach(async () => {
            await chatSession.init();
        });

        test('should create new LLM service when configuration changes', async () => {
            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                maxInputTokens: 256000, // Change maxInputTokens
            };

            // Clear previous calls
            mockCreateLLMService.mockClear();

            await chatSession.switchLLM(newConfig);

            // Should create a new LLM service with updated config
            expect(mockCreateLLMService).toHaveBeenCalledWith(
                newConfig,
                mockServices.toolManager,
                mockServices.systemPromptManager,
                expect.any(Object),
                chatSession.eventBus,
                sessionId,
                mockServices.resourceManager,
                expect.any(Object),
                expect.objectContaining({
                    usageScopeId: undefined,
                    compactionStrategy: null,
                    steerQueue: expect.any(Object),
                }),
                undefined
            );
        });

        test('should create new LLM service during LLM switch', async () => {
            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'anthropic',
                model: 'claude-4-opus-20250514',
            };

            // Clear previous calls to createLLMService
            mockCreateLLMService.mockClear();

            await chatSession.switchLLM(newConfig);

            // Should create a new LLM service with the new config
            expect(mockCreateLLMService).toHaveBeenCalledWith(
                newConfig,
                mockServices.toolManager,
                mockServices.systemPromptManager,
                expect.any(Object),
                chatSession.eventBus,
                sessionId,
                mockServices.resourceManager,
                expect.any(Object),
                expect.objectContaining({
                    usageScopeId: undefined,
                    compactionStrategy: null,
                    steerQueue: expect.any(Object),
                }),
                undefined
            );
        });

        test('should emit LLM switched event with correct metadata', async () => {
            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'anthropic',
                model: 'claude-4-opus-20250514',
            };

            const eventSpy = vi.spyOn(chatSession.eventBus, 'emit');

            await chatSession.switchLLM(newConfig);

            expect(eventSpy).toHaveBeenCalledWith(
                'llm:switched',
                expect.objectContaining({
                    newConfig,
                    historyRetained: true,
                })
            );
        });
    });

    describe('Error Handling and Resilience', () => {
        test('should handle storage initialization failures gracefully', async () => {
            mockServices.steerQueueStore.list.mockRejectedValue(
                new Error('Storage initialization failed')
            );

            await expect(chatSession.init()).rejects.toThrow('Storage initialization failed');
        });

        test('should handle LLM service creation failures', async () => {
            mockCreateLLMService.mockImplementation(() => {
                throw new Error('LLM service creation failed');
            });

            await expect(chatSession.init()).rejects.toThrow('LLM service creation failed');
        });

        test('should handle LLM switch failures and propagate errors', async () => {
            await chatSession.init();

            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'invalid-provider' as any,
            };

            mockCreateLLMService.mockImplementation(() => {
                throw new Error('Invalid provider');
            });

            await expect(chatSession.switchLLM(newConfig)).rejects.toThrow('Invalid provider');
        });

        test('should handle conversation errors from LLM service', async () => {
            await chatSession.init();

            mockLLMService.stream.mockRejectedValue(new Error('LLM service error'));

            await expect(chatSession.stream('test message')).rejects.toThrow('LLM service error');
        });

        test('should reject overlapping direct stream calls', async () => {
            await chatSession.init();

            const deferred = createDeferred<{ text: string }>();
            mockLLMService.stream.mockImplementation(async () => await deferred.promise);

            const firstRun = chatSession.stream('first message');

            await expect(chatSession.stream('second message')).rejects.toMatchObject({
                code: SessionErrorCode.SESSION_BUSY,
                scope: ErrorScope.SESSION,
                type: ErrorType.CONFLICT,
            });

            deferred.resolve({ text: 'ok' });
            await expect(firstRun).resolves.toEqual({ text: 'ok' });
        });
    });

    describe('Service Integration Points', () => {
        beforeEach(async () => {
            await chatSession.init();
        });

        test('should delegate conversation operations to LLM service', async () => {
            const userMessage = 'Hello, world!';
            const expectedResponse = 'Hello! How can I help you?';

            mockLLMService.stream.mockResolvedValue({ text: expectedResponse });

            const response = await chatSession.stream(userMessage);

            expect(response).toEqual({ text: expectedResponse });
            expect(mockLLMService.stream).toHaveBeenCalledWith(
                [{ type: 'text', text: userMessage }],
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
        });

        test('should read conversation history from the conversation store', async () => {
            const mockHistory = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi there!' },
            ];

            mockDatabase.getRange.mockResolvedValue(mockHistory);

            await chatSession.init();
            const history = await chatSession.getHistory();

            expect(history).toEqual(mockHistory);
            expect(mockServices.conversationStore.listMessages).toHaveBeenCalledWith({
                sessionId,
            });
        });
    });

    describe('Session Isolation', () => {
        test('should create session-specific services with proper isolation', async () => {
            await chatSession.init();

            // Verify session-specific LLM service creation with new signature
            expect(mockCreateLLMService).toHaveBeenCalledWith(
                mockLLMConfig,
                mockServices.toolManager,
                mockServices.systemPromptManager,
                expect.any(Object),
                chatSession.eventBus, // Session-specific event bus
                sessionId,
                mockServices.resourceManager, // ResourceManager parameter
                expect.any(Object), // Logger parameter
                expect.objectContaining({
                    usageScopeId: undefined,
                    compactionStrategy: null,
                    steerQueue: expect.any(Object),
                }),
                undefined
            );

            expect(mockCreateLLMService).toHaveBeenCalledTimes(1);
        });
    });

    describe('Multi-Model Token Tracking', () => {
        beforeEach(async () => {
            // Mock accumulateTokenUsage to track calls
            mockServices.sessionManager.accumulateTokenUsage = vi.fn().mockResolvedValue(undefined);
            await chatSession.init();
        });

        test('should use payload provider/model for token accumulation', async () => {
            const payloadProvider = 'anthropic';
            const payloadModel = 'claude-4-opus-20250514';

            // Emit llm:response with provider/model in payload
            chatSession.eventBus.emit(
                'llm:response',
                createModelResponseEvent({
                    provider: payloadProvider,
                    model: payloadModel,
                    tokenUsage: {
                        inputTokens: 100,
                        outputTokens: 50,
                        totalTokens: 150,
                    },
                })
            );

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Should call accumulateTokenUsage with payload provider/model
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenCalledWith(
                sessionId,
                expect.objectContaining({
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                }),
                expect.any(Number), // cost
                expect.objectContaining({
                    provider: payloadProvider,
                    model: payloadModel,
                })
            );
        });

        test('should calculate cost using payload model for accurate multi-model tracking', async () => {
            const payloadProvider = 'anthropic';
            const payloadModel = 'claude-4-opus-20250514';

            // Emit llm:response with different model than llmConfig
            chatSession.eventBus.emit(
                'llm:response',
                createModelResponseEvent({
                    provider: payloadProvider,
                    model: payloadModel,
                    tokenUsage: {
                        inputTokens: 1000,
                        outputTokens: 500,
                        totalTokens: 1500,
                    },
                })
            );

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Should use payload model for pricing (not llmConfig)
            // This ensures correct cost attribution when switching models
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenCalledWith(
                sessionId,
                expect.any(Object),
                expect.any(Number), // Cost calculated for payload model
                expect.objectContaining({
                    provider: payloadProvider,
                    model: payloadModel,
                })
            );
        });

        test('should handle token accumulation errors gracefully', async () => {
            // Mock accumulateTokenUsage to throw error
            mockServices.sessionManager.accumulateTokenUsage = vi
                .fn()
                .mockRejectedValue(new Error('Storage error'));

            // Emit llm:response
            chatSession.eventBus.emit(
                'llm:response',
                createModelResponseEvent({
                    tokenUsage: {
                        inputTokens: 100,
                        outputTokens: 50,
                        totalTokens: 150,
                    },
                })
            );

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Should log warning but not throw (fire-and-forget pattern)
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to accumulate token usage')
            );
        });

        test('normalizes provider null token counts before accumulation', async () => {
            const payload = {
                content: 'Test response',
                finishReason: 'stop',
                provider: 'dexto-nova',
                model: 'openai/gpt-5-mini',
                tokenUsage: {
                    inputTokens: null,
                    outputTokens: 6,
                    reasoningTokens: null,
                    cacheReadTokens: null,
                    cacheWriteTokens: 0,
                    totalTokens: 4560,
                },
            } as unknown as ModelResponseEvent;

            chatSession.eventBus.emit('llm:response', payload);

            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenCalledWith(
                sessionId,
                {
                    inputTokens: 0,
                    outputTokens: 6,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    totalTokens: 4560,
                },
                expect.any(Number),
                {
                    provider: 'dexto-nova',
                    model: 'openai/gpt-5-mini',
                }
            );
        });

        test('should not accumulate tokens for blocked interaction events', async () => {
            chatSession.eventBus.emit('interaction:blocked', {
                content: 'Test response',
                provider: mockLLMConfig.provider,
                model: mockLLMConfig.model,
                messageId: 'blocked_message_id',
            });

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Should NOT call accumulateTokenUsage
            expect(mockServices.sessionManager.accumulateTokenUsage).not.toHaveBeenCalled();
        });

        test('marks ChatGPT Login sessions as untracked instead of accumulating zero token usage', async () => {
            mockServices.stateManager.getLLMConfig = vi.fn().mockReturnValue({
                ...mockLLMConfig,
                provider: 'openai-compatible',
                model: 'gpt-5.4',
                baseURL: 'codex://chatgpt',
                apiKey: 'ignored-for-codex',
            });

            chatSession.eventBus.emit(
                'llm:response',
                createModelResponseEvent({
                    content: 'ChatGPT response',
                    provider: 'openai-compatible',
                    model: 'gpt-5.4',
                    tokenUsage: {
                        inputTokens: 0,
                        outputTokens: 0,
                        reasoningTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                        totalTokens: 0,
                    },
                })
            );

            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(mockServices.sessionManager.markUntrackedChatGPTLoginUsage).toHaveBeenCalledWith(
                sessionId
            );
            expect(mockServices.sessionManager.accumulateTokenUsage).not.toHaveBeenCalled();
        });

        test('should handle multiple models in same session', async () => {
            // First model: OpenAI GPT-4
            chatSession.eventBus.emit(
                'llm:response',
                createModelResponseEvent({
                    content: 'Response from GPT-4',
                    provider: 'openai',
                    model: 'gpt-4',
                    tokenUsage: {
                        inputTokens: 100,
                        outputTokens: 50,
                        totalTokens: 150,
                    },
                })
            );

            await new Promise((resolve) => setTimeout(resolve, 0));

            // Second model: Anthropic Claude
            chatSession.eventBus.emit(
                'llm:response',
                createModelResponseEvent({
                    content: 'Response from Claude',
                    provider: 'anthropic',
                    model: 'claude-4-opus-20250514',
                    tokenUsage: {
                        inputTokens: 200,
                        outputTokens: 100,
                        totalTokens: 300,
                    },
                })
            );

            await new Promise((resolve) => setTimeout(resolve, 0));

            // Third model: Back to OpenAI
            chatSession.eventBus.emit(
                'llm:response',
                createModelResponseEvent({
                    content: 'Another response from GPT-4',
                    provider: 'openai',
                    model: 'gpt-4',
                    tokenUsage: {
                        inputTokens: 50,
                        outputTokens: 25,
                        totalTokens: 75,
                    },
                })
            );

            await new Promise((resolve) => setTimeout(resolve, 0));

            // Should have been called 3 times with correct models
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenCalledTimes(3);

            // First call: OpenAI
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenNthCalledWith(
                1,
                sessionId,
                expect.objectContaining({
                    inputTokens: 100,
                    outputTokens: 50,
                }),
                expect.any(Number),
                expect.objectContaining({
                    provider: 'openai',
                    model: 'gpt-4',
                })
            );

            // Second call: Anthropic
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenNthCalledWith(
                2,
                sessionId,
                expect.objectContaining({
                    inputTokens: 200,
                    outputTokens: 100,
                }),
                expect.any(Number),
                expect.objectContaining({
                    provider: 'anthropic',
                    model: 'claude-4-opus-20250514',
                })
            );

            // Third call: OpenAI again
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenNthCalledWith(
                3,
                sessionId,
                expect.objectContaining({
                    inputTokens: 50,
                    outputTokens: 25,
                }),
                expect.any(Number),
                expect.objectContaining({
                    provider: 'openai',
                    model: 'gpt-4',
                })
            );
        });
    });
});
