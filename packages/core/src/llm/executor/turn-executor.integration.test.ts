import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { z } from 'zod';
import { parseTurnDriverState, TurnExecutor, type TurnDriverState } from './turn-executor.js';
import { ContextManager } from '../../context/manager.js';
import { ToolManager } from '../../tools/tool-manager.js';
import { defineTool } from '../../tools/define-tool.js';
import { SessionEventBus, AgentEventBus } from '../../events/index.js';
import { ResourceManager } from '../../resources/index.js';
import { MessageQueueService } from '../../session/message-queue.js';
import { SystemPromptManager } from '../../systemPrompt/manager.js';
import { VercelMessageFormatter } from '../formatters/vercel.js';
import { MCPManager } from '../../mcp/manager.js';
import { ApprovalManager } from '../../approval/manager.js';
import { createLogger } from '../../logger/factory.js';
import { MemoryManager } from '../../memory/index.js';
import { SystemPromptConfigSchema } from '../../systemPrompt/schemas.js';
import type { LanguageModel, ModelMessage } from 'ai';
import type { LLMContext } from '@dexto/llm';
import type { ValidatedLLMConfig } from '../schemas.js';
import type { Logger } from '../../logger/v2/types.js';
import type { CompactionStrategy } from '../../context/compaction/types.js';
import type { InternalMessage } from '../../context/types.js';
import { InMemoryDextoStores } from '../../storage/stores/in-memory.js';
import type { DextoStores } from '../../storage/index.js';
import type { ConversationStore } from '../../storage/conversation/types.js';
import {
    createInMemoryMessageQueueStore,
    createInMemorySessionApprovalStore,
    createInMemorySessionToolPreferencesStore,
} from '../../test-utils/session-state-stores.js';
import { ApprovalStatus } from '../../approval/types.js';
import type { ApprovalHandler, ApprovalRequest, ApprovalResponse } from '../../approval/types.js';
import { createAgentRunContext, type AgentRunContext } from '../../runtime/run-context.js';
import { createToolExecutionId } from '../../storage/tool-executions/types.js';

// Only mock the AI SDK's streamText/generateText - everything else is real
vi.mock('ai', async (importOriginal) => {
    const actual = await importOriginal<typeof import('ai')>();
    return {
        ...actual,
        streamText: vi.fn(),
        generateText: vi.fn(),
    };
});

function createDeferred<T>() {
    let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
    let reject: ((reason?: unknown) => void) | undefined;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    if (resolve === undefined || reject === undefined) {
        throw new Error('Deferred promise callbacks were not initialized');
    }
    return {
        promise,
        resolve,
        reject,
    };
}

function serializeTurnDriverState(state: TurnDriverState): TurnDriverState {
    return parseTurnDriverState(JSON.parse(JSON.stringify(state)));
}

function createPendingApprovalHandler(): ApprovalHandler & {
    pending: Map<
        string,
        {
            request: ApprovalRequest;
            resolve: (response: ApprovalResponse) => void;
        }
    >;
    resolveApproval: (approvalId: string, response: Omit<ApprovalResponse, 'approvalId'>) => void;
} {
    const pending = new Map<
        string,
        {
            request: ApprovalRequest;
            resolve: (response: ApprovalResponse) => void;
        }
    >();
    const handler = Object.assign(
        (request: ApprovalRequest) =>
            new Promise<ApprovalResponse>((resolve) => {
                pending.set(request.approvalId, { request, resolve });
            }),
        {
            pending,
            resolveApproval: (
                approvalId: string,
                response: Omit<ApprovalResponse, 'approvalId'>
            ) => {
                const entry = pending.get(approvalId);
                if (entry === undefined) {
                    throw new Error(`No pending approval for ${approvalId}`);
                }
                pending.delete(approvalId);
                entry.resolve({ ...response, approvalId });
            },
            getPending: () => Array.from(pending.keys()),
            getPendingRequests: () => Array.from(pending.values()).map((entry) => entry.request),
            autoApprovePending: (
                predicate: (request: ApprovalRequest) => boolean,
                responseData?: Record<string, unknown>
            ) => {
                let count = 0;
                for (const [approvalId, entry] of Array.from(pending.entries())) {
                    if (!predicate(entry.request)) {
                        continue;
                    }
                    pending.delete(approvalId);
                    count += 1;
                    entry.resolve({
                        approvalId,
                        status: ApprovalStatus.APPROVED,
                        sessionId: entry.request.sessionId,
                        ...(responseData !== undefined ? { data: responseData } : {}),
                    });
                }
                return count;
            },
        }
    );
    return handler;
}

vi.mock('@opentelemetry/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@opentelemetry/api')>();
    return {
        ...actual,
        trace: {
            ...actual.trace,
            getTracer: actual.trace.getTracer.bind(actual.trace),
            getActiveSpan: vi.fn(() => null),
        },
    };
});

import { APICallError, streamText, generateText } from 'ai';

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
                input: tc.args,
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

function createTestCompactionStrategy(
    shouldCompact: CompactionStrategy['shouldCompact']
): CompactionStrategy {
    const compact = vi.fn(
        async (history: readonly InternalMessage[]): Promise<InternalMessage[]> => [
            {
                role: 'assistant',
                content: [
                    {
                        type: 'text',
                        text: '<session_compaction>Compacted test summary</session_compaction>',
                    },
                ],
                metadata: {
                    isSummary: true,
                    originalMessageCount: history.length,
                },
            },
        ]
    );

    return {
        name: 'test-compaction',
        getSettings: () => ({ enabled: true, thresholdPercent: 0.9 }),
        getModelLimits: (contextWindow) => ({ contextWindow }),
        shouldCompact: vi.fn(shouldCompact),
        compact,
    };
}

