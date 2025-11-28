/**
 * TurnExecutor - Main agent execution loop with controlled step execution.
 *
 * According to complete-context-management-plan.md:
 * - TurnExecutor OWNS the streamText call
 * - TurnExecutor creates tools via createTools() with minimal execute + toModelOutput
 * - Uses streamProcessor.process(() => streamText({...}))
 *
 * @see /complete-context-management-plan.md
 */

import {
    streamText,
    type LanguageModel,
    stepCountIs,
    type ToolSet as VercelToolSet,
    jsonSchema,
} from 'ai';
import type { ContextManager } from '../../context/manager.js';
import type { ToolSet } from '../../tools/types.js';
import type { InternalMessage } from '../../context/types.js';
import type { ICompressionStrategy, TurnResult, CoalescedMessage } from './types.js';
import type { ITokenizer } from '../tokenizer/types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import type { SessionEventBus } from '../../events/index.js';
import { eventBus } from '../../events/index.js';
import { StreamProcessor } from './stream-processor.js';
import { pruneOldToolOutputs } from './strategies/tool-output-pruning.js';
import { deferAsync } from '../../utils/defer.js';
import { summarizeToolContentForText } from '../../context/utils.js';

/**
 * Token usage from a single step.
 */
export interface StepUsage {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    totalTokens: number;
}

/**
 * Configuration for TurnExecutor.
 */
export interface TurnExecutorConfig {
    /** Maximum steps per turn (default: 25) */
    maxSteps?: number;

    /** Maximum input tokens before overflow (from model config) */
    maxInputTokens: number;

    /** Compression threshold as percentage of maxInputTokens (default: 0.8) */
    compressionThreshold?: number;

    /** Token threshold for protecting recent tool outputs (default: 40000) */
    pruneProtectTokens?: number;

    /** Session ID for event emission */
    sessionId: string;

    /** Temperature for LLM (optional) */
    temperature?: number;

    /** Max output tokens (optional) */
    maxOutputTokens?: number;
}

/**
 * Dependencies for TurnExecutor.
 */
export interface TurnExecutorDeps {
    /** The Vercel language model */
    model: LanguageModel;

    /** Context manager for message history */
    contextManager: ContextManager<unknown>;

    /** Tool definitions from ToolManager */
    tools: ToolSet;

    /** Function to execute a tool */
    executeTool: (
        toolName: string,
        args: Record<string, unknown>,
        sessionId: string
    ) => Promise<unknown>;

    /** Session event bus for UI events */
    sessionEventBus: SessionEventBus;

    /** Function to check for queued messages */
    dequeueMessages: () => CoalescedMessage | null;

    /** Function to clear queued messages (for cleanup on abort/error) */
    clearMessageQueue?: () => void;

    /** Function to add a coalesced message to history */
    addMessage: (content: CoalescedMessage) => Promise<void>;

    /** Compression strategies to apply */
    compressionStrategies: ICompressionStrategy[];

    /** Tokenizer for token counting */
    tokenizer: ITokenizer;

    /** Logger instance */
    logger: IDextoLogger;

    /** Function to get system prompt */
    getSystemPrompt: () => Promise<string | null>;

    /** Function to get formatted messages */
    getFormattedMessages: () => Promise<InternalMessage[]>;
}

/**
 * TurnExecutor orchestrates the agent execution loop.
 *
 * Key design from plan:
 * - OWNS the streamText call (not delegated)
 * - Creates tools via createTools() with minimal execute + toModelOutput
 * - Uses StreamProcessor.process() for persistence
 */
export class TurnExecutor {
    private readonly config: {
        maxSteps: number;
        maxInputTokens: number;
        compressionThreshold: number;
        pruneProtectTokens: number;
        sessionId: string;
        temperature?: number;
        maxOutputTokens?: number;
    };
    private readonly deps: TurnExecutorDeps;
    private readonly logger: IDextoLogger;
    private readonly streamProcessor: StreamProcessor;
    private abortController: AbortController | null = null;

    constructor(config: TurnExecutorConfig, deps: TurnExecutorDeps) {
        this.config = {
            maxSteps: config.maxSteps ?? 25,
            maxInputTokens: config.maxInputTokens,
            compressionThreshold: config.compressionThreshold ?? 0.8,
            pruneProtectTokens: config.pruneProtectTokens ?? 40000,
            sessionId: config.sessionId,
        };
        if (config.temperature !== undefined) {
            this.config.temperature = config.temperature;
        }
        if (config.maxOutputTokens !== undefined) {
            this.config.maxOutputTokens = config.maxOutputTokens;
        }
        this.deps = deps;
        this.logger = deps.logger.createChild(DextoLogComponent.CONTEXT);

        // Create StreamProcessor with direct ContextManager access
        this.streamProcessor = new StreamProcessor({
            contextManager: deps.contextManager,
            sessionEventBus: deps.sessionEventBus,
            sessionId: config.sessionId,
            logger: deps.logger,
        });
    }

