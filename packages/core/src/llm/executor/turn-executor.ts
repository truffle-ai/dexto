import {
    LanguageModel,
    streamText,
    generateText,
    stepCountIs,
    ToolSet as VercelToolSet,
    jsonSchema,
    type ModelMessage,
    APICallError,
} from 'ai';
import type { SharedV2ProviderOptions } from '@ai-sdk/provider';
import { trace } from '@opentelemetry/api';
import { ContextManager } from '../../context/manager.js';
import type {
    TextPart,
    ImagePart,
    FilePart,
    ResourcePart,
    UIResourcePart,
} from '../../context/types.js';
import { sanitizeToolResult } from '../../context/utils.js';
import {
    ToolManager,
    type ExecutableToolCall,
    type PreparedToolCall,
    type RecordedToolApproval,
} from '../../tools/tool-manager.js';
import type { ToolSet } from '../../tools/types.js';
import type { ToolExecutionResult, ToolPresentationSnapshotV1 } from '../../tools/types.js';
import type { ToolCallMetadata } from '../../tools/tool-call-metadata.js';
import { StreamProcessor } from './stream-processor.js';
import { truncateToolResult } from './tool-output-truncator.js';
import type { ExecutorResult, ModelToolCall, StreamProcessorResult } from './types.js';
import { buildProviderOptions, getEffectiveReasoningBudgetTokens } from './provider-options.js';
import type {
    TokenUsage,
    LLMReasoningConfig,
    LLMContext,
    LLMProvider,
    ReasoningVariant,
} from '../types.js';
import type { Logger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import type { SessionEventBus, LLMFinishReason } from '../../events/index.js';
import type { ResourceManager } from '../../resources/index.js';
import { DynamicContributorContext } from '../../systemPrompt/types.js';

import type { MessageQueueService } from '../../session/message-queue.js';
import type { StreamProcessorConfig } from './stream-processor.js';
import type { CoalescedMessage } from '../../session/types.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import { LLMErrorCode } from '../error-codes.js';
import { toError } from '../../utils/error-conversion.js';
import type { CompactionStrategy } from '../../context/compaction/types.js';
import type { ModelLimits } from '../../context/compaction/overflow.js';
import { isCodexBaseURL } from '../providers/codex-base-url.js';
import type { AgentRunContext } from '../../runtime/run-context.js';
import { createModelToolDefinitions } from './tool-definitions.js';
import { ApprovalStatus, type ApprovalResponse } from '../../approval/types.js';
import type { ApprovalDecisionInput } from '../../approval/manager.js';

const MCP_TOOL_PREFIX = 'mcp--';
const MODEL_REQUEST_MAX_RETRIES = 2;

type PreparedModelToolCall =
    | {
          kind: 'prepared';
          toolCall: ModelToolCall;
          prepared: PreparedToolCall;
      }
    | {
          kind: 'terminal';
          toolCall: ModelToolCall;
          modelVisibleResult: ToolExecutionResult;
      };

type ApprovalWaitResult =
    | {
          kind: 'response';
          response: ApprovalResponse;
      }
    | {
          kind: 'terminal';
          modelVisibleResult: ToolExecutionResult;
      };

type QueuedInputKind = 'late-steer' | 'follow-up';

type StepAdvance =
    | {
          kind: 'continue';
          stepCount: number;
      }
    | {
          kind: 'stop';
          stepCount: number;
          finishReason: 'max-steps';
      };

type QueuedInputAction =
    | {
          kind: 'continue';
          stepCount: number;
      }
    | {
          kind: 'stop';
          stepCount: number;
          finishReason: LLMFinishReason;
      };

type ModelStepRequest = {
    messages: ModelMessage[];
    tools: VercelToolSet;
    toolDefinitions: ToolSet;
    estimatedInputTokens: number;
    reasoning:
        | {
              reasoningVariant?: ReasoningVariant;
              reasoningBudgetTokens?: number;
          }
        | undefined;
    providerOptions: SharedV2ProviderOptions | undefined;
    streaming: boolean;
};

type ModelStepPreparationInput = {
    contributorContext: DynamicContributorContext;
    supportsTools: boolean;
    streaming: boolean;
};

type ModelStepApplicationInput = {
    result: StreamProcessorResult;
    request: ModelStepRequest;
    contributorContext: DynamicContributorContext;
};

type TurnStart = {
    supportsTools: boolean;
};

type FinishTurnInput = {
    startTime: number;
    stepCount: number;
    text: string;
    usage: TokenUsage | null;
    finishReason: LLMFinishReason;
};

type ModelStepScope = {
    [Symbol.dispose](): void;
};

export type TurnDriverModelStep = {
    result: StreamProcessorResult;
    stepCount: number;
};

export type TurnDriverNextAction =
    | {
          kind: 'continue';
          stepCount: number;
      }
    | {
          kind: 'stop';
          stepCount: number;
          finishReason: LLMFinishReason;
      };

export type TurnDriver = {
    runNextModelStep(): Promise<TurnDriverModelStep>;
    executeToolCalls(): Promise<void>;
    decideNextStep(): Promise<TurnDriverNextAction>;
    finish(): Promise<ExecutorResult>;
    fail(error: unknown): Promise<never>;
    dispose(): void;
};

/**
 * Static cache for tool support validation.
 * Persists across TurnExecutor instances to avoid repeated validation calls.
 * Key format: "provider:model:baseURL"
 */
const toolSupportCache = new Map<string, boolean>();

/**
 * Local providers that need tool support validation regardless of baseURL
 */
const LOCAL_PROVIDERS: readonly LLMProvider[] = ['ollama', 'local'] as const;

/**
 * TurnExecutor orchestrates the agent loop using `stopWhen: stepCountIs(1)`.
 *
 * This is the main entry point that replaces Vercel's internal loop with our
 * controlled execution, giving us control between steps for:
 * - queued steer and follow-up input
 * - context compaction decisions
 * - old tool output pruning
 * - explicit tool preparation, approval, and execution
 *
 * Key design: Uses stopWhen: stepCountIs(1) to regain control after each step.
 * A "step" = ONE LLM call. Tool calls from that model step are executed by TurnExecutor
 * before the next model call.
 */
export class TurnExecutor {
    private logger: Logger;
    /**
     * Per-step abort controller. Created fresh for each iteration of the loop.
     * This allows soft cancel (abort current step) while still continuing with queued messages.
     */
    private stepAbortController: AbortController;
    private compactionStrategy: CompactionStrategy | null = null;
    private currentModelStepId = 'in-memory-model-step-0';
    constructor(
        private model: LanguageModel,
        private toolManager: ToolManager,
        private contextManager: ContextManager<ModelMessage>,
        private eventBus: SessionEventBus,
        private resourceManager: ResourceManager,
        private sessionId: string,
        private config: {
            maxSteps?: number | undefined;
            maxOutputTokens?: number | undefined;
            temperature?: number | undefined;
            baseURL?: string | undefined;
            usageScopeId?: string | undefined;
            // Provider-specific options
            reasoning?: LLMReasoningConfig | undefined;
        },
        private llmContext: LLMContext,
        logger: Logger,
        private steerQueue: MessageQueueService,
        private followUpQueue: MessageQueueService,
        private modelLimits?: ModelLimits,
        private externalSignal?: AbortSignal,
        compactionStrategy: CompactionStrategy | null = null,
        private runContext?: AgentRunContext
    ) {
        this.logger = logger.createChild(DextoLogComponent.EXECUTOR);
        // Initial controller - will be replaced per-step in execute()
        this.stepAbortController = new AbortController();

        // NOTE: We intentionally do NOT link external signal here permanently.
        // Instead, we link it per-step in execute() so that:
        // - Soft cancel: aborts current step, but queue can continue with fresh controller
        // - Hard cancel (external aborted + clearQueue): checked explicitly in loop

        this.compactionStrategy = compactionStrategy;
    }

    /**
     * Get StreamProcessor config from TurnExecutor state.
     * @param estimatedInputTokens Optional estimated input tokens for analytics
     */
    private getStreamProcessorConfig(
        estimatedInputTokens?: number,
        reasoning?: { reasoningVariant?: ReasoningVariant; reasoningBudgetTokens?: number }
    ): StreamProcessorConfig {
        return {
            provider: this.llmContext.provider,
            model: this.llmContext.model,
            ...(this.config.usageScopeId !== undefined && {
                usageScopeId: this.config.usageScopeId,
            }),
            ...(estimatedInputTokens !== undefined && { estimatedInputTokens }),
            ...(reasoning?.reasoningVariant !== undefined && {
                reasoningVariant: reasoning.reasoningVariant,
            }),
            ...(reasoning?.reasoningBudgetTokens !== undefined && {
                reasoningBudgetTokens: reasoning.reasoningBudgetTokens,
            }),
        };
    }

    /**
     * Main agent execution loop.
     * Uses stopWhen: stepCountIs(1) to regain control after each step.
     *
     * @param contributorContext Context for system prompt contributors
     * @param streaming If true, emits llm:chunk events during streaming. Default true.
     */
    async execute(
        contributorContext: DynamicContributorContext,
        streaming: boolean = true
    ): Promise<ExecutorResult> {
        const driver = await this.createDriver(contributorContext, streaming);

        try {
            let stopped = false;
            try {
                while (!stopped) {
                    const modelStep = await driver.runNextModelStep();
                    if (modelStep.result.finishReason === 'tool-calls') {
                        await driver.executeToolCalls();
                    }

                    const nextStep = await driver.decideNextStep();
                    if (nextStep.kind === 'stop') {
                        stopped = true;
                    }
                }
            } catch (error) {
                return await driver.fail(error);
            }
            return await driver.finish();
        } finally {
            driver.dispose();
        }
    }

    async createDriver(
        contributorContext: DynamicContributorContext,
        streaming: boolean = true
    ): Promise<TurnDriver> {
        const startTime = Date.now();

        let stepCount = 0;
        let lastStepTokens: TokenUsage | null = null;
        let lastFinishReason: LLMFinishReason = 'unknown';
        let lastText = '';
        let currentStepScope: ModelStepScope | null = null;
        let currentResult: StreamProcessorResult | null = null;
        let currentToolCallsExecuted = false;
        let stopped = false;
        let finished = false;
        let disposed = false;

        let turn: TurnStart;
        try {
            turn = await this.startTurn();
        } catch (error) {
            this.cleanup();
            throw error;
        }

        const closeCurrentStepScope = () => {
            currentStepScope?.[Symbol.dispose]();
            currentStepScope = null;
        };

        const assertCanUseDriver = () => {
            if (disposed) {
                throw new Error('Turn driver has already been disposed');
            }
            if (finished) {
                throw new Error('Turn driver has already finished');
            }
        };

        return {
            runNextModelStep: async () => {
                assertCanUseDriver();
                if (stopped) {
                    throw new Error('Turn driver has already reached a stop decision');
                }
                if (currentStepScope !== null) {
                    throw new Error('Previous model step has not been decided yet');
                }
                currentStepScope = this.startModelStepScope();
                const modelStepRequest = await this.prepareNextModelRequest({
                    contributorContext,
                    supportsTools: turn.supportsTools,
                    streaming,
                });

                this.logger.debug(`Step ${stepCount}: Starting`);
                this.currentModelStepId = `in-memory-model-step-${stepCount}`;

                const result = await this.runModelStepWithRetry(modelStepRequest);
                currentResult = result;
                currentToolCallsExecuted = result.finishReason !== 'tool-calls';

                lastStepTokens = result.usage;
                lastFinishReason = result.finishReason;
                lastText = result.text;

                this.logger.debug(
                    `Step ${stepCount}: Finished with reason="${result.finishReason}", ` +
                        `tokens=${JSON.stringify(result.usage)}`
                );

                await this.applyModelStepResult({
                    result,
                    request: modelStepRequest,
                    contributorContext,
                });

                return {
                    result,
                    stepCount,
                };
            },
            executeToolCalls: async () => {
                assertCanUseDriver();
                if (currentStepScope === null) {
                    throw new Error('No active model step is available for tool execution');
                }
                const result = currentResult;
                if (result === null) {
                    throw new Error('No model step result is available for tool execution');
                }
                if (currentToolCallsExecuted) {
                    throw new Error('Tool calls for the current model step have already run');
                }
                if (result.finishReason === 'tool-calls') {
                    currentToolCallsExecuted = true;
                    await this.executeModelToolCalls(result.toolCalls);
                }
            },
            decideNextStep: async () => {
                assertCanUseDriver();
                if (currentStepScope === null) {
                    throw new Error('No active model step is available to decide');
                }
                const result = currentResult;
                if (result === null) {
                    throw new Error('No model step result is available to decide');
                }
                if (result.finishReason === 'tool-calls' && !currentToolCallsExecuted) {
                    throw new Error('Tool calls must finish before deciding the next model step');
                }
                const nextStep = await this.decideNextStep(result, stepCount);
                stepCount = nextStep.stepCount;
                currentResult = null;
                currentToolCallsExecuted = false;
                closeCurrentStepScope();
                if (nextStep.kind === 'stop') {
                    lastFinishReason = nextStep.finishReason;
                    stopped = true;
                    return {
                        kind: 'stop',
                        stepCount,
                        finishReason: lastFinishReason,
                    };
                }
                return {
                    kind: 'continue',
                    stepCount,
                };
            },
            finish: async () => {
                assertCanUseDriver();
                if (!stopped) {
                    throw new Error('Turn driver cannot finish before a stop decision');
                }
                finished = true;
                return this.finishTurn({
                    startTime,
                    stepCount,
                    text: lastText,
                    usage: lastStepTokens,
                    finishReason: lastFinishReason,
                });
            },
            fail: async (error) => {
                closeCurrentStepScope();
                return this.failTurn(error, stepCount, startTime);
            },
            dispose: () => {
                disposed = true;
                closeCurrentStepScope();
                this.cleanup();
            },
        };
    }

    /**
     * Abort the current step execution.
     * Note: For full run cancellation, use the external abort signal.
     */
    abort(): void {
        this.stepAbortController.abort();
    }

    private async startTurn(): Promise<TurnStart> {
        this.eventBus.emit('llm:thinking', {});

        const supportsTools = await this.validateToolSupport();
        if (!supportsTools) {
            const modelKey = `${this.llmContext.provider}:${this.llmContext.model}`;
            this.eventBus.emit('llm:unsupported-input', {
                errors: [
                    `Model '${modelKey}' does not support tool calling.`,
                    'You can still chat, but the model will not be able to use tools or execute commands.',
                ],
                provider: this.llmContext.provider,
                model: this.llmContext.model,
                details: {
                    feature: 'tool-calling',
                    supported: false,
                },
            });
            this.logger.warn(
                `Model ${modelKey} does not support tools - continuing without tool calling`
            );
        }

        return { supportsTools };
    }

    private startModelStepScope(): ModelStepScope {
        // Fresh per-step controller: soft cancel aborts current work, while queued input can
        // continue in a later step with a new controller.
        this.stepAbortController = new AbortController();

        const abortHandler = () => this.stepAbortController.abort();
        if (this.externalSignal && !this.externalSignal.aborted) {
            this.externalSignal.addEventListener('abort', abortHandler, { once: true });
        }

        return {
            [Symbol.dispose]: () => {
                this.externalSignal?.removeEventListener('abort', abortHandler);
            },
        };
    }

    private async finishTurn(input: FinishTurnInput): Promise<ExecutorResult> {
        await this.contextManager.flush();

        this.setTelemetryAttributes(input.usage);

        this.eventBus.emit('run:complete', {
            finishReason: input.finishReason,
            stepCount: input.stepCount,
            durationMs: Date.now() - input.startTime,
        });

        return {
            text: input.text,
            stepCount: input.stepCount,
            usage: input.usage,
            finishReason: input.finishReason,
        };
    }

    private async failTurn(error: unknown, stepCount: number, startTime: number): Promise<never> {
        const mappedError = this.mapProviderError(error);
        this.logger.error('TurnExecutor failed', { error: mappedError });

        this.eventBus.emit('llm:error', {
            error: mappedError,
            context: 'TurnExecutor',
            recoverable: false,
        });

        await this.contextManager.flush();

        this.eventBus.emit('run:complete', {
            finishReason: 'error',
            stepCount,
            durationMs: Date.now() - startTime,
            error: mappedError,
        });

        throw mappedError;
    }

    private advanceStep(stepCount: number): StepAdvance {
        const nextStepCount = stepCount + 1;
        if (this.config.maxSteps !== undefined && nextStepCount >= this.config.maxSteps) {
            return {
                kind: 'stop',
                stepCount: nextStepCount,
                finishReason: 'max-steps',
            };
        }
        return {
            kind: 'continue',
            stepCount: nextStepCount,
        };
    }

    private async continueWithQueuedInput(
        kind: QueuedInputKind,
        queue: MessageQueueService,
        stepCount: number,
        finishReason: LLMFinishReason
    ): Promise<QueuedInputAction> {
        const label = kind === 'late-steer' ? 'late steer' : 'follow-up';

        if (this.externalSignal?.aborted || finishReason === 'cancelled') {
            this.logger.debug(`Terminating: cancel received before ${label}`);
            return {
                kind: 'stop',
                stepCount,
                finishReason: 'cancelled',
            };
        }

        const stepAdvance = this.advanceStep(stepCount);
        if (stepAdvance.kind === 'stop') {
            this.logger.debug(`Terminating: reached maxSteps (${this.config.maxSteps})`);
            return stepAdvance;
        }

        const queued = await queue.dequeueAll();
        if (!queued) {
            this.logger.debug(`Terminating: finishReason is "${finishReason}"`);
            return {
                kind: 'stop',
                stepCount: stepAdvance.stepCount,
                finishReason,
            };
        }

        const messageName = kind === 'late-steer' ? 'steer' : 'follow-up';
        const suffix = kind === 'late-steer' ? ' at end of turn' : '';
        this.logger.debug(
            `Continuing: ${queued.messages.length} ${messageName} message(s) to process${suffix}`
        );
        await this.injectQueuedMessages(queued);
        return {
            kind: 'continue',
            stepCount: stepAdvance.stepCount,
        };
    }

    private async decideNextStep(
        result: StreamProcessorResult,
        stepCount: number
    ): Promise<QueuedInputAction> {
        if (result.finishReason === 'tool-calls') {
            // Hard cancel check during tool-calls: if queue is empty and signal aborted, exit.
            if (this.externalSignal?.aborted && !this.steerQueue.hasPending()) {
                this.logger.debug('Terminating: hard cancel - external abort signal received');
                return {
                    kind: 'stop',
                    stepCount,
                    finishReason: 'cancelled',
                };
            }

            return this.advanceStep(stepCount);
        }

        // Steer messages submitted while the final LLM request was already in flight missed the
        // pre-request injection point. Treat them as end-of-turn input before explicit follow-ups.
        if (this.steerQueue.hasPending()) {
            return this.continueWithQueuedInput(
                'late-steer',
                this.steerQueue,
                stepCount,
                result.finishReason
            );
        }

        // Follow-ups run only after the active turn naturally reaches a stop point.
        if (this.followUpQueue.hasPending()) {
            return this.continueWithQueuedInput(
                'follow-up',
                this.followUpQueue,
                stepCount,
                result.finishReason
            );
        }

        this.logger.debug(`Terminating: finishReason is "${result.finishReason}"`);
        return {
            kind: 'stop',
            stepCount,
            finishReason: result.finishReason,
        };
    }

    /**
     * Inject coalesced queued messages into the context as a single user message.
     * This enables mid-task user guidance.
     */
    private async injectQueuedMessages(coalesced: CoalescedMessage): Promise<void> {
        // Add as single user message with all guidance
        await this.contextManager.addMessage({
            role: 'user',
            content: coalesced.combinedContent,
            metadata: {
                coalesced: coalesced.messages.length > 1,
                messageCount: coalesced.messages.length,
                originalMessageIds: coalesced.messages.map((m) => m.id),
            },
        });

        this.logger.info(`Injected ${coalesced.messages.length} queued message(s) into context`, {
            count: coalesced.messages.length,
            firstQueued: coalesced.firstQueuedAt,
            lastQueued: coalesced.lastQueuedAt,
        });
    }

    /**
     * Validates if the current model supports tools.
     * Uses a static cache to avoid repeated validation calls.
     *
     * For local providers (Ollama, local) and most custom baseURL endpoints, makes a test call
     * to verify tool support. Codex app-server uses a custom provider path for tool calling,
     * so it is treated as tool-capable without HTTP probing.
     * Known cloud providers without baseURL are assumed to support tools.
     */
    private async validateToolSupport(): Promise<boolean> {
        const modelKey = `${this.llmContext.provider}:${this.llmContext.model}:${this.config.baseURL ?? ''}`;

        // Check cache first
        if (toolSupportCache.has(modelKey)) {
            return toolSupportCache.get(modelKey)!;
        }

        if (isCodexBaseURL(this.config.baseURL)) {
            this.logger.debug(
                `Skipping tool validation for ${modelKey} - Codex app-server integration manages tool support internally`
            );
            toolSupportCache.set(modelKey, true);
            return true;
        }

        // Local providers need validation regardless of baseURL (models have varying support)
        const isLocalProvider = LOCAL_PROVIDERS.includes(this.llmContext.provider);

        // Skip validation only for known cloud providers without custom baseURL
        if (!this.config.baseURL && !isLocalProvider) {
            this.logger.debug(
                `Skipping tool validation for ${modelKey} - known cloud provider without custom baseURL`
            );
            toolSupportCache.set(modelKey, true);
            return true;
        }

        this.logger.debug(
            `Testing tool support for ${isLocalProvider ? 'local provider' : 'custom endpoint'} model: ${modelKey}`
        );

        // Create a minimal test tool
        const testTool = {
            test_tool: {
                inputSchema: jsonSchema({
                    type: 'object',
                    properties: {},
                    additionalProperties: false,
                }),
                execute: async () => ({ result: 'test' }),
            },
        };

        // Add timeout protection to fail fast if endpoint is unresponsive
        const testAbort = new AbortController();
        const testTimeout = setTimeout(() => testAbort.abort(), 5000); // 5s timeout

        try {
            // Make a minimal generateText call with tools to test support
            await generateText({
                model: this.model,
                messages: [{ role: 'user', content: 'Hello' }],
                tools: testTool,
                stopWhen: stepCountIs(1),
                abortSignal: testAbort.signal,
            });
            clearTimeout(testTimeout);

            // If we get here, tools are supported
            toolSupportCache.set(modelKey, true);
            this.logger.debug(`Model ${modelKey} supports tools`);
            return true;
        } catch (error: unknown) {
            clearTimeout(testTimeout);
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('does not support tools')) {
                toolSupportCache.set(modelKey, false);
                this.logger.debug(
                    `Detected that model ${modelKey} does not support tool calling - tool functionality will be disabled`
                );
                return false;
            }
            // Other errors (including timeout) - assume tools are supported and let the actual call handle it
            this.logger.debug(
                `Tool validation error for ${modelKey}, assuming supported: ${errorMessage}`
            );
            toolSupportCache.set(modelKey, true);
            return true;
        }
    }

    private async prepareNextModelRequest(
        input: ModelStepPreparationInput
    ): Promise<ModelStepRequest> {
        // Check for queued messages before preparing context for the next model request.
        const coalesced = await this.steerQueue.dequeueAll();
        if (coalesced) {
            await this.injectQueuedMessages(coalesced);
        }

        // Prune old tool outputs before compaction, so pruning can avoid unnecessary compaction.
        await this.pruneOldToolOutputs();

        let prepared = await this.contextManager.getFormattedMessagesForLLM(
            input.contributorContext,
            this.llmContext
        );

        const toolDefinitions = input.supportsTools
            ? this.toolManager.filterToolsForSession(
                  await this.toolManager.getAllTools(),
                  this.sessionId
              )
            : {};

        let estimatedInputTokens = await this.contextManager.getEstimatedNextInputTokens(
            prepared.systemPrompt,
            prepared.preparedHistory,
            toolDefinitions
        );

        if (this.shouldCompact(estimatedInputTokens)) {
            this.logger.debug(
                `Pre-check: estimated ${estimatedInputTokens} tokens exceeds threshold, compacting`
            );
            const didCompact = await this.compactContext(
                estimatedInputTokens,
                input.contributorContext,
                toolDefinitions
            );

            if (didCompact) {
                prepared = await this.contextManager.getFormattedMessagesForLLM(
                    input.contributorContext,
                    this.llmContext
                );
                estimatedInputTokens = await this.contextManager.getEstimatedNextInputTokens(
                    prepared.systemPrompt,
                    prepared.preparedHistory,
                    toolDefinitions
                );
                this.logger.debug(
                    `Post-compaction: recomputed estimate is ${estimatedInputTokens} tokens`
                );
            }
        }

        const providerOptions = buildProviderOptions({
            provider: this.llmContext.provider,
            model: this.llmContext.model,
            reasoning: this.config.reasoning,
        });

        // Debug log for verifying reasoning + provider options are actually being sent.
        // (Avoids logging headers/body; providerOptions captures the effective request knobs.)
        this.logger.debug('LLM request options', {
            provider: this.llmContext.provider,
            model: this.llmContext.model,
            requestedReasoning: {
                variant: this.config.reasoning?.variant,
                budgetTokens: this.config.reasoning?.budgetTokens,
            },
            providerOptions,
        });

        const reasoningVariant = this.config.reasoning?.variant;
        const reasoningBudgetTokens = getEffectiveReasoningBudgetTokens(providerOptions);
        const reasoning =
            reasoningVariant !== undefined || reasoningBudgetTokens !== undefined
                ? {
                      ...(reasoningVariant !== undefined && { reasoningVariant }),
                      ...(reasoningBudgetTokens !== undefined && { reasoningBudgetTokens }),
                  }
                : undefined;

        return {
            messages: prepared.formattedMessages,
            tools: input.supportsTools ? createModelToolDefinitions(toolDefinitions) : {},
            toolDefinitions,
            estimatedInputTokens,
            reasoning,
            providerOptions: providerOptions as SharedV2ProviderOptions | undefined,
            streaming: input.streaming,
        };
    }

    private async runModelStep(request: ModelStepRequest): Promise<StreamProcessorResult> {
        const streamProcessor = new StreamProcessor(
            this.contextManager,
            this.eventBus,
            this.stepAbortController.signal,
            this.getStreamProcessorConfig(request.estimatedInputTokens, request.reasoning),
            this.logger,
            request.streaming
        );

        return streamProcessor.process(() =>
            streamText({
                model: this.model,
                stopWhen: stepCountIs(1),
                maxRetries: 0,
                tools: request.tools,
                abortSignal: this.stepAbortController.signal,
                messages: request.messages,
                ...(this.config.maxOutputTokens !== undefined && {
                    maxOutputTokens: this.config.maxOutputTokens,
                }),
                ...(this.config.temperature !== undefined && {
                    temperature: this.config.temperature,
                }),
                // Provider-specific options (caching, reasoning, etc.)
                ...(request.providerOptions !== undefined && {
                    providerOptions: request.providerOptions,
                }),
                // Log stream-level errors (tool errors, API errors during streaming)
                onError: (error) => {
                    this.logger.error('Stream error', { error });
                },
            })
        );
    }

    private async runModelStepWithRetry(request: ModelStepRequest): Promise<StreamProcessorResult> {
        for (let failedAttempts = 0; ; failedAttempts += 1) {
            const historyLengthBefore = (await this.contextManager.getHistory()).length;

            try {
                return await this.runModelStep(request);
            } catch (error) {
                const historyLengthAfter = (await this.contextManager.getHistory()).length;
                const historyLengthChanged = historyLengthAfter !== historyLengthBefore;

                if (
                    !this.canRetryModelRequest(error, historyLengthChanged) ||
                    failedAttempts >= MODEL_REQUEST_MAX_RETRIES
                ) {
                    throw error;
                }

                const mappedError = this.mapProviderError(error);
                this.eventBus.emit('llm:retrying', {
                    error: mappedError,
                    context: 'TurnExecutor.runModelStep',
                    attempt: failedAttempts + 1,
                    maxRetries: MODEL_REQUEST_MAX_RETRIES,
                    provider: this.llmContext.provider,
                    model: this.llmContext.model,
                });

                this.logger.warn('Retrying model request after transient failure', {
                    attempt: failedAttempts + 1,
                    maxRetries: MODEL_REQUEST_MAX_RETRIES,
                    error: mappedError,
                });
            }
        }
    }

    private canRetryModelRequest(error: unknown, historyLengthChanged: boolean): boolean {
        if (historyLengthChanged) return false;
        if (this.stepAbortController.signal.aborted) return false;
        if (!APICallError.isInstance?.(error)) return false;
        return error.isRetryable;
    }

    private async applyModelStepResult(input: ModelStepApplicationInput): Promise<void> {
        const { result, request, contributorContext } = input;

        // Store actual token counts for context estimation formula:
        // estimatedNextInput = lastInput + lastOutput + newMessagesEstimate.
        //
        // On cancellation, keep the last successful boundary. The partial response is saved to
        // history and included in newMessagesEstimate until a successful call self-corrects.
        // Tracking issue for AI SDK to support partial usage on cancel:
        // https://github.com/vercel/ai/issues/7628
        if (result.finishReason === 'cancelled') {
            this.logger.info(
                `Context estimation (cancelled): keeping last known actuals, partial response (${result.text.length} chars) will be estimated`
            );
            return;
        }

        const contextInputTokens = this.getContextInputTokens(result.usage);

        if (result.usage.inputTokens !== undefined) {
            const actualInputTokens = contextInputTokens ?? result.usage.inputTokens;
            const diff = request.estimatedInputTokens - actualInputTokens;
            const diffPercent =
                actualInputTokens > 0 ? ((diff / actualInputTokens) * 100).toFixed(1) : '0.0';
            this.logger.info(
                `Context estimation accuracy: estimated=${request.estimatedInputTokens}, actual=${actualInputTokens}, ` +
                    `error=${diff} (${diffPercent}%)`
            );
            this.contextManager.setLastActualInputTokens(actualInputTokens);

            if (result.usage.outputTokens !== undefined) {
                this.contextManager.setLastActualOutputTokens(result.usage.outputTokens);
            }

            await this.contextManager.recordLastCallMessageCount();
        }

        if (
            result.finishReason !== 'tool-calls' &&
            contextInputTokens &&
            this.shouldCompactFromActual(contextInputTokens)
        ) {
            this.logger.debug(
                `Post-response: actual ${contextInputTokens} tokens exceeds threshold, compacting`
            );
            await this.compactContext(
                contextInputTokens,
                contributorContext,
                request.toolDefinitions
            );
        }
    }

    private async executeModelToolCalls(toolCalls: ModelToolCall[]): Promise<void> {
        const preparedCalls: PreparedModelToolCall[] = [];

        for (const toolCall of toolCalls) {
            preparedCalls.push(await this.prepareModelToolCall(toolCall));
        }

        const executionResults = await Promise.all(
            preparedCalls.map((prepared) => this.executePreparedModelToolCall(prepared))
        );
        for (let index = 0; index < toolCalls.length; index += 1) {
            const toolCall = toolCalls[index];
            const executionResult = executionResults[index];
            if (toolCall === undefined || executionResult === undefined) {
                throw new Error('Tool call result count must match emitted tool call count');
            }
            await this.persistModelToolResult(toolCall, executionResult);
        }
    }

    private async prepareModelToolCall(toolCall: ModelToolCall): Promise<PreparedModelToolCall> {
        if (this.stepAbortController.signal.aborted) {
            return {
                kind: 'terminal',
                toolCall,
                modelVisibleResult: this.cancelledToolResult(
                    this.buildToolCallFallbackSnapshot(toolCall.toolName)
                ),
            };
        }

        let prepared: PreparedToolCall;
        try {
            prepared = await this.toolManager.prepareToolCall({
                toolName: toolCall.toolName,
                input: toolCall.input,
                toolCallId: toolCall.toolCallId,
                sessionId: this.sessionId,
                ...(this.runContext !== undefined ? { runContext: this.runContext } : {}),
            });
        } catch (error) {
            const modelVisibleResult = this.failedToolResult(
                toolCall.toolName,
                error,
                this.buildToolCallFallbackSnapshot(toolCall.toolName)
            );
            this.emitFallbackToolCall(toolCall, modelVisibleResult);
            return {
                kind: 'terminal',
                toolCall,
                modelVisibleResult,
            };
        }

        if (prepared.kind === 'terminal') {
            if ('call' in prepared) {
                this.emitToolCall(toolCall, prepared.call);
            } else {
                this.emitFallbackToolCall(toolCall, prepared.modelVisibleResult);
            }
        } else {
            this.emitToolCall(toolCall, prepared.call);
        }

        return { kind: 'prepared', toolCall, prepared };
    }

    private async executePreparedModelToolCall(
        preparedCall: PreparedModelToolCall
    ): Promise<ToolExecutionResult> {
        try {
            if (preparedCall.kind === 'terminal') {
                return preparedCall.modelVisibleResult;
            }

            const { prepared } = preparedCall;
            if (prepared.kind === 'terminal') {
                return prepared.modelVisibleResult;
            }

            if (prepared.kind === 'ready') {
                return this.executePreparedToolCallWithAbort(prepared.call);
            }

            const identity = this.resolveToolApprovalIdentity();
            const recorded = await this.toolManager.recordApprovalRequest(prepared, identity);
            const approval = await this.requestApprovalDecisionWithAbort(recorded);
            if (approval.kind === 'terminal') {
                return approval.modelVisibleResult;
            }
            const decision = this.toApprovalDecisionInput(approval.response);
            const applied = await this.toolManager.applyApprovalDecision(
                recorded,
                decision,
                this.runContext
            );
            if (applied.kind === 'terminal') {
                return applied.modelVisibleResult;
            }

            return this.executePreparedToolCallWithAbort(applied.call);
        } catch (error) {
            return this.failedToolResult(
                preparedCall.toolCall.toolName,
                error,
                this.getPreparedToolCallSnapshot(preparedCall)
            );
        }
    }

    private emitFallbackToolCall(
        toolCall: ModelToolCall,
        executionResult: ToolExecutionResult
    ): void {
        this.emitToolCall(toolCall, {
            input: this.getToolCallInputForEvent(toolCall.input),
            presentationSnapshot:
                executionResult.presentationSnapshot ??
                this.buildToolCallFallbackSnapshot(toolCall.toolName),
            toolName: toolCall.toolName,
        });
    }

    private async executePreparedToolCallWithAbort(
        call: Parameters<ToolManager['executePreparedToolCall']>[0]
    ): Promise<ToolExecutionResult> {
        const abortSignal = this.stepAbortController.signal;
        let abortHandler: (() => void) | null = null;
        const abortPromise = new Promise<ToolExecutionResult>((resolve) => {
            abortHandler = () => {
                this.logger.debug(`Tool ${call.toolName} cancelled during execution`);
                resolve(this.cancelledToolResult(call.presentationSnapshot, call));
            };
            abortSignal.addEventListener('abort', abortHandler, { once: true });
        });

        try {
            return await Promise.race([
                this.toolManager.executePreparedToolCall(call, {
                    sessionId: this.sessionId,
                    abortSignal,
                    ...(this.runContext !== undefined ? { runContext: this.runContext } : {}),
                }),
                abortPromise,
            ]);
        } finally {
            if (abortHandler) {
                abortSignal.removeEventListener('abort', abortHandler);
            }
        }
    }

    private async requestApprovalDecisionWithAbort(
        recorded: RecordedToolApproval
    ): Promise<ApprovalWaitResult> {
        const abortSignal = this.stepAbortController.signal;
        if (abortSignal.aborted) {
            return {
                kind: 'terminal',
                modelVisibleResult: this.cancelledToolResult(
                    recorded.prepared.call.presentationSnapshot,
                    recorded.prepared.call
                ),
            };
        }

        let abortHandler: (() => void) | null = null;
        const abortPromise = new Promise<ApprovalWaitResult>((resolve) => {
            abortHandler = () => {
                this.logger.debug(
                    `Tool ${recorded.prepared.call.toolName} approval cancelled before execution`
                );
                resolve({
                    kind: 'terminal',
                    modelVisibleResult: this.cancelledToolResult(
                        recorded.prepared.call.presentationSnapshot,
                        recorded.prepared.call
                    ),
                });
            };
            abortSignal.addEventListener('abort', abortHandler, { once: true });
        });

        try {
            return await Promise.race([
                this.toolManager
                    .requestApprovalDecision(recorded)
                    .then((response): ApprovalWaitResult => ({ kind: 'response', response })),
                abortPromise,
            ]);
        } finally {
            if (abortHandler) {
                abortSignal.removeEventListener('abort', abortHandler);
            }
        }
    }

    private cancelledToolResult(
        presentationSnapshot: ToolPresentationSnapshotV1,
        call?: Pick<ExecutableToolCall, 'approval' | 'meta'>
    ): ToolExecutionResult {
        return {
            result: { error: 'Cancelled by user', cancelled: true },
            presentationSnapshot,
            ...(call?.meta !== undefined ? { meta: call.meta } : {}),
            ...(call?.approval !== undefined ? call.approval : {}),
        };
    }

    private failedToolResult(
        toolName: string,
        error: unknown,
        presentationSnapshot: ToolPresentationSnapshotV1
    ): ToolExecutionResult {
        const message = toError(error, this.logger).message;
        this.logger.error(`Tool ${toolName} failed before execution result was produced`, {
            error: message,
        });
        return {
            result: { error: message },
            presentationSnapshot,
        };
    }

    private getPreparedToolCallSnapshot(
        preparedCall: PreparedModelToolCall
    ): ToolPresentationSnapshotV1 {
        if (preparedCall.kind === 'terminal') {
            return (
                preparedCall.modelVisibleResult.presentationSnapshot ??
                this.buildToolCallFallbackSnapshot(preparedCall.toolCall.toolName)
            );
        }
        if ('call' in preparedCall.prepared) {
            return preparedCall.prepared.call.presentationSnapshot;
        }
        return (
            preparedCall.prepared.modelVisibleResult.presentationSnapshot ??
            this.buildToolCallFallbackSnapshot(preparedCall.toolCall.toolName)
        );
    }

    private async persistModelToolResult(
        toolCall: ModelToolCall,
        executionResult: ToolExecutionResult
    ): Promise<void> {
        const success = this.isToolExecutionSuccessful(executionResult);
        const sanitized = await sanitizeToolResult(
            executionResult.result,
            {
                artifactStore: this.resourceManager.getArtifactStore(),
                toolName: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                success,
            },
            this.logger
        );
        const truncated = truncateToolResult(sanitized);
        const metadata = this.getToolExecutionMetadata(executionResult);
        const errorMessage = this.getToolExecutionErrorMessage(executionResult.result);

        await this.contextManager.addToolResult(
            toolCall.toolCallId,
            toolCall.toolName,
            truncated,
            metadata
        );

        this.eventBus.emit('llm:tool-result', {
            toolName: toolCall.toolName,
            ...(metadata?.presentationSnapshot !== undefined && {
                presentationSnapshot: metadata.presentationSnapshot,
            }),
            ...(metadata?.meta !== undefined && {
                meta: metadata.meta,
            }),
            callId: toolCall.toolCallId,
            success,
            sanitized: truncated,
            rawResult: executionResult.result,
            ...(!success && errorMessage !== null ? { error: errorMessage } : {}),
            ...(metadata?.requireApproval !== undefined && {
                requireApproval: metadata.requireApproval,
            }),
            ...(metadata?.approvalStatus !== undefined && {
                approvalStatus: metadata.approvalStatus,
            }),
        });
    }

    private emitToolCall(
        toolCall: ModelToolCall,
        call: Pick<
            ExecutableToolCall,
            'callDescription' | 'input' | 'meta' | 'presentationSnapshot' | 'toolName'
        >
    ): void {
        this.eventBus.emit('llm:tool-call', {
            toolName: toolCall.toolName,
            ...(call.presentationSnapshot !== undefined && {
                presentationSnapshot: call.presentationSnapshot,
            }),
            args: call.input,
            ...(call.meta !== undefined ? { meta: call.meta } : {}),
            ...(call.callDescription !== undefined && { callDescription: call.callDescription }),
            callId: toolCall.toolCallId,
            ...(this.runContext?.hostRuntime !== undefined && {
                hostRuntime: this.runContext.hostRuntime,
            }),
        });
    }

    private resolveToolApprovalIdentity(): {
        runId: string;
        turnId: string;
        modelStepId: string;
    } {
        const ids = this.runContext?.hostRuntime?.ids;
        return {
            runId: ids?.runId ?? this.sessionId,
            turnId: ids?.turnId ?? 'in-memory-turn',
            modelStepId: ids?.modelStepId ?? this.currentModelStepId,
        };
    }

    private toApprovalDecisionInput(response: ApprovalResponse): ApprovalDecisionInput {
        if (response.status === ApprovalStatus.APPROVED) {
            return {
                approvalId: response.approvalId,
                status: ApprovalStatus.APPROVED,
                ...(response.data !== undefined ? { data: response.data } : {}),
            };
        }

        const status =
            response.status === ApprovalStatus.DENIED
                ? ApprovalStatus.DENIED
                : ApprovalStatus.CANCELLED;

        return {
            approvalId: response.approvalId,
            status,
            ...(response.reason !== undefined ? { reason: response.reason } : {}),
            ...(response.message !== undefined ? { message: response.message } : {}),
            ...(response.timeoutMs !== undefined ? { timeoutMs: response.timeoutMs } : {}),
            ...(response.data !== undefined ? { data: response.data } : {}),
        };
    }

    private getToolExecutionMetadata(executionResult: ToolExecutionResult):
        | {
              presentationSnapshot?: ToolPresentationSnapshotV1;
              meta?: ToolCallMetadata;
              requireApproval?: boolean;
              approvalStatus?: 'approved' | 'rejected';
          }
        | undefined {
        const metadata: {
            presentationSnapshot?: ToolPresentationSnapshotV1;
            meta?: ToolCallMetadata;
            requireApproval?: boolean;
            approvalStatus?: 'approved' | 'rejected';
        } = {};
        if (executionResult.presentationSnapshot !== undefined) {
            metadata.presentationSnapshot = executionResult.presentationSnapshot;
        }
        if (executionResult.meta !== undefined) {
            metadata.meta = executionResult.meta;
        }
        if (executionResult.requireApproval !== undefined) {
            metadata.requireApproval = executionResult.requireApproval;
        }
        if (executionResult.approvalStatus !== undefined) {
            metadata.approvalStatus = executionResult.approvalStatus;
        }
        return Object.keys(metadata).length > 0 ? metadata : undefined;
    }

    private isToolExecutionSuccessful(executionResult: ToolExecutionResult): boolean {
        return !this.getToolExecutionErrorMessage(executionResult.result);
    }

    private getToolExecutionErrorMessage(result: unknown): string | null {
        if (result && typeof result === 'object' && 'error' in result) {
            const error = (result as { error?: unknown }).error;
            return typeof error === 'string' ? error : String(error);
        }
        return null;
    }

    private getToolCallInputForEvent(input: unknown): Record<string, unknown> {
        return input !== null && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : {};
    }

    private buildToolCallFallbackSnapshot(toolName: string): ToolPresentationSnapshotV1 {
        return {
            version: 1,
            source: {
                type: toolName.startsWith(MCP_TOOL_PREFIX) ? 'mcp' : 'local',
            },
            header: {
                title: toolName.replace(/[_-]+/g, ' '),
            },
        };
    }

    /**
     * Constants for pruning thresholds
     */
    private static readonly PRUNE_PROTECT = 40_000; // Keep last 40K tokens of tool outputs
    private static readonly PRUNE_MINIMUM = 20_000; // Only prune if we can save 20K+

    /**
     * Prunes old tool outputs by marking them with compactedAt timestamp.
     * Does NOT modify content - transformation happens at format time in
     * ContextManager.prepareHistory().
     *
     * Algorithm:
     * 1. Go backwards through history (most recent first)
     * 2. Stop at summary message (only process post-summary messages)
     * 3. Count tool message tokens
     * 4. If total exceeds PRUNE_PROTECT, mark older ones for pruning
     * 5. Only prune if savings exceed PRUNE_MINIMUM
     */
    private async pruneOldToolOutputs(): Promise<{ prunedCount: number; savedTokens: number }> {
        const history = await this.contextManager.getHistory();
        let totalToolTokens = 0;
        let prunedTokens = 0;
        const toPrune: string[] = []; // Message IDs to mark

        // Go backwards through history (most recent first)
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (!msg) continue;

            // Stop at summary message - only prune AFTER the summary
            if (msg.metadata?.isSummary === true) break;

            // Only process tool messages
            if (msg.role !== 'tool') continue;

            // Skip already pruned messages
            if (msg.compactedAt) continue;

            // Tool message content is always an array after sanitization
            if (!Array.isArray(msg.content)) continue;

            const tokens = this.estimateToolTokens(msg.content);
            totalToolTokens += tokens;

            // If we've exceeded protection threshold, mark for pruning
            if (totalToolTokens > TurnExecutor.PRUNE_PROTECT && msg.id) {
                prunedTokens += tokens;
                toPrune.push(msg.id);
            }
        }

        // Only prune if significant savings
        if (prunedTokens > TurnExecutor.PRUNE_MINIMUM && toPrune.length > 0) {
            const markedCount = await this.contextManager.markMessagesAsCompacted(toPrune);

            this.eventBus.emit('context:pruned', {
                prunedCount: markedCount,
                savedTokens: prunedTokens,
            });

            this.logger.debug(`Pruned ${markedCount} tool outputs, saving ~${prunedTokens} tokens`);

            return { prunedCount: markedCount, savedTokens: prunedTokens };
        }

        return { prunedCount: 0, savedTokens: 0 };
    }

    /**
     * Estimates tokens for tool message content using simple heuristic (length/4).
     * Used for pruning decisions only - actual token counts come from API.
     *
     * Tool message content is always Array<TextPart | ImagePart | FilePart | ResourcePart | UIResourcePart>
     * after sanitization via SanitizedToolResult.
     */
    private estimateToolTokens(
        content: Array<TextPart | ImagePart | FilePart | ResourcePart | UIResourcePart>
    ): number {
        return content.reduce((sum, part) => {
            if (part.type === 'text') {
                return sum + Math.ceil(part.text.length / 4);
            }
            // Images/files contribute ~1000 tokens estimate
            if (part.type === 'image' || part.type === 'file' || part.type === 'resource') {
                return sum + 1000;
            }
            // UIResourcePart - minimal token contribution
            return sum;
        }, 0);
    }

    /**
     * Cleanup resources when execution scope exits.
     * Called automatically by the turn driver on normal exit, throw, or abort.
     */
    private cleanup(): void {
        this.logger.debug('TurnExecutor cleanup triggered');

        // Abort any pending operations for current step
        if (!this.stepAbortController.signal.aborted) {
            this.stepAbortController.abort();
        }

        // Clear any pending queued messages
        void this.steerQueue.clear().catch((error) => {
            this.logger.warn(
                `Failed to clear queued steer messages during cleanup: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        });
    }

    /**
     * Check if context should be compacted based on estimated token count.
     * Uses the threshold percentage from compaction config to trigger earlier (e.g., at 90%).
     *
     * @param estimatedTokens Estimated token count from the current context
     * @returns true if compaction is needed before making the LLM call
     */
    private shouldCompact(estimatedTokens: number): boolean {
        if (!this.modelLimits || !this.compactionStrategy) {
            return false;
        }
        return this.compactionStrategy.shouldCompact(estimatedTokens, this.modelLimits);
    }

    /**
     * Check if context should be compacted based on actual token count from API response.
     * This is a post-response check using real token counts rather than estimates.
     *
     * @param actualTokens Actual input token count from the API response
     * @returns true if compaction is needed
     */
    private shouldCompactFromActual(actualTokens: number): boolean {
        if (!this.modelLimits || !this.compactionStrategy) {
            return false;
        }
        return this.compactionStrategy.shouldCompact(actualTokens, this.modelLimits);
    }

    /**
     * Compact context by generating a summary and adding it to the same session.
     *
     * The summary message is added to the conversation history with `isSummary: true` metadata.
     * When the context is loaded via getFormattedMessagesForLLM(), filterCompacted() will
     * exclude all messages before the summary, effectively compacting the context.
     *
     * @param originalTokens The estimated input token count that triggered overflow
     * @param contributorContext Context for system prompt contributors (needed for accurate token estimation)
     * @param tools Tool definitions (needed for accurate token estimation)
     * @returns true if compaction occurred, false if skipped
     */
    private async compactContext(
        originalTokens: number,
        contributorContext: DynamicContributorContext,
        tools: Record<string, { name?: string; description?: string; parameters?: unknown }>
    ): Promise<boolean> {
        if (!this.compactionStrategy) {
            return false;
        }

        this.logger.info(
            `Context overflow detected (${originalTokens} tokens), checking if compression is possible`
        );

        const history = await this.contextManager.getHistory();
        const { filterCompacted } = await import('../../context/utils.js');
        const originalFiltered = filterCompacted(history);
        const originalMessages = originalFiltered.length;

        // Pre-check if history is long enough for compaction (need at least 4 messages for meaningful summary)
        if (history.length < 4) {
            this.logger.debug('Compaction skipped: history too short to summarize');
            return false;
        }

        // Emit event BEFORE the LLM summarization call so UI shows indicator during compaction
        this.eventBus.emit('context:compacting', {
            estimatedTokens: originalTokens,
        });

        // Generate summary message(s) - this makes an LLM call
        const summaryMessages = await this.compactionStrategy.compact(history, {
            sessionId: this.sessionId,
            model: this.model,
            logger: this.logger,
        });

        if (summaryMessages.length === 0) {
            // Compaction returned empty - nothing to summarize (e.g., already compacted)
            // Still emit context:compacted to clear the UI's compacting state
            this.logger.debug(
                'Compaction skipped: strategy returned no summary (likely already compacted or nothing to summarize)'
            );
            this.eventBus.emit('context:compacted', {
                originalTokens,
                compactedTokens: originalTokens, // No change
                originalMessages,
                compactedMessages: originalMessages, // No change
                strategy: this.compactionStrategy.name,
                reason: 'overflow',
            });
            return false;
        }

        // Add summary to history - filterCompacted() will exclude pre-summary messages at read-time
        for (const summary of summaryMessages) {
            await this.contextManager.addMessage(summary);
        }

        // Reset actual token tracking since context has fundamentally changed
        // The formula (lastInput + lastOutput + newEstimate) is no longer valid after compaction
        this.contextManager.resetActualTokenTracking();

        // Get accurate token estimate after compaction using the same method as /context command
        // This ensures consistency between what we report and what /context shows
        const afterEstimate = await this.contextManager.getContextTokenEstimate(
            contributorContext,
            tools
        );
        const compactedTokens = afterEstimate.estimated;
        const compactedMessages = afterEstimate.stats.filteredMessageCount;

        this.eventBus.emit('context:compacted', {
            originalTokens,
            compactedTokens,
            originalMessages,
            compactedMessages,
            strategy: this.compactionStrategy.name,
            reason: 'overflow',
        });

        this.logger.info(
            `Compaction complete: ${originalTokens} → ~${compactedTokens} tokens ` +
                `(${originalMessages} → ${compactedMessages} messages after filtering)`
        );

        return true;
    }

    /**
     * Set telemetry span attributes for token usage.
     */
    private setTelemetryAttributes(usage: TokenUsage | null): void {
        const activeSpan = trace.getActiveSpan();
        if (!activeSpan || !usage) {
            return;
        }

        if (usage.inputTokens !== undefined) {
            activeSpan.setAttribute('gen_ai.usage.input_tokens', usage.inputTokens);
        }
        if (usage.outputTokens !== undefined) {
            activeSpan.setAttribute('gen_ai.usage.output_tokens', usage.outputTokens);
        }
        if (usage.totalTokens !== undefined) {
            activeSpan.setAttribute('gen_ai.usage.total_tokens', usage.totalTokens);
        }
        if (usage.reasoningTokens !== undefined) {
            activeSpan.setAttribute('gen_ai.usage.reasoning_tokens', usage.reasoningTokens);
        }
    }

    private getContextInputTokens(usage: TokenUsage): number | null {
        if (usage.inputTokens === undefined) return null;
        return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
    }

    /**
     * Map provider errors to DextoRuntimeError.
     */
    private mapProviderError(err: unknown): Error {
        if (APICallError.isInstance?.(err)) {
            const status = err.statusCode;
            const headers = (err.responseHeaders || {}) as Record<string, string>;
            const retryAfter = headers['retry-after'] ? Number(headers['retry-after']) : undefined;
            const body =
                typeof err.responseBody === 'string'
                    ? err.responseBody
                    : JSON.stringify(err.responseBody ?? '');

            if (status === 402) {
                // Dexto gateway returns 402 with INSUFFICIENT_CREDITS when balance is low
                // Try to extract balance from response body
                let balance: number | undefined;
                try {
                    const parsed = JSON.parse(body);
                    // Format: { error: { code: 'INSUFFICIENT_CREDITS', message: '...Balance: $X.XX...' } }
                    const msg = parsed?.error?.message || '';
                    const match = msg.match(/Balance:\s*\$?([\d.]+)/i);
                    if (match) {
                        balance = parseFloat(match[1]);
                    }
                } catch {
                    // Ignore parse errors
                }
                return new DextoRuntimeError(
                    LLMErrorCode.INSUFFICIENT_CREDITS,
                    ErrorScope.LLM,
                    ErrorType.PAYMENT_REQUIRED,
                    `Insufficient Dexto credits${balance !== undefined ? `. Balance: $${balance.toFixed(2)}` : ''}`,
                    {
                        sessionId: this.sessionId,
                        provider: this.llmContext.provider,
                        model: this.llmContext.model,
                        status,
                        balance,
                        body,
                    },
                    'Run `dexto billing` to check your balance'
                );
            }
            if (status === 429) {
                return new DextoRuntimeError(
                    LLMErrorCode.RATE_LIMIT_EXCEEDED,
                    ErrorScope.LLM,
                    ErrorType.RATE_LIMIT,
                    `Rate limit exceeded${body ? ` - ${body}` : ''}`,
                    {
                        sessionId: this.sessionId,
                        provider: this.llmContext.provider,
                        model: this.llmContext.model,
                        status,
                        retryAfter,
                        body,
                    }
                );
            }
            if (status === 408) {
                return new DextoRuntimeError(
                    LLMErrorCode.GENERATION_FAILED,
                    ErrorScope.LLM,
                    ErrorType.TIMEOUT,
                    `Provider timed out${body ? ` - ${body}` : ''}`,
                    {
                        sessionId: this.sessionId,
                        provider: this.llmContext.provider,
                        model: this.llmContext.model,
                        status,
                        body,
                    }
                );
            }
            return new DextoRuntimeError(
                LLMErrorCode.GENERATION_FAILED,
                ErrorScope.LLM,
                ErrorType.THIRD_PARTY,
                `Provider error ${status}${body ? ` - ${body}` : ''}`,
                {
                    sessionId: this.sessionId,
                    provider: this.llmContext.provider,
                    model: this.llmContext.model,
                    status,
                    body,
                }
            );
        }

        return toError(err, this.logger);
    }
}