describe('TurnExecutor Integration Tests', () => {
    let executor: TurnExecutor;
    let contextManager: ContextManager<ModelMessage>;
    let toolManager: ToolManager;
    let sessionEventBus: SessionEventBus;
    let agentEventBus: AgentEventBus;
    let resourceManager: ResourceManager;
    let steerQueue: MessageQueueService;
    let followUpQueue: MessageQueueService;
    let logger: Logger;
    let conversationStore: ConversationStore;
    let mcpManager: MCPManager;
    let approvalManager: ApprovalManager;
    let stores: DextoStores;

    const sessionId = 'test-session';
    const llmContext: LLMContext = { provider: 'openai', model: 'gpt-4' };

    function createContextManagerFromPersistedStore(): ContextManager<ModelMessage> {
        const memoryManager = new MemoryManager(stores.getStore('memories'), logger);
        const systemPromptConfig = SystemPromptConfigSchema.parse('You are a helpful assistant.');
        const systemPromptManager = new SystemPromptManager(
            systemPromptConfig,
            memoryManager,
            undefined,
            logger
        );
        const formatter = new VercelMessageFormatter(logger);
        const llmConfig = {
            provider: 'openai',
            model: 'gpt-4',
            apiKey: 'test-api-key',
            maxInputTokens: 100000,
            maxOutputTokens: 4096,
            temperature: 0.7,
            maxIterations: 10,
        } as unknown as ValidatedLLMConfig;

        return new ContextManager<ModelMessage>(
            llmConfig,
            formatter,
            systemPromptManager,
            100000,
            conversationStore,
            sessionId,
            resourceManager,
            logger
        );
    }

    function createExecutorWithContext(
        persistedContextManager: ContextManager<ModelMessage>,
        externalSignal?: AbortSignal,
        runContext?: AgentRunContext,
        compactionStrategy: CompactionStrategy | null = null
    ): TurnExecutor {
        return new TurnExecutor(
            createMockModel(),
            toolManager,
            persistedContextManager,
            sessionEventBus,
            resourceManager,
            sessionId,
            { maxSteps: 10, maxOutputTokens: 4096, temperature: 0.7 },
            llmContext,
            logger,
            steerQueue,
            followUpQueue,
            compactionStrategy === null ? undefined : { contextWindow: 100_000 },
            externalSignal,
            compactionStrategy,
            runContext
        );
    }

    async function seedCompactionEligibleHistory() {
        await contextManager.addUserMessage([{ type: 'text', text: 'Message 1 before summary' }]);
        await contextManager.addAssistantMessage('Response 1 before summary', []);
        await contextManager.addUserMessage([{ type: 'text', text: 'Message 2 before summary' }]);
        await contextManager.addAssistantMessage('Response 2 before summary', []);
    }

    function restartExecutor(externalSignal?: AbortSignal) {
        const restartedContextManager = createContextManagerFromPersistedStore();
        return {
            contextManager: restartedContextManager,
            executor: createExecutorWithContext(restartedContextManager, externalSignal),
        };
    }

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

        stores = new InMemoryDextoStores();
        await stores.connect();

        // Create real MCP manager
        mcpManager = new MCPManager(logger, agentEventBus);

        // Create real resource manager with proper wiring
        resourceManager = new ResourceManager(
            mcpManager,
            {
                resourcesConfig: [],
                artifactStore: stores.getStore('artifacts'),
            },
            agentEventBus,
            logger
        );
        await resourceManager.initialize();

        // Create real conversation store
        conversationStore = stores.getStore('conversation');

        contextManager = createContextManagerFromPersistedStore();

        // Create real approval manager
        approvalManager = new ApprovalManager(
            {
                permissions: { mode: 'auto-approve', timeout: 120000 },
                elicitation: { enabled: false, timeout: 120000 },
            },
            logger,
            createInMemorySessionApprovalStore(logger)
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
            { alwaysAllow: [] },
            [],
            logger,
            createInMemorySessionToolPreferencesStore(logger),
            stores.getStore('toolExecutions')
        );
        await toolManager.initialize();
        toolManager.setToolExecutionContextFactory((baseContext) => baseContext);

        // Create real steer queue
        steerQueue = new MessageQueueService(
            sessionEventBus,
            logger,
            sessionId,
            createInMemoryMessageQueueStore()
        );
        followUpQueue = new MessageQueueService(
            sessionEventBus,
            logger,
            sessionId,
            createInMemoryMessageQueueStore(),
            'follow-up'
        );

        // Default streamText mock - simple text response
        vi.mocked(streamText).mockImplementation(
            () =>
                createMockStream({ text: 'Hello!', finishReason: 'stop' }) as unknown as ReturnType<
                    typeof streamText
                >
        );

        // Create executor with real components
        executor = createExecutorWithContext(contextManager);
    });

    afterEach(async () => {
        Reflect.deleteProperty(globalThis, '__TELEMETRY__');
        vi.restoreAllMocks();
        await stores.disconnect();
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

        it('can drive a turn through the explicit turn driver boundary', async () => {
            const runCompleteHandler = vi.fn();
            sessionEventBus.on('run:complete', runCompleteHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            const driver = await executor.createDriver({ mcpManager }, { streaming: true });

            try {
                const modelStep = await driver.runNextModelStep();
                const next = await driver.decideNextStep();
                const result = await driver.finish();

                expect(modelStep.stepCount).toBe(0);
                expect(modelStep.result.text).toBe('Hello!');
                expect(next).toEqual(
                    expect.objectContaining({
                        kind: 'stop',
                        finishReason: 'stop',
                    })
                );
                expect(result).toEqual(
                    expect.objectContaining({
                        finishReason: 'stop',
                        text: 'Hello!',
                        usage: {
                            inputTokens: 100,
                            outputTokens: 50,
                            totalTokens: 150,
                            cacheReadTokens: 0,
                            cacheWriteTokens: 0,
                        },
                    })
                );
                expect(runCompleteHandler).toHaveBeenCalledWith(
                    expect.objectContaining({
                        finishReason: 'stop',
                        stepCount: 0,
                    })
                );
            } finally {
                driver.dispose();
            }
        });

        it('can checkpoint after preparing the next model step without calling the model', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            const driver = await executor.createDriver({ mcpManager }, { streaming: true });

            try {
                const prepared = await driver.prepareNextModelStep();
                const savedState = serializeTurnDriverState(driver.checkpoint());

                expect(prepared).toEqual({ stepCount: 0 });
                expect(streamText).not.toHaveBeenCalled();
                expect(savedState).toEqual(
                    expect.objectContaining({
                        phase: 'model-step-prepared',
                        stepCount: 0,
                        modelStepId: 'in-memory-model-step-0',
                        request: expect.objectContaining({
                            estimatedInputTokens: expect.any(Number),
                            streaming: true,
                        }),
                    })
                );
            } finally {
                driver.dispose();
            }
        });

        it('does not checkpoint while model preparation is in flight', async () => {
            const releaseCompaction = createDeferred<InternalMessage[]>();
            const compactionStrategy = createTestCompactionStrategy((tokens) => tokens > 10);
            vi.mocked(compactionStrategy.compact).mockReturnValueOnce(releaseCompaction.promise);
            const compactingExecutor = createExecutorWithContext(
                contextManager,
                undefined,
                undefined,
                compactionStrategy
            );

            await seedCompactionEligibleHistory();
            const driver = await compactingExecutor.createDriver(
                { mcpManager },
                { streaming: true }
            );

            try {
                const preparing = driver.prepareNextModelStep();

                expect(() => driver.getState()).toThrow(
                    'Turn driver cannot checkpoint during model preparation'
                );
                releaseCompaction.resolve([
                    {
                        role: 'assistant',
                        content: [
                            {
                                type: 'text',
                                text: '<session_compaction>Prepared summary</session_compaction>',
                            },
                        ],
                        metadata: {
                            isSummary: true,
                            originalMessageCount: 4,
                        },
                    },
                ]);
                await preparing;
            } finally {
                driver.dispose();
            }
        });

        it('can retry preparation after a transient preparation failure', async () => {
            const compactionStrategy = createTestCompactionStrategy((tokens) => tokens > 10);
            vi.mocked(compactionStrategy.compact)
                .mockRejectedValueOnce(new Error('Temporary compaction failure'))
                .mockResolvedValueOnce([
                    {
                        role: 'assistant',
                        content: [
                            {
                                type: 'text',
                                text: '<session_compaction>Prepared after retry</session_compaction>',
                            },
                        ],
                        metadata: {
                            isSummary: true,
                            originalMessageCount: 4,
                        },
                    },
                ]);
            const compactingExecutor = createExecutorWithContext(
                contextManager,
                undefined,
                undefined,
                compactionStrategy
            );

            await seedCompactionEligibleHistory();
            const driver = await compactingExecutor.createDriver(
                { mcpManager },
                { streaming: true }
            );

            try {
                await expect(driver.prepareNextModelStep()).rejects.toThrow(
                    'Temporary compaction failure'
                );

                await expect(driver.prepareNextModelStep()).resolves.toEqual({ stepCount: 0 });
                expect(driver.getState()).toEqual(
                    expect.objectContaining({
                        phase: 'model-step-prepared',
                        stepCount: 0,
                    })
                );
            } finally {
                driver.dispose();
            }
        });

        it('rehydrates a prepared model step and runs the cached request', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            const firstDriver = await executor.createDriver({ mcpManager }, { streaming: true });
            await firstDriver.prepareNextModelStep();
            const savedState = serializeTurnDriverState(firstDriver.checkpoint());
            const restarted = restartExecutor();

            const rehydratedDriver = await restarted.executor.createDriver(
                { mcpManager },
                { streaming: true, state: savedState }
            );

            try {
                const modelStep = await rehydratedDriver.runNextModelStep();

                expect(savedState.phase).toBe('model-step-prepared');
                expect(modelStep.stepCount).toBe(0);
                expect(modelStep.result.text).toBe('Hello!');
                expect(streamText).toHaveBeenCalledTimes(1);
                expect(rehydratedDriver.getState()).toEqual(
                    expect.objectContaining({
                        phase: 'model-step-complete',
                        stepCount: 0,
                        toolCallsExecuted: true,
                    })
                );
            } finally {
                rehydratedDriver.dispose();
            }
        });

        it('rehydrates the prepared tool definitions instead of rediscovering tools', async () => {
            toolManager.addTools([
                defineTool({
                    id: 'snapshot_tool',
                    description: 'Original tool description',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: vi.fn().mockResolvedValue('unused'),
                }),
            ]);
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            const firstDriver = await executor.createDriver({ mcpManager }, { streaming: true });
            await firstDriver.prepareNextModelStep();
            const savedState = serializeTurnDriverState(firstDriver.checkpoint());
            firstDriver.dispose();
            toolManager.setTools([
                defineTool({
                    id: 'snapshot_tool',
                    description: 'Changed tool description',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: vi.fn().mockResolvedValue('unused'),
                }),
            ]);
            const restarted = restartExecutor();

            const rehydratedDriver = await restarted.executor.createDriver(
                { mcpManager },
                { streaming: true, state: savedState }
            );

            try {
                await rehydratedDriver.runNextModelStep();

                expect(streamText).toHaveBeenCalledWith(
                    expect.objectContaining({
                        tools: expect.objectContaining({
                            snapshot_tool: expect.objectContaining({
                                description: 'Original tool description',
                            }),
                        }),
                    })
                );
            } finally {
                rehydratedDriver.dispose();
            }
        });

        it('rehydrates a completed terminal model step before deciding and finishing', async () => {
            const thinkingHandler = vi.fn();
            const runCompleteHandler = vi.fn();
            sessionEventBus.on('llm:thinking', thinkingHandler);
            sessionEventBus.on('run:complete', runCompleteHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            const firstDriver = await executor.createDriver({ mcpManager }, { streaming: true });
            const modelStep = await firstDriver.runNextModelStep();
            const savedState = serializeTurnDriverState(firstDriver.checkpoint());
            const restarted = restartExecutor();

            const rehydratedDriver = await restarted.executor.createDriver(
                { mcpManager },
                { streaming: true, state: savedState }
            );

            try {
                const next = await rehydratedDriver.decideNextStep();
                const result = await rehydratedDriver.finish();

                expect(savedState).toEqual(
                    expect.objectContaining({
                        phase: 'model-step-complete',
                        stepCount: 0,
                        startedAtMs: expect.any(Number),
                        toolCallsExecuted: true,
                    })
                );
                expect(modelStep.result.text).toBe('Hello!');
                expect(thinkingHandler).toHaveBeenCalledTimes(1);
                expect(next).toEqual(
                    expect.objectContaining({
                        kind: 'stop',
                        finishReason: 'stop',
                    })
                );
                expect(result).toEqual(
                    expect.objectContaining({
                        finishReason: 'stop',
                        stepCount: 0,
                        text: 'Hello!',
                        usage: {
                            inputTokens: 100,
                            outputTokens: 50,
                            totalTokens: 150,
                            cacheReadTokens: 0,
                            cacheWriteTokens: 0,
                        },
                    })
                );
                expect(runCompleteHandler).toHaveBeenCalledTimes(1);
            } finally {
                rehydratedDriver.dispose();
            }
        });

        it('does not checkpoint while a model step is in flight', async () => {
            const releaseStream = createDeferred<void>();
            vi.mocked(streamText).mockImplementationOnce(
                () =>
                    ({
                        fullStream: (async function* () {
                            await releaseStream.promise;
                            yield {
                                type: 'finish',
                                finishReason: 'stop',
                                totalUsage: {
                                    inputTokens: 100,
                                    outputTokens: 50,
                                    totalTokens: 150,
                                },
                            };
                        })(),
                    }) as unknown as ReturnType<typeof streamText>
            );
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            const driver = await executor.createDriver({ mcpManager }, { streaming: true });

            try {
                const modelStep = driver.runNextModelStep();

                expect(() => driver.getState()).toThrow(
                    'Turn driver cannot checkpoint during a model step'
                );
                releaseStream.resolve();
                await modelStep;
            } finally {
                driver.dispose();
            }
        });

        it('does not clear queued steer messages when checkpointing', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            const driver = await executor.createDriver({ mcpManager }, { streaming: true });

            await driver.runNextModelStep();
            await steerQueue.enqueue({ content: [{ type: 'text', text: 'continue this turn' }] });
            const savedState = serializeTurnDriverState(driver.checkpoint());

            expect(savedState.phase).toBe('model-step-complete');
            expect(steerQueue.getAll()).toEqual([
                expect.objectContaining({
                    content: [{ type: 'text', text: 'continue this turn' }],
                }),
            ]);
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

            expect(thinkingHandler).toHaveBeenCalledWith({});
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
        it('executes every sibling tool result before the next model step', async () => {
            toolManager.addTools([
                defineTool({
                    id: 'first_tool',
                    description: 'First tool',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: vi.fn().mockResolvedValue('first result'),
                }),
                defineTool({
                    id: 'second_tool',
                    description: 'Second tool',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: vi.fn().mockResolvedValue('second result'),
                }),
            ]);

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-first',
                                    toolName: 'first_tool',
                                    args: { value: 'one' },
                                },
                                {
                                    toolCallId: 'call-second',
                                    toolName: 'second_tool',
                                    args: { value: 'two' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'done',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            await contextManager.addUserMessage([{ type: 'text', text: 'Use tools' }]);
            const result = await executor.execute({ mcpManager }, true);

            expect(result.finishReason).toBe('stop');
            expect(streamText).toHaveBeenCalledTimes(2);
            const history = await contextManager.getHistory();
            const toolMessages = history.filter((message) => message.role === 'tool');
            expect(toolMessages).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        toolCallId: 'call-first',
                        name: 'first_tool',
                        success: true,
                    }),
                    expect.objectContaining({
                        toolCallId: 'call-second',
                        name: 'second_tool',
                        success: true,
                    }),
                ])
            );
            expect(toolMessages).toHaveLength(2);
        });

        it('drives tool-call steps through the explicit turn driver boundary', async () => {
            const toolExecution = createDeferred<string>();
            const executeTool = vi.fn(() => toolExecution.promise);
            toolManager.addTools([
                defineTool({
                    id: 'driver_tool',
                    description: 'Driver tool',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: executeTool,
                }),
            ]);

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-driver',
                                    toolName: 'driver_tool',
                                    args: { value: 'one' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'done',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            await contextManager.addUserMessage([{ type: 'text', text: 'Use tools' }]);
            const driver = await executor.createDriver({ mcpManager }, { streaming: true });

            try {
                const toolStep = await driver.runNextModelStep();

                await expect(driver.decideNextStep()).rejects.toThrow(
                    'Tool calls must finish before deciding the next model step'
                );
                const firstToolExecution = driver.executeToolCalls();
                await expect(driver.executeToolCalls()).rejects.toThrow(
                    'Tool calls for the current model step have already run'
                );
                toolExecution.resolve('driver result');
                await firstToolExecution;
                expect(await driver.decideNextStep()).toEqual({
                    kind: 'continue',
                    stepCount: 1,
                });

                const finalStep = await driver.runNextModelStep();
                const stop = await driver.decideNextStep();
                const result = await driver.finish();

                expect(toolStep.result.finishReason).toBe('tool-calls');
                expect(finalStep.result.text).toBe('done');
                expect(stop).toEqual(
                    expect.objectContaining({
                        kind: 'stop',
                        finishReason: 'stop',
                    })
                );
                expect(result.text).toBe('done');
                expect(executeTool).toHaveBeenCalledTimes(1);
                expect(streamText).toHaveBeenCalledTimes(2);
                const history = await contextManager.getHistory();
                const driverToolMessages = history.filter(
                    (message) => message.role === 'tool' && message.toolCallId === 'call-driver'
                );
                expect(driverToolMessages).toEqual([
                    expect.objectContaining({
                        name: 'driver_tool',
                        success: true,
                    }),
                ]);
            } finally {
                driver.dispose();
            }
        });

        it('records turn loop spans for model steps and tool execution', async () => {
            const exporter = new InMemorySpanExporter();
            const provider = new BasicTracerProvider();
            provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
            provider.register();
            Reflect.set(globalThis, '__TELEMETRY__', { isInitialized: () => true });

            const executeTool = vi.fn(async () => 'telemetry result');
            toolManager.addTools([
                defineTool({
                    id: 'telemetry_tool',
                    description: 'Telemetry tool',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: executeTool,
                }),
            ]);

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-telemetry',
                                    toolName: 'telemetry_tool',
                                    args: { value: 'one' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'done',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            try {
                await contextManager.addUserMessage([{ type: 'text', text: 'Use tools' }]);
                await expect(executor.execute({ mcpManager }, true)).resolves.toMatchObject({
                    finishReason: 'stop',
                    text: 'done',
                });

                const spans = exporter.getFinishedSpans();
                const names = spans.map((span) => span.name);

                expect(names).toEqual(
                    expect.arrayContaining([
                        'turn.run_model_step',
                        'llm.stream',
                        'turn.execute_tool_calls',
                        'tool.prepare',
                        'tool.execute',
                        'tool.persist_result',
                        'turn.decide_next_step',
                    ])
                );

                const firstModelStep = spans.find(
                    (span) =>
                        span.name === 'turn.run_model_step' &&
                        span.attributes['turn.step_count'] === 0
                );
                const stream = spans.find((span) => span.name === 'llm.stream');
                const executeTools = spans.find((span) => span.name === 'turn.execute_tool_calls');
                const toolExecute = spans.find((span) => span.name === 'tool.execute');

                expect(firstModelStep?.attributes).toEqual(
                    expect.objectContaining({
                        'llm.finish_reason': 'tool-calls',
                        'llm.model': 'gpt-4',
                        'llm.provider': 'openai',
                        'tool.count': 1,
                        'turn.step_count': 0,
                    })
                );
                expect(stream?.attributes).toEqual(
                    expect.objectContaining({
                        'llm.finish_reason': 'tool-calls',
                        'tool.count': 1,
                    })
                );
                expect(executeTools?.attributes).toEqual(
                    expect.objectContaining({
                        'tool.count': 1,
                        'turn.step_count': 0,
                    })
                );
                expect(toolExecute?.attributes).toEqual(
                    expect.objectContaining({
                        'tool.call_id': 'call-telemetry',
                        'tool.name': 'telemetry_tool',
                        'tool.success': true,
                    })
                );
                expect(stream).toBeDefined();
                expect(firstModelStep).toBeDefined();
                expect(executeTools).toBeDefined();
                expect(toolExecute).toBeDefined();
                if (
                    stream === undefined ||
                    firstModelStep === undefined ||
                    executeTools === undefined ||
                    toolExecute === undefined
                ) {
                    throw new Error('Expected telemetry spans to be recorded.');
                }
            } finally {
                Reflect.deleteProperty(globalThis, '__TELEMETRY__');
                await provider.shutdown();
            }
        });

        it('rehydrates a tool-call model step before executing tools', async () => {
            const toolExecutionResult = createDeferred<string>();
            const executeTool = vi.fn(() => toolExecutionResult.promise);
            toolManager.addTools([
                defineTool({
                    id: 'driver_tool',
                    description: 'Driver tool',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: executeTool,
                }),
            ]);

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-rehydrate-driver',
                                    toolName: 'driver_tool',
                                    args: { value: 'one' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'done',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            await contextManager.addUserMessage([{ type: 'text', text: 'Use tools' }]);
            const firstDriver = await executor.createDriver({ mcpManager }, { streaming: true });
            const toolStep = await firstDriver.runNextModelStep();
            const savedState = serializeTurnDriverState(firstDriver.checkpoint());
            const restarted = restartExecutor();

            const rehydratedDriver = await restarted.executor.createDriver(
                { mcpManager },
                { streaming: true, state: savedState }
            );

            try {
                await expect(rehydratedDriver.decideNextStep()).rejects.toThrow(
                    'Tool calls must finish before deciding the next model step'
                );
                const toolExecution = rehydratedDriver.executeToolCalls();
                expect(() => rehydratedDriver.getState()).toThrow(
                    'Turn driver cannot checkpoint during tool execution'
                );
                toolExecutionResult.resolve('driver result');
                await toolExecution;
                expect(await rehydratedDriver.decideNextStep()).toEqual({
                    kind: 'continue',
                    stepCount: 1,
                });
                const readyState = serializeTurnDriverState(rehydratedDriver.checkpoint());
                const secondRestart = restartExecutor();

                const readyDriver = await secondRestart.executor.createDriver(
                    { mcpManager },
                    { streaming: true, state: readyState }
                );
                const finalStep = await readyDriver.runNextModelStep();
                const stop = await readyDriver.decideNextStep();
                const result = await readyDriver.finish();
                readyDriver.dispose();

                expect(savedState).toEqual(
                    expect.objectContaining({
                        phase: 'model-step-complete',
                        stepCount: 0,
                        startedAtMs: expect.any(Number),
                        toolCallsExecuted: false,
                    })
                );
                expect(readyState).toEqual(
                    expect.objectContaining({
                        phase: 'ready-for-model',
                        stepCount: 1,
                        startedAtMs: savedState.startedAtMs,
                    })
                );
                expect(toolStep.result.finishReason).toBe('tool-calls');
                expect(finalStep.result.text).toBe('done');
                expect(stop).toEqual(
                    expect.objectContaining({
                        kind: 'stop',
                        finishReason: 'stop',
                    })
                );
                expect(result.text).toBe('done');
                expect(executeTool).toHaveBeenCalledTimes(1);
                expect(streamText).toHaveBeenCalledTimes(2);
                const secondMessages = vi.mocked(streamText).mock.calls[1]?.[0].messages;
                expect(JSON.stringify(secondMessages)).toContain('call-rehydrate-driver');
                expect(JSON.stringify(secondMessages)).toContain('driver result');
                const history = await contextManager.getHistory();
                const driverToolMessages = history.filter(
                    (message) =>
                        message.role === 'tool' && message.toolCallId === 'call-rehydrate-driver'
                );
                expect(driverToolMessages).toEqual([
                    expect.objectContaining({
                        name: 'driver_tool',
                        success: true,
                    }),
                ]);
            } finally {
                rehydratedDriver.dispose();
            }
        });

        it('records model tool execution with the current model step when host context omits modelStepId', async () => {
            const executeTool = vi.fn(() => 'driver result');
            toolManager.addTools([
                defineTool({
                    id: 'driver_tool',
                    description: 'Driver tool',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: executeTool,
                }),
            ]);

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-host-context',
                                    toolName: 'driver_tool',
                                    args: { value: 'one' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'done',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            const runContext = createAgentRunContext({
                sessionId,
                hostRuntime: {
                    ids: {
                        runId: 'run-cloud',
                        turnId: 'turn-cloud',
                    },
                },
            });
            const hostedExecutor = createExecutorWithContext(contextManager, undefined, runContext);

            await contextManager.addUserMessage([{ type: 'text', text: 'Use tools' }]);
            const result = await hostedExecutor.execute({ mcpManager }, true);

            const executionId = createToolExecutionId({
                runId: 'run-cloud',
                turnId: 'turn-cloud',
                modelStepId: 'in-memory-model-step-0',
                toolCallId: 'call-host-context',
            });
            await expect(stores.getStore('toolExecutions').get({ executionId })).resolves.toEqual(
                expect.objectContaining({
                    identity: {
                        runId: 'run-cloud',
                        turnId: 'turn-cloud',
                        modelStepId: 'in-memory-model-step-0',
                        toolCallId: 'call-host-context',
                    },
                    status: 'completed',
                    toolName: 'driver_tool',
                })
            );
            expect(result.text).toBe('done');
            expect(executeTool).toHaveBeenCalledTimes(1);
        });

        it('preserves external cancellation when rehydrating before tool execution', async () => {
            const executeTool = vi.fn().mockResolvedValue('should not run');
            toolManager.addTools([
                defineTool({
                    id: 'cancelled_driver_tool',
                    description: 'Cancelled driver tool',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: executeTool,
                }),
            ]);

            vi.mocked(streamText).mockImplementationOnce(
                () =>
                    createMockStream({
                        finishReason: 'tool-calls',
                        toolCalls: [
                            {
                                toolCallId: 'call-cancelled-rehydrate',
                                toolName: 'cancelled_driver_tool',
                                args: { value: 'one' },
                            },
                        ],
                    }) as unknown as ReturnType<typeof streamText>
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Use tools' }]);
            const firstDriver = await executor.createDriver({ mcpManager }, { streaming: true });
            await firstDriver.runNextModelStep();
            const savedState = serializeTurnDriverState(firstDriver.checkpoint());

            const abortController = new AbortController();
            abortController.abort();
            const restarted = restartExecutor(abortController.signal);
            const rehydratedDriver = await restarted.executor.createDriver(
                { mcpManager },
                { streaming: true, state: savedState }
            );

            try {
                await rehydratedDriver.executeToolCalls();
                const stop = await rehydratedDriver.decideNextStep();

                expect(stop).toEqual({
                    kind: 'stop',
                    stepCount: 0,
                    finishReason: 'cancelled',
                });
                expect(executeTool).not.toHaveBeenCalled();
                const history = await restarted.contextManager.getHistory();
                expect(history).toContainEqual(
                    expect.objectContaining({
                        role: 'tool',
                        toolCallId: 'call-cancelled-rehydrate',
                        name: 'cancelled_driver_tool',
                        success: false,
                        content: [
                            {
                                type: 'text',
                                text: '{"error":"Cancelled by user","cancelled":true}',
                            },
                        ],
                    })
                );
            } finally {
                rehydratedDriver.dispose();
            }
        });

        it('rehydrates a stopped turn before finishing', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            const firstDriver = await executor.createDriver({ mcpManager }, { streaming: true });
            await firstDriver.runNextModelStep();
            const stop = await firstDriver.decideNextStep();
            const savedState = serializeTurnDriverState(firstDriver.checkpoint());
            const restarted = restartExecutor();

            const rehydratedDriver = await restarted.executor.createDriver(
                { mcpManager },
                { streaming: true, state: savedState }
            );

            try {
                const result = await rehydratedDriver.finish();

                expect(stop).toEqual(
                    expect.objectContaining({
                        kind: 'stop',
                        finishReason: 'stop',
                    })
                );
                expect(savedState).toEqual(
                    expect.objectContaining({
                        phase: 'stopped',
                        stepCount: 0,
                        startedAtMs: expect.any(Number),
                        lastFinishReason: 'stop',
                    })
                );
                expect(result).toEqual(
                    expect.objectContaining({
                        finishReason: 'stop',
                        stepCount: 0,
                        text: 'Hello!',
                        usage: {
                            inputTokens: 100,
                            outputTokens: 50,
                            totalTokens: 150,
                            cacheReadTokens: 0,
                            cacheWriteTokens: 0,
                        },
                    })
                );
                await expect(rehydratedDriver.runNextModelStep()).rejects.toThrow(
                    'Turn driver has already finished'
                );
            } finally {
                rehydratedDriver.dispose();
            }
        });

        it('passes model-only tool definitions to streamText', async () => {
            toolManager.addTools([
                defineTool({
                    id: 'sdk_only',
                    description: 'SDK only tool',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: vi.fn().mockResolvedValue('tool result'),
                }),
            ]);

            await contextManager.addUserMessage([{ type: 'text', text: 'Use tools' }]);
            await executor.execute({ mcpManager }, true);

            const firstCallOptions = vi.mocked(streamText).mock.calls[0]?.[0];
            expect(firstCallOptions).toEqual(
                expect.objectContaining({
                    tools: expect.objectContaining({
                        sdk_only: expect.objectContaining({
                            description: 'SDK only tool',
                        }),
                    }),
                })
            );
            expect(firstCallOptions).toEqual(
                expect.objectContaining({
                    tools: expect.objectContaining({
                        sdk_only: expect.not.objectContaining({
                            execute: expect.any(Function),
                        }),
                    }),
                })
            );
            expect(firstCallOptions).toEqual(
                expect.objectContaining({
                    tools: expect.objectContaining({
                        sdk_only: expect.not.objectContaining({
                            onInputAvailable: expect.any(Function),
                        }),
                    }),
                })
            );
        });

        it('preserves single-step model request options at the streamText boundary', async () => {
            toolManager.addTools([
                defineTool({
                    id: 'sdk_only',
                    description: 'SDK only tool',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: vi.fn().mockResolvedValue('tool result'),
                }),
            ]);

            await contextManager.addUserMessage([{ type: 'text', text: 'Use tools' }]);
            await executor.execute({ mcpManager }, true);

            const firstCallOptions = vi.mocked(streamText).mock.calls[0]?.[0];
            expect(firstCallOptions).toEqual(
                expect.objectContaining({
                    model: expect.objectContaining({ modelId: 'test-model' }),
                    messages: expect.arrayContaining([
                        expect.objectContaining({
                            role: 'user',
                            content: [{ type: 'text', text: 'Use tools' }],
                        }),
                    ]),
                    tools: expect.objectContaining({
                        sdk_only: expect.objectContaining({
                            description: 'SDK only tool',
                        }),
                    }),
                    maxOutputTokens: 4096,
                    maxRetries: 0,
                    temperature: 0.7,
                })
            );
            expect(firstCallOptions?.stopWhen).toBeDefined();
            expect(firstCallOptions?.abortSignal).toBeInstanceOf(AbortSignal);
        });

        it('passes provider reasoning options through the model step request', async () => {
            const reasoningExecutor = new TurnExecutor(
                createMockModel(),
                toolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10, reasoning: { variant: 'high' } },
                { provider: 'openai', model: 'gpt-5.2' },
                logger,
                steerQueue,
                followUpQueue
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Think harder' }]);
            await reasoningExecutor.execute({ mcpManager }, true);

            const firstCallOptions = vi.mocked(streamText).mock.calls[0]?.[0];
            expect(firstCallOptions).toEqual(
                expect.objectContaining({
                    providerOptions: {
                        openai: {
                            reasoningEffort: 'high',
                            reasoningSummary: 'auto',
                        },
                    },
                })
            );
        });

        it('preserves auto-approved write diff metadata through executor events and history', async () => {
            toolManager.addTools([
                defineTool({
                    id: 'write_file',
                    description: 'Write file',
                    inputSchema: z.object({ path: z.string(), content: z.string() }).strict(),
                    execute: vi.fn().mockResolvedValue({
                        ok: true,
                        _display: {
                            type: 'diff',
                            filename: 'src/app.ts',
                            unified: '--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new',
                            additions: 1,
                            deletions: 1,
                        },
                    }),
                    presentation: {
                        describeHeader: (input) => ({
                            title: 'Write',
                            argsText: input.path,
                        }),
                        describeResult: (_result, input) => ({
                            summaryText: `Updated ${input.path}`,
                        }),
                    },
                }),
            ]);
            const toolResultHandler = vi.fn();
            sessionEventBus.on('llm:tool-result', toolResultHandler);

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-write',
                                    toolName: 'write_file',
                                    args: { path: 'src/app.ts', content: 'new' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'done',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            await contextManager.addUserMessage([{ type: 'text', text: 'Write the file' }]);
            await executor.execute({ mcpManager }, true);

            expect(toolResultHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    toolName: 'write_file',
                    callId: 'call-write',
                    success: true,
                    presentationSnapshot: expect.objectContaining({
                        header: expect.objectContaining({
                            title: 'Write',
                            argsText: 'src/app.ts',
                        }),
                        result: {
                            summaryText: 'Updated src/app.ts',
                        },
                    }),
                    sanitized: expect.objectContaining({
                        meta: expect.objectContaining({
                            display: expect.objectContaining({
                                type: 'diff',
                                filename: 'src/app.ts',
                                additions: 1,
                                deletions: 1,
                            }),
                        }),
                    }),
                })
            );

            const history = await contextManager.getHistory();
            expect(history).toContainEqual(
                expect.objectContaining({
                    role: 'tool',
                    toolCallId: 'call-write',
                    name: 'write_file',
                    success: true,
                    presentationSnapshot: expect.objectContaining({
                        result: {
                            summaryText: 'Updated src/app.ts',
                        },
                    }),
                    displayData: expect.objectContaining({
                        type: 'diff',
                        filename: 'src/app.ts',
                    }),
                })
            );
        });

        it('records manual approval before executing a model tool call', async () => {
            const manualApprovalStore = createInMemorySessionApprovalStore(logger);
            const manualApprovalManager = new ApprovalManager(
                {
                    permissions: { mode: 'manual', timeout: 120000 },
                    elicitation: { enabled: false, timeout: 120000 },
                },
                logger,
                manualApprovalStore
            );
            const approvalStarted = createDeferred<void>();
            const approvalDecision = createDeferred<ApprovalResponse>();
            const approvalHandler = vi.fn(async (request) => {
                approvalStarted.resolve();
                return approvalDecision.promise.then((response) => ({
                    ...response,
                    approvalId: request.approvalId,
                }));
            });
            manualApprovalManager.setHandler(approvalHandler);

            const allowedToolsProvider = {
                isToolAllowed: vi.fn().mockResolvedValue(false),
                allowTool: vi.fn(),
                disallowTool: vi.fn(),
            };
            const manualToolManager = new ToolManager(
                mcpManager,
                manualApprovalManager,
                allowedToolsProvider,
                'manual',
                agentEventBus,
                { alwaysAllow: [] },
                [],
                logger,
                createInMemorySessionToolPreferencesStore(logger),
                new InMemoryDextoStores().getStore('toolExecutions')
            );
            await manualToolManager.initialize();
            manualToolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            const executeTool = vi.fn().mockResolvedValue('approved result');
            manualToolManager.addTools([
                defineTool({
                    id: 'needs_approval',
                    description: 'Needs approval',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: executeTool,
                }),
            ]);
            const manualExecutor = new TurnExecutor(
                createMockModel(),
                manualToolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10, maxOutputTokens: 4096, temperature: 0.7 },
                llmContext,
                logger,
                steerQueue,
                followUpQueue
            );

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-approval',
                                    toolName: 'needs_approval',
                                    args: { value: 'one' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'done',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            await contextManager.addUserMessage([{ type: 'text', text: 'Use the manual tool' }]);
            const execution = manualExecutor.execute({ mcpManager }, true);
            await approvalStarted.promise;
            expect(executeTool).not.toHaveBeenCalled();
            approvalDecision.resolve({
                approvalId: 'filled-by-handler',
                status: ApprovalStatus.APPROVED,
            });
            await execution;

            expect(approvalHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'tool_approval',
                    metadata: expect.objectContaining({
                        toolName: 'needs_approval',
                    }),
                })
            );
            expect(executeTool).toHaveBeenCalledWith(
                { value: 'one' },
                expect.objectContaining({
                    sessionId,
                })
            );
            const approvalId = approvalHandler.mock.calls[0]?.[0].approvalId;
            expect(approvalId).toEqual(expect.any(String));
            await expect(manualApprovalStore.getResponse({ approvalId })).resolves.toEqual(
                expect.objectContaining({
                    status: ApprovalStatus.APPROVED,
                })
            );
            const history = await contextManager.getHistory();
            expect(history).toContainEqual(
                expect.objectContaining({
                    role: 'tool',
                    toolCallId: 'call-approval',
                    name: 'needs_approval',
                    success: true,
                })
            );
        });

        it('appends an error tool result when approval handling throws', async () => {
            const manualApprovalManager = new ApprovalManager(
                {
                    permissions: { mode: 'manual', timeout: 120000 },
                    elicitation: { enabled: false, timeout: 120000 },
                },
                logger,
                createInMemorySessionApprovalStore(logger)
            );
            const executeTool = vi.fn().mockResolvedValue('should not run');
            const manualToolManager = new ToolManager(
                mcpManager,
                manualApprovalManager,
                {
                    isToolAllowed: vi.fn().mockResolvedValue(false),
                    allowTool: vi.fn(),
                    disallowTool: vi.fn(),
                },
                'manual',
                agentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'approval_error',
                        description: 'Approval error',
                        inputSchema: z.object({ value: z.string() }).strict(),
                        execute: executeTool,
                    }),
                ],
                logger,
                createInMemorySessionToolPreferencesStore(logger),
                new InMemoryDextoStores().getStore('toolExecutions')
            );
            await manualToolManager.initialize();
            manualToolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            const manualExecutor = new TurnExecutor(
                createMockModel(),
                manualToolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10, maxOutputTokens: 4096, temperature: 0.7 },
                llmContext,
                logger,
                steerQueue,
                followUpQueue
            );

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-approval-error',
                                    toolName: 'approval_error',
                                    args: { value: 'one' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'handled error',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            await contextManager.addUserMessage([{ type: 'text', text: 'Use the manual tool' }]);
            await manualExecutor.execute({ mcpManager }, true);

            expect(executeTool).not.toHaveBeenCalled();
            expect(streamText).toHaveBeenCalledTimes(2);
            const history = await contextManager.getHistory();
            expect(history).toContainEqual(
                expect.objectContaining({
                    role: 'tool',
                    toolCallId: 'call-approval-error',
                    name: 'approval_error',
                    success: false,
                })
            );
        });

        it('executes ready siblings while an earlier sibling waits for approval and persists model order', async () => {
            const approvalDecision = createDeferred<{
                approvalId: string;
                status: typeof ApprovalStatus.APPROVED;
            }>();
            const approvalStarted = createDeferred<void>();
            const readyExecuted = createDeferred<void>();
            const order: string[] = [];
            sessionEventBus.on('llm:tool-call', (event) => {
                order.push(`tool-call:${event.callId}`);
            });
            const manualApprovalManager = new ApprovalManager(
                {
                    permissions: { mode: 'manual', timeout: 120000 },
                    elicitation: { enabled: false, timeout: 120000 },
                },
                logger,
                createInMemorySessionApprovalStore(logger)
            );
            const approvalHandler = vi.fn(async (request) => {
                approvalStarted.resolve();
                const decision = await approvalDecision.promise;
                return {
                    ...decision,
                    approvalId: request.approvalId,
                };
            });
            manualApprovalManager.setHandler(approvalHandler);

            const allowedToolsProvider = {
                isToolAllowed: vi.fn(async (toolName) => toolName === 'ready_sibling'),
                allowTool: vi.fn(),
                disallowTool: vi.fn(),
            };
            const siblingToolManager = new ToolManager(
                mcpManager,
                manualApprovalManager,
                allowedToolsProvider,
                'manual',
                agentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'approval_sibling',
                        description: 'Approval sibling',
                        inputSchema: z.object({ value: z.string() }).strict(),
                        execute: vi.fn(async () => {
                            order.push('execute:call-approval-first');
                            return 'approved sibling result';
                        }),
                    }),
                    defineTool({
                        id: 'ready_sibling',
                        description: 'Ready sibling',
                        inputSchema: z.object({ value: z.string() }).strict(),
                        execute: vi.fn(async () => {
                            order.push('execute:call-ready-second');
                            readyExecuted.resolve();
                            return 'ready sibling result';
                        }),
                    }),
                ],
                logger,
                createInMemorySessionToolPreferencesStore(logger),
                new InMemoryDextoStores().getStore('toolExecutions')
            );
            await siblingToolManager.initialize();
            siblingToolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            const siblingExecutor = new TurnExecutor(
                createMockModel(),
                siblingToolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10, maxOutputTokens: 4096, temperature: 0.7 },
                llmContext,
                logger,
                steerQueue,
                followUpQueue
            );

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-approval-first',
                                    toolName: 'approval_sibling',
                                    args: { value: 'wait' },
                                },
                                {
                                    toolCallId: 'call-ready-second',
                                    toolName: 'ready_sibling',
                                    args: { value: 'run' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'done',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            await contextManager.addUserMessage([{ type: 'text', text: 'Use sibling tools' }]);
            const execution = siblingExecutor.execute({ mcpManager }, true);

            await approvalStarted.promise;
            await readyExecuted.promise;
            expect(order).toEqual([
                'tool-call:call-approval-first',
                'tool-call:call-ready-second',
                'execute:call-ready-second',
            ]);
            expect(streamText).toHaveBeenCalledTimes(1);

            approvalDecision.resolve({
                approvalId: 'filled-by-handler',
                status: ApprovalStatus.APPROVED,
            });
            await execution;

            expect(streamText).toHaveBeenCalledTimes(2);
            const history = await contextManager.getHistory();
            const toolMessages = history.filter((message) => message.role === 'tool');
            expect(toolMessages.map((message) => message.toolCallId)).toEqual([
                'call-approval-first',
                'call-ready-second',
            ]);
            expect(toolMessages.map((message) => message.content)).toEqual([
                [{ type: 'text', text: 'approved sibling result' }],
                [{ type: 'text', text: 'ready sibling result' }],
            ]);
        });

        it('auto-approves pending same-tool siblings when the first approval remembers the tool', async () => {
            const approvalHandler = createPendingApprovalHandler();
            const manualApprovalManager = new ApprovalManager(
                {
                    permissions: { mode: 'manual', timeout: 120000 },
                    elicitation: { enabled: false, timeout: 120000 },
                },
                logger,
                createInMemorySessionApprovalStore(logger)
            );
            manualApprovalManager.setHandler(approvalHandler);

            const allowedTools = new Set<string>();
            const allowedToolsProvider = {
                isToolAllowed: vi.fn(async (toolName) => allowedTools.has(toolName)),
                allowTool: vi.fn(async (toolName) => {
                    allowedTools.add(toolName);
                }),
                disallowTool: vi.fn(),
            };
            const executeTool = vi
                .fn()
                .mockResolvedValueOnce('first approved result')
                .mockResolvedValueOnce('second auto-approved result');
            const siblingToolManager = new ToolManager(
                mcpManager,
                manualApprovalManager,
                allowedToolsProvider,
                'manual',
                agentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute: executeTool,
                    }),
                ],
                logger,
                createInMemorySessionToolPreferencesStore(logger),
                new InMemoryDextoStores().getStore('toolExecutions')
            );
            await siblingToolManager.initialize();
            siblingToolManager.setToolExecutionContextFactory((baseContext) => baseContext);
            const siblingExecutor = new TurnExecutor(
                createMockModel(),
                siblingToolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10, maxOutputTokens: 4096, temperature: 0.7 },
                llmContext,
                logger,
                steerQueue,
                followUpQueue
            );

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-write-first',
                                    toolName: 'write_file',
                                    args: { path: 'src/one.ts' },
                                },
                                {
                                    toolCallId: 'call-write-second',
                                    toolName: 'write_file',
                                    args: { path: 'src/two.ts' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'done',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            await contextManager.addUserMessage([{ type: 'text', text: 'Write two files' }]);
            const execution = siblingExecutor.execute({ mcpManager }, true);

            await vi.waitFor(() => expect(approvalHandler.pending.size).toBe(2));
            const firstApprovalId = Array.from(approvalHandler.pending.keys())[0]!;
            approvalHandler.resolveApproval(firstApprovalId, {
                status: ApprovalStatus.APPROVED,
                sessionId,
                data: { rememberChoice: true },
            });
            await execution;

            expect(allowedToolsProvider.allowTool).toHaveBeenCalledWith('write_file', sessionId);
            expect(executeTool).toHaveBeenCalledTimes(2);
            expect(approvalHandler.pending.size).toBe(0);
            const history = await contextManager.getHistory();
            const toolMessages = history.filter((message) => message.role === 'tool');
            expect(toolMessages.map((message) => message.toolCallId)).toEqual([
                'call-write-first',
                'call-write-second',
            ]);
        });

        it('uses a remembered tool approval on a later model step without prompting again', async () => {
            const approvalHandler = createPendingApprovalHandler();
            const manualApprovalManager = new ApprovalManager(
                {
                    permissions: { mode: 'manual', timeout: 120000 },
                    elicitation: { enabled: false, timeout: 120000 },
                },
                logger,
                createInMemorySessionApprovalStore(logger)
            );
            manualApprovalManager.setHandler(approvalHandler);

            const allowedTools = new Set<string>();
            const allowedToolsProvider = {
                isToolAllowed: vi.fn(async (toolName) => allowedTools.has(toolName)),
                allowTool: vi.fn(async (toolName) => {
                    allowedTools.add(toolName);
                }),
                disallowTool: vi.fn(),
            };
            const executeTool = vi
                .fn()
                .mockResolvedValueOnce('first result')
                .mockResolvedValueOnce('later result');
            const rememberingToolManager = new ToolManager(
                mcpManager,
                manualApprovalManager,
                allowedToolsProvider,
                'manual',
                agentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'write_file',
                        description: 'Write file',
                        inputSchema: z.object({ path: z.string() }).strict(),
                        execute: executeTool,
                    }),
                ],
                logger,
                createInMemorySessionToolPreferencesStore(logger),
                new InMemoryDextoStores().getStore('toolExecutions')
            );
            await rememberingToolManager.initialize();
            rememberingToolManager.setToolExecutionContextFactory((baseContext) => baseContext);
            const rememberingExecutor = new TurnExecutor(
                createMockModel(),
                rememberingToolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10, maxOutputTokens: 4096, temperature: 0.7 },
                llmContext,
                logger,
                steerQueue,
                followUpQueue
            );

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-write-first',
                                    toolName: 'write_file',
                                    args: { path: 'src/one.ts' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-write-later',
                                    toolName: 'write_file',
                                    args: { path: 'src/two.ts' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'done',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            await contextManager.addUserMessage([{ type: 'text', text: 'Write files' }]);
            const execution = rememberingExecutor.execute({ mcpManager }, true);

            await vi.waitFor(() => expect(approvalHandler.pending.size).toBe(1));
            const firstApprovalId = Array.from(approvalHandler.pending.keys())[0]!;
            approvalHandler.resolveApproval(firstApprovalId, {
                status: ApprovalStatus.APPROVED,
                sessionId,
                data: { rememberChoice: true },
            });
            await execution;

            expect(allowedToolsProvider.allowTool).toHaveBeenCalledWith('write_file', sessionId);
            expect(approvalHandler.pending.size).toBe(0);
            expect(executeTool).toHaveBeenCalledTimes(2);
            expect(streamText).toHaveBeenCalledTimes(3);
        });

        it('uses remembered bash-style approval patterns on later model steps', async () => {
            const approvalHandler = createPendingApprovalHandler();
            const manualApprovalManager = new ApprovalManager(
                {
                    permissions: { mode: 'manual', timeout: 120000 },
                    elicitation: { enabled: false, timeout: 120000 },
                },
                logger,
                createInMemorySessionApprovalStore(logger)
            );
            manualApprovalManager.setHandler(approvalHandler);
            const executeTool = vi
                .fn()
                .mockResolvedValueOnce('git status result')
                .mockResolvedValueOnce('git diff result');
            const bashToolManager = new ToolManager(
                mcpManager,
                manualApprovalManager,
                {
                    isToolAllowed: vi.fn().mockResolvedValue(false),
                    allowTool: vi.fn(),
                    disallowTool: vi.fn(),
                },
                'manual',
                agentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'bash_exec',
                        description: 'Bash',
                        inputSchema: z.object({ command: z.string() }).strict(),
                        approval: {
                            patternKey: (input) => `${input.command} *`,
                            suggestPatterns: () => ['git *'],
                        },
                        execute: executeTool,
                    }),
                ],
                logger,
                createInMemorySessionToolPreferencesStore(logger),
                new InMemoryDextoStores().getStore('toolExecutions')
            );
            await bashToolManager.initialize();
            bashToolManager.setToolExecutionContextFactory((baseContext) => baseContext);
            const bashExecutor = new TurnExecutor(
                createMockModel(),
                bashToolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10, maxOutputTokens: 4096, temperature: 0.7 },
                llmContext,
                logger,
                steerQueue,
                followUpQueue
            );

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-git-status',
                                    toolName: 'bash_exec',
                                    args: { command: 'git status' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-git-diff',
                                    toolName: 'bash_exec',
                                    args: { command: 'git diff' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'done',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            await contextManager.addUserMessage([{ type: 'text', text: 'Run git commands' }]);
            const execution = bashExecutor.execute({ mcpManager }, true);

            await vi.waitFor(() => expect(approvalHandler.pending.size).toBe(1));
            const firstApprovalId = Array.from(approvalHandler.pending.keys())[0]!;
            approvalHandler.resolveApproval(firstApprovalId, {
                status: ApprovalStatus.APPROVED,
                sessionId,
                data: { rememberPattern: 'git *' },
            });
            await execution;

            expect(approvalHandler.pending.size).toBe(0);
            expect(executeTool).toHaveBeenCalledTimes(2);
            expect(streamText).toHaveBeenCalledTimes(3);
        });

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
                steerQueue,
                followUpQueue
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Keep going' }]);
            const result = await limitedExecutor.execute({ mcpManager }, true);

            expect(result.finishReason).toBe('max-steps');
            expect(result.stepCount).toBe(3);
        });
    });

    describe('Message Queue Injection', () => {
        it('holds steer queued before the first model request until after the initial model step', async () => {
            const queued = await steerQueue.enqueue({
                content: [{ type: 'text', text: 'Then tell me about Messi' }],
            });
            await contextManager.addUserMessage([
                { type: 'text', text: 'Tell me a story about Neymar' },
            ]);
            vi.mocked(streamText)
                .mockImplementationOnce((options) => {
                    const requestJson = JSON.stringify(options.messages);
                    expect(requestJson).toContain('Tell me a story about Neymar');
                    expect(requestJson).not.toContain('Then tell me about Messi');
                    return createMockStream({
                        text: 'Neymar response',
                        finishReason: 'stop',
                    }) as unknown as ReturnType<typeof streamText>;
                })
                .mockImplementationOnce((options) => {
                    const requestJson = JSON.stringify(options.messages);
                    expect(requestJson).toContain('Tell me a story about Neymar');
                    expect(requestJson).toContain('Neymar response');
                    expect(requestJson).toContain('Then tell me about Messi');
                    return createMockStream({
                        text: 'Messi response',
                        finishReason: 'stop',
                    }) as unknown as ReturnType<typeof streamText>;
                });

            const driver = await executor.createDriver({ mcpManager }, { streaming: true });

            try {
                const firstStep = await driver.runNextModelStep();
                expect(firstStep.result.text).toBe('Neymar response');

                await expect(driver.decideNextStep()).resolves.toEqual({
                    kind: 'continue',
                    stepCount: 1,
                });

                const secondStep = await driver.runNextModelStep();
                expect(secondStep.result.text).toBe('Messi response');

                await expect(driver.decideNextStep()).resolves.toEqual({
                    finishReason: 'stop',
                    kind: 'stop',
                    stepCount: 1,
                });
                expect(streamText).toHaveBeenCalledTimes(2);

                const history = await contextManager.getHistory();
                const userMessages = history.filter((message) => message.role === 'user');
                expect(userMessages).toHaveLength(2);
                expect(userMessages[1]).toEqual(
                    expect.objectContaining({
                        metadata: expect.objectContaining({
                            coalesced: false,
                            messageCount: 1,
                            originalMessageIds: [queued.id],
                        }),
                    })
                );
            } finally {
                driver.dispose();
            }
        });

        it('should inject queued messages into context', async () => {
            await steerQueue.enqueue({
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
                    const queuedFollowUp = followUpQueue.enqueue({
                        content: [{ type: 'text', text: 'Follow-up question' }],
                    });
                    const firstStream = createMockStream({
                        text: 'First response',
                        finishReason: 'stop',
                    });
                    return {
                        fullStream: (async function* () {
                            await queuedFollowUp;
                            for await (const event of firstStream.fullStream) {
                                yield event;
                            }
                        })(),
                    } as unknown as ReturnType<typeof streamText>;
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

        it('should process steer messages submitted before a stop finish as end-of-turn input', async () => {
            let callCount = 0;
            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    const queuedSteer = steerQueue.enqueue({
                        content: [{ type: 'text', text: 'Actually, summarize it instead' }],
                    });
                    const firstStream = createMockStream({
                        text: 'Initial response',
                        finishReason: 'stop',
                    });
                    return {
                        fullStream: (async function* () {
                            await queuedSteer;
                            for await (const event of firstStream.fullStream) {
                                yield event;
                            }
                        })(),
                    } as unknown as ReturnType<typeof streamText>;
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
            await expect(steerQueue.dequeueAll()).resolves.toBeNull();
        });

        it('should process steer messages appended to the backing store while the model is in flight', async () => {
            const steerQueueStore = createInMemoryMessageQueueStore();
            steerQueue = new MessageQueueService(
                sessionEventBus,
                logger,
                sessionId,
                steerQueueStore
            );
            executor = createExecutorWithContext(contextManager);
            let callCount = 0;

            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    const firstStream = createMockStream({
                        text: 'Initial response',
                        finishReason: 'stop',
                    });
                    return {
                        fullStream: (async function* () {
                            await steerQueueStore.save({
                                sessionId,
                                queue: [
                                    {
                                        content: [
                                            {
                                                type: 'text',
                                                text: 'Persisted route steer',
                                            },
                                        ],
                                        id: 'route-steer-1',
                                        queuedAt: Date.now(),
                                    },
                                ],
                            });
                            for await (const event of firstStream.fullStream) {
                                yield event;
                            }
                        })(),
                    } as unknown as ReturnType<typeof streamText>;
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
            const history = await contextManager.getHistory();
            expect(history).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        content: expect.arrayContaining([
                            expect.objectContaining({ text: 'Persisted route steer' }),
                        ]),
                        role: 'user',
                    }),
                ])
            );
            await expect(steerQueueStore.load({ sessionId })).resolves.toEqual([]);
        });

        it('should process structured steer content before structured follow-up content', async () => {
            let callCount = 0;
            const steerImageBytes = new Uint8Array([1, 2, 3]);
            const steerImageUrl = new URL('https://example.com/screenshot.png');
            const followUpFileBytes = Buffer.from([4, 5, 6]);
            const followUpFileUrl = new URL('https://example.com/result.log');
            const steerContent = [
                { type: 'text' as const, text: 'Use the attached screenshot' },
                { type: 'image' as const, image: steerImageBytes, mimeType: 'image/png' },
                { type: 'image' as const, image: steerImageUrl, mimeType: 'image/png' },
            ];
            const followUpContent = [
                { type: 'text' as const, text: 'Then inspect this result panel' },
                {
                    type: 'file' as const,
                    data: followUpFileBytes,
                    mimeType: 'text/plain',
                    filename: 'result.log',
                },
                {
                    type: 'file' as const,
                    data: followUpFileUrl,
                    mimeType: 'text/plain',
                    filename: 'remote-result.log',
                },
                {
                    type: 'ui-resource' as const,
                    uri: 'ui://result-panel',
                    mimeType: 'text/html',
                    content: '<section>Result</section>',
                    metadata: { title: 'Result panel' },
                },
            ];

            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    const queuedSteer = steerQueue.enqueue({ content: steerContent });
                    const queuedFollowUp = followUpQueue.enqueue({ content: followUpContent });
                    const firstStream = createMockStream({
                        text: 'Initial response',
                        finishReason: 'stop',
                    });
                    return {
                        fullStream: (async function* () {
                            await queuedSteer;
                            await queuedFollowUp;
                            steerImageBytes[0] = 9;
                            steerImageUrl.pathname = '/mutated.png';
                            followUpFileBytes[0] = 9;
                            followUpFileUrl.pathname = '/mutated.log';
                            const uiResourcePart = followUpContent[3];
                            if (uiResourcePart?.type !== 'ui-resource' || !uiResourcePart.metadata)
                                throw new Error('Expected UI resource metadata');
                            uiResourcePart.metadata.title = 'Mutated panel';
                            for await (const event of firstStream.fullStream) {
                                yield event;
                            }
                        })(),
                    } as unknown as ReturnType<typeof streamText>;
                }
                return createMockStream({
                    text: `Response ${callCount}`,
                    finishReason: 'stop',
                }) as unknown as ReturnType<typeof streamText>;
            });

            await contextManager.addUserMessage([{ type: 'text', text: 'Initial' }]);
            const result = await executor.execute({ mcpManager }, true);

            expect(callCount).toBe(3);
            expect(result.text).toBe('Response 3');
            const secondCall = vi.mocked(streamText).mock.calls[1]?.[0];
            const thirdCall = vi.mocked(streamText).mock.calls[2]?.[0];
            expect(secondCall?.messages).toBeDefined();
            expect(thirdCall?.messages).toBeDefined();
            const secondCallUserMessages = (secondCall?.messages as ModelMessage[]).filter(
                (message) => message.role === 'user'
            );
            const thirdCallUserMessages = (thirdCall?.messages as ModelMessage[]).filter(
                (message) => message.role === 'user'
            );
            const secondCallLatestUserContent = secondCallUserMessages.at(-1)?.content;
            const thirdCallLatestUserContent = thirdCallUserMessages.at(-1)?.content;
            if (!Array.isArray(secondCallLatestUserContent))
                throw new Error('Expected second call user content parts');
            if (!Array.isArray(thirdCallLatestUserContent))
                throw new Error('Expected third call user content parts');
            expect(secondCallLatestUserContent).toEqual([
                { type: 'text', text: 'Use the attached screenshot' },
                {
                    type: 'text',
                    text: 'ERROR: Cannot read image (this model does not support image input). Inform the user.',
                },
                {
                    type: 'text',
                    text: 'ERROR: Cannot read image (this model does not support image input). Inform the user.',
                },
            ]);
            expect(thirdCallLatestUserContent).toEqual([
                { type: 'text', text: 'Then inspect this result panel' },
                {
                    type: 'text',
                    text: expect.stringContaining('result.log'),
                },
                {
                    type: 'text',
                    text: expect.stringContaining('remote-result.log'),
                },
            ]);

            const history = await contextManager.getHistory();
            const userMessages = history.filter((message) => message.role === 'user');
            expect(userMessages.map((message) => message.content)).toEqual([
                [{ type: 'text', text: 'Initial' }],
                [
                    { type: 'text', text: 'Use the attached screenshot' },
                    { type: 'image', image: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
                    {
                        type: 'image',
                        image: new URL('https://example.com/screenshot.png'),
                        mimeType: 'image/png',
                    },
                ],
                [
                    { type: 'text', text: 'Then inspect this result panel' },
                    {
                        type: 'file',
                        data: Buffer.from([4, 5, 6]),
                        mimeType: 'text/plain',
                        filename: 'result.log',
                    },
                    {
                        type: 'file',
                        data: new URL('https://example.com/result.log'),
                        mimeType: 'text/plain',
                        filename: 'remote-result.log',
                    },
                    {
                        type: 'ui-resource',
                        uri: 'ui://result-panel',
                        mimeType: 'text/html',
                        content: '<section>Result</section>',
                        metadata: { title: 'Result panel' },
                    },
                ],
            ]);
            const queuedSteerUrlPart = userMessages[1]?.content[2];
            if (queuedSteerUrlPart?.type !== 'image')
                throw new Error('Expected queued steer URL image');
            expect(queuedSteerUrlPart.image).toBeInstanceOf(URL);
            const queuedFollowUpUrlPart = userMessages[2]?.content[2];
            if (queuedFollowUpUrlPart?.type !== 'file')
                throw new Error('Expected queued follow-up URL file');
            expect(queuedFollowUpUrlPart.data).toBeInstanceOf(URL);
            await expect(steerQueue.dequeueAll()).resolves.toBeNull();
            await expect(followUpQueue.dequeueAll()).resolves.toBeNull();
        });

        it('applies steer queued during sibling tools only after all sibling tool results', async () => {
            toolManager.addTools([
                defineTool({
                    id: 'first_tool',
                    description: 'First tool',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: vi.fn().mockImplementation(async () => {
                        await steerQueue.enqueue({
                            content: [{ type: 'text', text: 'Steer after tools finish' }],
                        });
                        return 'first result';
                    }),
                }),
                defineTool({
                    id: 'second_tool',
                    description: 'Second tool',
                    inputSchema: z.object({ value: z.string() }).strict(),
                    execute: vi.fn().mockResolvedValue('second result'),
                }),
            ]);

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-first',
                                    toolName: 'first_tool',
                                    args: { value: 'one' },
                                },
                                {
                                    toolCallId: 'call-second',
                                    toolName: 'second_tool',
                                    args: { value: 'two' },
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'done',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            await contextManager.addUserMessage([{ type: 'text', text: 'Use both tools' }]);
            await executor.execute({ mcpManager }, true);

            expect(streamText).toHaveBeenCalledTimes(2);
            const history = await contextManager.getHistory();
            const ordered = history.map((message) => {
                if (message.role === 'user') {
                    const text = Array.isArray(message.content)
                        ? message.content
                              .filter((part) => part.type === 'text')
                              .map((part) => part.text)
                              .join(' ')
                        : '';
                    return `user:${text}`;
                }
                if (message.role === 'tool') return `tool:${message.toolCallId}`;
                return message.role;
            });

            expect(ordered).toEqual(
                expect.arrayContaining([
                    'user:Use both tools',
                    'tool:call-first',
                    'tool:call-second',
                    'user:Steer after tools finish',
                ])
            );
            expect(ordered.indexOf('tool:call-first')).toBeLessThan(
                ordered.indexOf('user:Steer after tools finish')
            );
            expect(ordered.indexOf('tool:call-second')).toBeLessThan(
                ordered.indexOf('user:Steer after tools finish')
            );
            const secondCall = vi.mocked(streamText).mock.calls[1]?.[0];
            const secondCallText = JSON.stringify(secondCall?.messages);
            expect(secondCallText).toContain('first result');
            expect(secondCallText).toContain('second result');
            expect(secondCallText).toContain('Steer after tools finish');
        });

        it('keeps follow-up queued during sibling tools out of the immediate tool-result continuation', async () => {
            toolManager.addTools([
                defineTool({
                    id: 'queue_follow_up',
                    description: 'Queue follow-up',
                    inputSchema: z.object({}).strict(),
                    execute: vi.fn().mockImplementation(async () => {
                        await followUpQueue.enqueue({
                            content: [
                                { type: 'text', text: 'Run as follow-up after tool response' },
                            ],
                        });
                        return 'tool result';
                    }),
                }),
            ]);

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            finishReason: 'tool-calls',
                            toolCalls: [
                                {
                                    toolCallId: 'call-follow-up',
                                    toolName: 'queue_follow_up',
                                    args: {},
                                },
                            ],
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'Tool response complete',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'Follow-up complete',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            await contextManager.addUserMessage([
                { type: 'text', text: 'Use tool then follow up' },
            ]);
            const result = await executor.execute({ mcpManager }, true);

            expect(result.text).toBe('Follow-up complete');
            expect(streamText).toHaveBeenCalledTimes(3);
            const secondCallText = JSON.stringify(
                vi.mocked(streamText).mock.calls[1]?.[0].messages
            );
            const thirdCallText = JSON.stringify(vi.mocked(streamText).mock.calls[2]?.[0].messages);
            expect(secondCallText).toContain('tool result');
            expect(secondCallText).not.toContain('Run as follow-up after tool response');
            expect(thirdCallText).toContain('Run as follow-up after tool response');
            await expect(followUpQueue.dequeueAll()).resolves.toBeNull();
        });

        it('should not process late steer messages after cancellation', async () => {
            const abortController = new AbortController();
            let callCount = 0;
            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    const queuedSteer = steerQueue.enqueue({
                        content: [{ type: 'text', text: 'Do this next' }],
                    });
                    const firstStream = createMockStream({
                        text: 'Partial response',
                        finishReason: 'cancelled',
                    });
                    return {
                        fullStream: (async function* () {
                            abortController.abort();
                            await queuedSteer;
                            for await (const event of firstStream.fullStream) {
                                yield event;
                            }
                        })(),
                    } as unknown as ReturnType<typeof streamText>;
                }
                return createMockStream({
                    text: 'Should not run',
                    finishReason: 'stop',
                }) as unknown as ReturnType<typeof streamText>;
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
                steerQueue,
                followUpQueue,
                undefined,
                abortController.signal
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Initial' }]);
            const result = await executorWithSignal.execute({ mcpManager }, true);

            expect(callCount).toBe(1);
            expect(result.finishReason).toBe('cancelled');
        });

        it('should not process follow-up messages after cancellation', async () => {
            const abortController = new AbortController();
            let callCount = 0;
            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    const queuedFollowUp = followUpQueue.enqueue({
                        content: [{ type: 'text', text: 'Run after cancel' }],
                    });
                    const firstStream = createMockStream({
                        text: 'Partial response',
                        finishReason: 'cancelled',
                    });
                    return {
                        fullStream: (async function* () {
                            abortController.abort();
                            await queuedFollowUp;
                            for await (const event of firstStream.fullStream) {
                                yield event;
                            }
                        })(),
                    } as unknown as ReturnType<typeof streamText>;
                }
                return createMockStream({
                    text: 'Should not run',
                    finishReason: 'stop',
                }) as unknown as ReturnType<typeof streamText>;
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
                steerQueue,
                followUpQueue,
                undefined,
                abortController.signal
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Initial' }]);
            const result = await executorWithSignal.execute({ mcpManager }, true);

            expect(callCount).toBe(1);
            expect(result.finishReason).toBe('cancelled');
        });

        it('should apply maxSteps to end-of-turn steer messages', async () => {
            let callCount = 0;
            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                const queuedSteer = steerQueue.enqueue({
                    content: [{ type: 'text', text: `Steer ${callCount}` }],
                });
                const stream = createMockStream({
                    text: `Response ${callCount}`,
                    finishReason: 'stop',
                });
                return {
                    fullStream: (async function* () {
                        await queuedSteer;
                        for await (const event of stream.fullStream) {
                            yield event;
                        }
                    })(),
                } as unknown as ReturnType<typeof streamText>;
            });

            const limitedExecutor = new TurnExecutor(
                createMockModel(),
                toolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 1 },
                llmContext,
                logger,
                steerQueue,
                followUpQueue
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Initial' }]);
            const result = await limitedExecutor.execute({ mcpManager }, true);

            expect(callCount).toBe(1);
            expect(result.finishReason).toBe('max-steps');
        });

        it('should apply maxSteps to follow-up messages', async () => {
            let callCount = 0;
            vi.mocked(streamText).mockImplementation(() => {
                callCount++;
                const queuedFollowUp = followUpQueue.enqueue({
                    content: [{ type: 'text', text: `Follow-up ${callCount}` }],
                });
                const stream = createMockStream({
                    text: `Response ${callCount}`,
                    finishReason: 'stop',
                });
                return {
                    fullStream: (async function* () {
                        await queuedFollowUp;
                        for await (const event of stream.fullStream) {
                            yield event;
                        }
                    })(),
                } as unknown as ReturnType<typeof streamText>;
            });

            const limitedExecutor = new TurnExecutor(
                createMockModel(),
                toolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 1 },
                llmContext,
                logger,
                steerQueue,
                followUpQueue
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Initial' }]);
            const result = await limitedExecutor.execute({ mcpManager }, true);

            expect(callCount).toBe(1);
            expect(result.finishReason).toBe('max-steps');
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
                steerQueue,
                followUpQueue
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor1.execute({ mcpManager }, true);

            expect(generateText).toHaveBeenCalledTimes(1);

            // Second executor with same baseURL should use cache
            const newMessageQueue = new MessageQueueService(
                sessionEventBus,
                logger,
                'session-2',
                createInMemoryMessageQueueStore()
            );
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
                newMessageQueue,
                followUpQueue
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
                steerQueue,
                followUpQueue
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
                steerQueue,
                followUpQueue
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
                steerQueue,
                followUpQueue
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

        it('should treat Codex app-server as tool-capable without probing', async () => {
            const warningHandler = vi.fn();
            sessionEventBus.on('llm:unsupported-input', warningHandler);

            const codexExecutor = new TurnExecutor(
                createMockModel(),
                toolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10, baseURL: 'codex://chatgpt' },
                { provider: 'openai-compatible', model: 'gpt-5.4' },
                logger,
                steerQueue,
                followUpQueue
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await codexExecutor.execute({ mcpManager }, true);

            expect(generateText).not.toHaveBeenCalled();
            expect(streamText).toHaveBeenCalled();
            expect(warningHandler).not.toHaveBeenCalled();
        });
    });

    describe('Error Handling', () => {
        const apiCallError = (input: {
            message: string;
            statusCode: number;
            isRetryable: boolean;
        }) =>
            new APICallError({
                message: input.message,
                statusCode: input.statusCode,
                responseHeaders: {},
                responseBody: input.message,
                url: 'https://api.openai.com/v1/responses',
                requestBodyValues: {},
                isRetryable: input.isRetryable,
            });

        it('retries a retryable model request failure before terminal run failure', async () => {
            const retryableError = apiCallError({
                message: 'Provider unavailable',
                statusCode: 503,
                isRetryable: true,
            });

            vi.mocked(streamText)
                .mockImplementationOnce(() => {
                    throw retryableError;
                })
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'Recovered',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            const retryingHandler = vi.fn();
            const errorHandler = vi.fn();
            const completeHandler = vi.fn();
            sessionEventBus.on('llm:retrying', retryingHandler);
            sessionEventBus.on('llm:error', errorHandler);
            sessionEventBus.on('run:complete', completeHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            const result = await executor.execute({ mcpManager }, true);

            expect(result.text).toBe('Recovered');
            expect(streamText).toHaveBeenCalledTimes(2);
            expect(retryingHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    attempt: 1,
                    maxRetries: 2,
                    provider: 'openai',
                    model: 'gpt-4',
                })
            );
            expect(errorHandler).not.toHaveBeenCalled();
            expect(completeHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    finishReason: 'stop',
                })
            );
            await expect(contextManager.getHistory()).resolves.toEqual([
                expect.objectContaining({
                    role: 'user',
                    content: [{ type: 'text', text: 'Hello' }],
                }),
                expect.objectContaining({
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Recovered' }],
                }),
            ]);
        });

        it('fails after retryable model request failures exhaust retry budget', async () => {
            const retryableError = apiCallError({
                message: 'Provider unavailable',
                statusCode: 503,
                isRetryable: true,
            });

            vi.mocked(streamText).mockImplementation(() => {
                throw retryableError;
            });

            const retryingHandler = vi.fn();
            const errorHandler = vi.fn();
            const completeHandler = vi.fn();
            sessionEventBus.on('llm:retrying', retryingHandler);
            sessionEventBus.on('llm:error', errorHandler);
            sessionEventBus.on('run:complete', completeHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            await expect(executor.execute({ mcpManager }, true)).rejects.toMatchObject({
                code: 'llm_generation_failed',
            });

            expect(streamText).toHaveBeenCalledTimes(3);
            expect(retryingHandler).toHaveBeenCalledTimes(2);
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

        it('does not retry non-retryable model request failures', async () => {
            const nonRetryableError = apiCallError({
                message: 'Bad request',
                statusCode: 400,
                isRetryable: false,
            });

            vi.mocked(streamText).mockImplementation(() => {
                throw nonRetryableError;
            });

            const retryingHandler = vi.fn();
            sessionEventBus.on('llm:retrying', retryingHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            await expect(executor.execute({ mcpManager }, true)).rejects.toThrow();

            expect(streamText).toHaveBeenCalledTimes(1);
            expect(retryingHandler).not.toHaveBeenCalled();
        });

        it('retries an async stream failure before conversation history changes', async () => {
            const retryableError = apiCallError({
                message: 'Provider connection dropped',
                statusCode: 503,
                isRetryable: true,
            });

            vi.mocked(streamText)
                .mockImplementationOnce(
                    () =>
                        ({
                            fullStream: (async function* () {
                                yield { type: 'error', error: retryableError };
                            })(),
                        }) as unknown as ReturnType<typeof streamText>
                )
                .mockImplementationOnce(
                    () =>
                        createMockStream({
                            text: 'Recovered',
                            finishReason: 'stop',
                        }) as unknown as ReturnType<typeof streamText>
                );

            const retryingHandler = vi.fn();
            const errorHandler = vi.fn();
            sessionEventBus.on('llm:retrying', retryingHandler);
            sessionEventBus.on('llm:error', errorHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            const result = await executor.execute({ mcpManager }, true);

            expect(result.text).toBe('Recovered');
            expect(streamText).toHaveBeenCalledTimes(2);
            expect(retryingHandler).toHaveBeenCalledTimes(1);
            expect(errorHandler).not.toHaveBeenCalled();
        });

        it('emits one llm:error for terminal async stream failures', async () => {
            const streamError = apiCallError({
                message: 'Bad request',
                statusCode: 400,
                isRetryable: false,
            });

            vi.mocked(streamText).mockImplementation(
                () =>
                    ({
                        fullStream: (async function* () {
                            yield { type: 'error', error: streamError };
                        })(),
                    }) as unknown as ReturnType<typeof streamText>
            );

            const errorHandler = vi.fn();
            sessionEventBus.on('llm:error', errorHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            await expect(executor.execute({ mcpManager }, true)).rejects.toMatchObject({
                code: 'llm_generation_failed',
            });

            expect(errorHandler).toHaveBeenCalledTimes(1);
            expect(errorHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    context: 'TurnExecutor',
                    recoverable: false,
                })
            );
        });

        it('does not retry once a failed stream has changed conversation history', async () => {
            const retryableError = apiCallError({
                message: 'Provider connection dropped',
                statusCode: 503,
                isRetryable: true,
            });

            vi.mocked(streamText).mockImplementation(
                () =>
                    ({
                        fullStream: (async function* () {
                            yield { type: 'text-delta', text: 'Partial response' };
                            yield { type: 'error', error: retryableError };
                        })(),
                    }) as unknown as ReturnType<typeof streamText>
            );

            const retryingHandler = vi.fn();
            sessionEventBus.on('llm:retrying', retryingHandler);

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            await expect(executor.execute({ mcpManager }, true)).rejects.toThrow();

            expect(streamText).toHaveBeenCalledTimes(1);
            expect(retryingHandler).not.toHaveBeenCalled();
            await expect(contextManager.getHistory()).resolves.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        role: 'assistant',
                        content: [{ type: 'text', text: 'Partial response' }],
                    }),
                ])
            );
        });

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

        it('should preserve Dexto billing recovery guidance for 402 provider errors', async () => {
            const { APICallError } = await import('ai');
            const billingError = new APICallError({
                message: 'Insufficient credits',
                statusCode: 402,
                responseHeaders: {},
                responseBody: JSON.stringify({
                    error: {
                        message: 'Insufficient credits',
                        metadata: {
                            balance: 0.37,
                        },
                    },
                }),
                url: 'https://app.dexto.ai/v1/chat/completions',
                requestBodyValues: {},
                isRetryable: false,
            });

            vi.mocked(streamText).mockImplementation(() => {
                throw billingError;
            });

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            await expect(executor.execute({ mcpManager }, true)).rejects.toMatchObject({
                code: 'llm_insufficient_credits',
                message: 'Insufficient Dexto credits. Balance: $0.37',
                recovery: 'Run `dexto billing` to check your balance',
                type: 'payment_required',
            });
        });
    });

    describe('Cleanup and Resource Management', () => {
        it('should clear steer queue on normal completion', async () => {
            await steerQueue.enqueue({ content: [{ type: 'text', text: 'Pending' }] });

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await executor.execute({ mcpManager }, true);

            await expect(steerQueue.dequeueAll()).resolves.toBeNull();
        });

        it('should clear steer queue on error', async () => {
            await steerQueue.enqueue({ content: [{ type: 'text', text: 'Pending' }] });

            vi.mocked(streamText).mockImplementation(() => {
                throw new Error('Failed');
            });

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await expect(executor.execute({ mcpManager }, true)).rejects.toThrow();

            await expect(steerQueue.dequeueAll()).resolves.toBeNull();
        });

        it('should preserve follow-up queue on error', async () => {
            await followUpQueue.enqueue({ content: [{ type: 'text', text: 'After error' }] });

            vi.mocked(streamText).mockImplementation(() => {
                throw new Error('Failed');
            });

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await expect(executor.execute({ mcpManager }, true)).rejects.toThrow();

            await expect(followUpQueue.getAll()).toEqual([
                expect.objectContaining({
                    content: [{ type: 'text', text: 'After error' }],
                }),
            ]);
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
                steerQueue,
                followUpQueue,
                undefined,
                abortController.signal
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            const result = await executorWithSignal.execute({ mcpManager }, true);

            expect(result.finishReason).toBe('cancelled');
        });

        it('appends a cancelled tool result when aborted while approval is pending', async () => {
            const abortController = new AbortController();
            const approvalStarted = createDeferred<void>();
            const manualApprovalManager = new ApprovalManager(
                {
                    permissions: { mode: 'manual', timeout: 120000 },
                    elicitation: { enabled: false, timeout: 120000 },
                },
                logger,
                createInMemorySessionApprovalStore(logger)
            );
            manualApprovalManager.setHandler(
                vi.fn(async () => {
                    approvalStarted.resolve();
                    return new Promise<ApprovalResponse>(() => undefined);
                })
            );
            const executeTool = vi.fn().mockResolvedValue('should not run');
            const manualToolManager = new ToolManager(
                mcpManager,
                manualApprovalManager,
                {
                    isToolAllowed: vi.fn().mockResolvedValue(false),
                    allowTool: vi.fn(),
                    disallowTool: vi.fn(),
                },
                'manual',
                agentEventBus,
                { alwaysAllow: [] },
                [
                    defineTool({
                        id: 'pending_approval',
                        description: 'Pending approval',
                        inputSchema: z.object({ value: z.string() }).strict(),
                        execute: executeTool,
                    }),
                ],
                logger,
                createInMemorySessionToolPreferencesStore(logger),
                new InMemoryDextoStores().getStore('toolExecutions')
            );
            await manualToolManager.initialize();
            manualToolManager.setToolExecutionContextFactory((baseContext) => baseContext);

            const executorWithSignal = new TurnExecutor(
                createMockModel(),
                manualToolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10 },
                llmContext,
                logger,
                steerQueue,
                followUpQueue,
                undefined,
                abortController.signal
            );

            vi.mocked(streamText).mockImplementationOnce(
                () =>
                    createMockStream({
                        finishReason: 'tool-calls',
                        toolCalls: [
                            {
                                toolCallId: 'call-pending-approval',
                                toolName: 'pending_approval',
                                args: { value: 'one' },
                            },
                        ],
                    }) as unknown as ReturnType<typeof streamText>
            );

            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            const execution = executorWithSignal.execute({ mcpManager }, true);
            await approvalStarted.promise;
            abortController.abort();
            const result = await execution;

            expect(result.finishReason).toBe('cancelled');
            expect(executeTool).not.toHaveBeenCalled();
            const history = await contextManager.getHistory();
            expect(history).toContainEqual(
                expect.objectContaining({
                    role: 'tool',
                    toolCallId: 'call-pending-approval',
                    name: 'pending_approval',
                    success: false,
                    content: [
                        { type: 'text', text: '{"error":"Cancelled by user","cancelled":true}' },
                    ],
                })
            );
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

    describe('Context Pruning and Compaction Boundaries', () => {
        function createExecutorWithCompaction(compactionStrategy: CompactionStrategy) {
            return new TurnExecutor(
                createMockModel(),
                toolManager,
                contextManager,
                sessionEventBus,
                resourceManager,
                sessionId,
                { maxSteps: 10, maxOutputTokens: 4096, temperature: 0.7 },
                llmContext,
                logger,
                steerQueue,
                followUpQueue,
                { contextWindow: 100_000 },
                undefined,
                compactionStrategy
            );
        }

        it('prunes old tool outputs before formatting the next model request', async () => {
            const events: string[] = [];
            const oldLargeToolOutput = 'old-tool-output'.repeat(20_000);
            const recentToolOutput = 'recent tool output must remain visible';
            sessionEventBus.on('context:pruned', () => events.push('context:pruned'));
            vi.mocked(streamText).mockImplementation((options) => {
                events.push('streamText');
                const requestJson = JSON.stringify(options.messages);
                expect(requestJson).not.toContain(oldLargeToolOutput);
                expect(requestJson).toContain(recentToolOutput);
                return createMockStream({
                    text: 'Response',
                    finishReason: 'stop',
                    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
                }) as unknown as ReturnType<typeof streamText>;
            });

            await contextManager.addUserMessage([
                { type: 'text', text: 'Summarize the tool output' },
            ]);
            await contextManager.addAssistantMessage('', []);
            const oldAssistantMessage = (await contextManager.getHistory()).at(-1);
            if (!oldAssistantMessage?.id) throw new Error('Expected old assistant message id');
            await contextManager.addToolCall(oldAssistantMessage.id, {
                id: 'call-old',
                type: 'function',
                function: {
                    name: 'read_file',
                    arguments: JSON.stringify({ path: 'old-large.txt' }),
                },
            });
            await contextManager.addToolResult('call-old', 'read_file', {
                content: [{ type: 'text', text: oldLargeToolOutput }],
                meta: { toolName: 'read_file', toolCallId: 'call-old', success: true },
            });
            await contextManager.addAssistantMessage('', []);
            const recentAssistantMessage = (await contextManager.getHistory()).at(-1);
            if (!recentAssistantMessage?.id)
                throw new Error('Expected recent assistant message id');
            await contextManager.addToolCall(recentAssistantMessage.id, {
                id: 'call-recent',
                type: 'function',
                function: {
                    name: 'read_file',
                    arguments: JSON.stringify({ path: 'recent.txt' }),
                },
            });
            await contextManager.addToolResult('call-recent', 'read_file', {
                content: [{ type: 'text', text: recentToolOutput }],
                meta: { toolName: 'read_file', toolCallId: 'call-recent', success: true },
            });

            await executor.execute({ mcpManager }, true);

            expect(events).toEqual(['context:pruned', 'streamText']);
        });

        it('compacts estimated overflow before sending the next model request', async () => {
            const events: string[] = [];
            const compactionStrategy = createTestCompactionStrategy((tokens) => tokens > 10);
            sessionEventBus.on('context:compacting', () => events.push('context:compacting'));
            sessionEventBus.on('context:compacted', () => events.push('context:compacted'));
            vi.mocked(streamText).mockImplementation((options) => {
                events.push('streamText');
                const requestJson = JSON.stringify(options.messages);
                expect(requestJson).toContain('Compacted test summary');
                expect(requestJson).not.toContain('Message 1 before summary');
                return createMockStream({
                    text: 'Response',
                    finishReason: 'stop',
                    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                }) as unknown as ReturnType<typeof streamText>;
            });

            const compactingExecutor = createExecutorWithCompaction(compactionStrategy);

            await seedCompactionEligibleHistory();

            await compactingExecutor.execute({ mcpManager }, true);

            expect(events).toEqual(['context:compacting', 'context:compacted', 'streamText']);
            expect(compactionStrategy.compact).toHaveBeenCalledTimes(1);
        });

        it('queues steer submitted during compaction for the next model step', async () => {
            const events: string[] = [];
            const compactionStrategy = createTestCompactionStrategy((tokens) => tokens > 10);
            vi.mocked(compactionStrategy.compact).mockImplementation(async (history) => {
                await steerQueue.enqueue({
                    content: [{ type: 'text', text: 'Steer queued while compacting' }],
                });
                return [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: '<session_compaction>Compacted during steer</session_compaction>',
                            },
                        ],
                        isSummary: true,
                        metadata: {
                            compaction: {
                                algorithm: 'test-compaction',
                                sourceMessageCount: history.length,
                                compactedAt: new Date().toISOString(),
                            },
                        },
                    },
                ];
            });
            sessionEventBus.on('context:compacting', () => events.push('context:compacting'));
            sessionEventBus.on('context:compacted', () => events.push('context:compacted'));
            vi.mocked(streamText)
                .mockImplementationOnce((options) => {
                    events.push('streamText:first');
                    const requestJson = JSON.stringify(options.messages);
                    expect(requestJson).toContain('Compacted during steer');
                    expect(requestJson).not.toContain('Steer queued while compacting');
                    return createMockStream({
                        text: 'Compacted response',
                        finishReason: 'stop',
                        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                    }) as unknown as ReturnType<typeof streamText>;
                })
                .mockImplementationOnce((options) => {
                    events.push('streamText:second');
                    const requestJson = JSON.stringify(options.messages);
                    expect(requestJson).toContain('Steer queued while compacting');
                    return createMockStream({
                        text: 'Steered response',
                        finishReason: 'stop',
                        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                    }) as unknown as ReturnType<typeof streamText>;
                });

            const compactingExecutor = createExecutorWithCompaction(compactionStrategy);

            await seedCompactionEligibleHistory();

            const result = await compactingExecutor.execute({ mcpManager }, true);

            expect(result.text).toBe('Steered response');
            expect(events).toEqual([
                'context:compacting',
                'context:compacted',
                'streamText:first',
                'streamText:second',
            ]);
            expect(compactionStrategy.compact).toHaveBeenCalledTimes(1);
            await expect(steerQueue.dequeueAll()).resolves.toBeNull();
        });

        it('compacts after a response when actual input usage crosses the threshold', async () => {
            const events: string[] = [];
            const compactionStrategy = createTestCompactionStrategy((tokens) => tokens === 10_000);
            sessionEventBus.on('context:compacting', () => events.push('context:compacting'));
            sessionEventBus.on('context:compacted', () => events.push('context:compacted'));
            vi.mocked(streamText).mockImplementation(() => {
                events.push('streamText');
                return createMockStream({
                    text: 'Response',
                    finishReason: 'stop',
                    usage: { inputTokens: 10_000, outputTokens: 20, totalTokens: 10_020 },
                }) as unknown as ReturnType<typeof streamText>;
            });

            const compactingExecutor = createExecutorWithCompaction(compactionStrategy);

            await seedCompactionEligibleHistory();

            await compactingExecutor.execute({ mcpManager }, true);

            expect(events).toEqual(['streamText', 'context:compacting', 'context:compacted']);
            expect(compactionStrategy.compact).toHaveBeenCalledTimes(1);
            expect(compactionStrategy.shouldCompact).toHaveBeenCalledWith(10_000, {
                contextWindow: 100_000,
            });

            const formattedAfterCompaction = await contextManager.getFormattedMessagesForLLM(
                { mcpManager },
                llmContext
            );
            const formattedJson = JSON.stringify(formattedAfterCompaction.formattedMessages);
            expect(formattedJson).toContain('Compacted test summary');
            expect(formattedJson).not.toContain('Message 1 before summary');
        });
    });
});