    /**
     * Execute a turn (complete agent response to user input).
     */
    async execute(): Promise<TurnResult> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        // Automatic cleanup using TC39 Explicit Resource Management
        await using _ = deferAsync(async () => {
            this.cleanup();
        });

        let stepCount = 0;
        let lastStepUsage: StepUsage | null = null;
        let lastText = '';
        let lastReasoning: string | undefined;
        let lastFinishReason: TurnResult['finishReason'] = 'stop';
        let compressionTriggered = false;

        // Create tools once (minimal execute + toModelOutput)
        const tools = this.createTools();

        try {
            while (true) {
                // 1. Check for queued messages (mid-loop injection)
                const coalesced = this.deps.dequeueMessages();
                if (coalesced) {
                    this.logger.debug(
                        `TurnExecutor: Injecting ${coalesced.messages.length} queued message(s)`
                    );
                    await this.deps.addMessage(coalesced);
                }

                // 2. Check for overflow and compress if needed
                if (lastStepUsage && this.isOverflow(lastStepUsage)) {
                    this.logger.info(
                        `TurnExecutor: Overflow detected (${lastStepUsage.inputTokens} tokens), compressing`
                    );
                    await this.compress();
                    compressionTriggered = true;
                }

                // 3. Get messages and execute single step via StreamProcessor
                const messages = await this.deps.getFormattedMessages();
                const systemPrompt = await this.deps.getSystemPrompt();

                const result = await this.streamProcessor.process(
                    () =>
                        streamText({
                            model: this.deps.model,
                            messages: this.formatMessagesForVercel(messages, systemPrompt),
                            tools,
                            abortSignal: signal,
                            stopWhen: stepCountIs(1),
                            ...(this.config.temperature !== undefined && {
                                temperature: this.config.temperature,
                            }),
                            ...(this.config.maxOutputTokens !== undefined && {
                                maxTokens: this.config.maxOutputTokens,
                            }),
                        }),
                    signal
                );

                stepCount++;
                lastStepUsage = result.usage;
                lastText = result.text;
                lastReasoning = result.reasoning;
                lastFinishReason = this.mapFinishReason(result.finishReason, result.hasToolCalls);

                this.logger.debug(
                    `TurnExecutor: Step ${stepCount} finished - reason: ${result.finishReason}, ` +
                        `tokens: ${lastStepUsage.inputTokens} in, ${lastStepUsage.outputTokens} out`
                );

                // 4. Check termination conditions
                if (result.finishReason !== 'tool-calls') {
                    break;
                }

                if (signal.aborted) {
                    this.logger.debug('TurnExecutor: Terminating - aborted');
                    lastFinishReason = 'abort';
                    break;
                }

                if (stepCount >= this.config.maxSteps) {
                    this.logger.debug(
                        `TurnExecutor: Terminating - max steps reached (${this.config.maxSteps})`
                    );
                    lastFinishReason = 'max-steps';
                    break;
                }

                // 5. Prune old tool outputs between steps
                await this.pruneToolOutputs();
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                this.logger.debug('TurnExecutor: Execution aborted');
                lastFinishReason = 'abort';
            } else {
                this.logger.error(`TurnExecutor: Error during execution: ${String(error)}`);
                lastFinishReason = 'error';
            }
        }

        const turnResult: TurnResult = {
            text: lastText,
            finishReason: lastFinishReason,
            usage: lastStepUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stepsExecuted: stepCount,
            compressionTriggered,
        };

        if (lastReasoning) {
            turnResult.reasoning = lastReasoning;
        }

        return turnResult;
    }

    /**
     * Abort the current execution.
     */
    abort(): void {
        if (this.abortController) {
            this.logger.debug('TurnExecutor: Abort requested');
            this.abortController.abort();
        }
    }

    /**
     * Create tools with minimal execute callback + toModelOutput.
     *
     * Per the plan:
     * - execute: just runs the tool, returns raw result
     * - toModelOutput: formats result for LLM (sync)
     */
    private createTools(): VercelToolSet {
        const tools = this.deps.tools;

        return Object.keys(tools).reduce<VercelToolSet>((acc, toolName) => {
            const tool = tools[toolName];
            if (!tool) return acc;

            acc[toolName] = {
                inputSchema: jsonSchema(tool.parameters),
                ...(tool.description && { description: tool.description }),

                // MINIMAL execute - just run the tool, return raw result
                execute: async (args: unknown) => {
                    return this.deps.executeTool(
                        toolName,
                        args as Record<string, unknown>,
                        this.config.sessionId
                    );
                },

                // Format for LLM - sync, inline data already present
                toModelOutput: (result: unknown) => {
                    return summarizeToolContentForText(result as string | null);
                },
            };

            return acc;
        }, {});
    }

    /**
     * Format internal messages for Vercel AI SDK.
     */
    private formatMessagesForVercel(
        messages: InternalMessage[],
        systemPrompt: string | null
    ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
        const formatted: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

        if (systemPrompt) {
            formatted.push({ role: 'system', content: systemPrompt });
        }

        for (const msg of messages) {
            if (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant') {
                const content =
                    typeof msg.content === 'string'
                        ? msg.content
                        : Array.isArray(msg.content)
                          ? msg.content
                                .filter(
                                    (p): p is { type: 'text'; text: string } => p.type === 'text'
                                )
                                .map((p) => p.text)
                                .join('\n')
                          : '';
                if (content) {
                    formatted.push({ role: msg.role, content });
                }
            }
        }

        return formatted;
    }

    /**
     * Map stream finish reason to turn finish reason.
     * Only maps when semantically different (tool-calls at max steps = max-steps).
     */
    private mapFinishReason(
        streamReason: 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error',
        hasToolCalls: boolean
    ): TurnResult['finishReason'] {
        // If ended with tool-calls but we're returning, it means max steps
        if (streamReason === 'tool-calls' && hasToolCalls) {
            return 'max-steps';
        }
        // Length and content-filter are errors
        if (streamReason === 'length' || streamReason === 'content-filter') {
            return 'error';
        }
        // Pass through stop and error
        return streamReason as TurnResult['finishReason'];
    }

    /**
     * Clean up resources after execution.
     */
    private cleanup(): void {
        this.logger.debug('TurnExecutor: Cleanup started');

        if (this.deps.clearMessageQueue) {
            this.deps.clearMessageQueue();
            this.logger.debug('TurnExecutor: Message queue cleared');
        }

        this.abortController = null;
        this.logger.debug('TurnExecutor: Cleanup completed');
    }

    /**
     * Check if we're in overflow.
     */
    private isOverflow(usage: StepUsage): boolean {
        const threshold = this.config.maxInputTokens * this.config.compressionThreshold;
        return usage.inputTokens > threshold;
    }

    /**
     * Apply compression strategies sequentially.
     */
    private async compress(): Promise<void> {
        const messages = await this.deps.getFormattedMessages();
        let workingHistory = [...messages];
        const beforeTokens = this.countTokens(workingHistory);

        for (const strategy of this.deps.compressionStrategies) {
            this.logger.debug(`TurnExecutor: Applying compression strategy: ${strategy.name}`);

            try {
                const result = strategy.compress(
                    [...workingHistory],
                    this.deps.tokenizer,
                    this.config.maxInputTokens
                );

                workingHistory = result instanceof Promise ? await result : result;
                const afterTokens = this.countTokens(workingHistory);

                if (strategy.validate && !strategy.validate(beforeTokens, afterTokens)) {
                    this.logger.warn(
                        `TurnExecutor: Strategy ${strategy.name} validation failed ` +
                            `(before: ${beforeTokens}, after: ${afterTokens})`
                    );
                    continue;
                }

                if (afterTokens <= this.config.maxInputTokens * this.config.compressionThreshold) {
                    this.logger.info(
                        `TurnExecutor: Compression successful with ${strategy.name} ` +
                            `(${beforeTokens} -> ${afterTokens} tokens)`
                    );

                    eventBus.emit('context:compressed', {
                        originalTokens: beforeTokens,
                        compressedTokens: afterTokens,
                        originalMessages: messages.length,
                        compressedMessages: workingHistory.length,
                        strategy: strategy.name,
                        reason: 'token_limit',
                        sessionId: this.config.sessionId,
                    });

                    break;
                }
            } catch (error) {
                this.logger.error(
                    `TurnExecutor: Error in compression strategy ${strategy.name}: ${String(error)}`
                );
            }
        }
    }

    /**
     * Prune old tool outputs.
     */
    private async pruneToolOutputs(): Promise<void> {
        const messages = await this.deps.getFormattedMessages();

        pruneOldToolOutputs(
            messages as InternalMessage[],
            this.deps.tokenizer,
            this.config.sessionId,
            this.deps.logger,
            { pruneProtectTokens: this.config.pruneProtectTokens }
        );
    }

    /**
     * Count tokens in message history.
     */
    private countTokens(messages: InternalMessage[]): number {
        let total = 0;
        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                total += this.deps.tokenizer.countTokens(msg.content);
            } else if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'text') {
                        total += this.deps.tokenizer.countTokens(part.text);
                    }
                }
            }
        }
        return total;
    }
}
