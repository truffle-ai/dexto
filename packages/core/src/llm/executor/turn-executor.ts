/**
 * TurnExecutor - Main agent execution loop with controlled step execution.
 *
 * Orchestrates the agent loop using `stopWhen: stepCountIs(1)` to regain control
 * after each LLM step. This enables:
 * - Mid-loop message injection from the queue
 * - Reactive compression based on actual token counts
 * - Tool output pruning between steps
 * - Proper cleanup on abort/error
 *
 * @see /complete-context-management-plan.md
 */

import type { InternalMessage } from '../../context/types.js';
import type { ICompressionStrategy, TurnResult, CoalescedMessage } from './types.js';
import type { ITokenizer } from '../tokenizer/types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import { eventBus } from '../../events/index.js';
import { pruneOldToolOutputs } from './strategies/tool-output-pruning.js';
import { deferAsync } from '../../utils/defer.js';

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
 * Result from executing a single step.
 */
export interface StepResult {
    /** Final text from this step */
    text: string;
    /** Reasoning text if model supports it */
    reasoning?: string;
    /** How this step ended */
    finishReason: 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error';
    /** Token usage for this step */
    usage: StepUsage;
    /** Whether tool calls were made */
    hasToolCalls: boolean;
}

/**
 * Function type for executing a single step.
 * This abstracts away the specific LLM service implementation.
 */
export type StepExecutor = (
    messages: InternalMessage[],
    signal: AbortSignal
) => Promise<StepResult>;

/**
 * Function type for getting formatted messages from context.
 */
export type MessageProvider = () => Promise<InternalMessage[]>;

/**
 * Function type for adding a user message to context.
 */
export type MessageAdder = (content: CoalescedMessage) => Promise<void>;

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
}

/**
 * Dependencies for TurnExecutor.
 */
export interface TurnExecutorDeps {
    /** Function to execute a single LLM step */
    stepExecutor: StepExecutor;

    /** Function to get current message history */
    getMessages: MessageProvider;

    /** Function to add a coalesced message to history */
    addMessage: MessageAdder;

    /** Function to check for queued messages */
    dequeueMessages: () => CoalescedMessage | null;

    /** Function to clear queued messages (for cleanup on abort/error) */
    clearMessageQueue?: () => void;

    /** Compression strategies to apply */
    compressionStrategies: ICompressionStrategy[];

    /** Tokenizer for token counting */
    tokenizer: ITokenizer;

    /** Logger instance */
    logger: IDextoLogger;
}

/**
 * TurnExecutor orchestrates the agent execution loop.
 *
 * Key features:
 * - Controlled step execution with `stopWhen: stepCountIs(1)`
 * - Mid-loop message injection from queue
 * - Reactive compression based on actual tokens
 * - Tool output pruning between steps
 * - Automatic cleanup via defer() pattern
 */
export class TurnExecutor {
    private readonly config: Required<TurnExecutorConfig>;
    private readonly deps: TurnExecutorDeps;
    private readonly logger: IDextoLogger;
    private abortController: AbortController | null = null;

    constructor(config: TurnExecutorConfig, deps: TurnExecutorDeps) {
        this.config = {
            maxSteps: config.maxSteps ?? 25,
            maxInputTokens: config.maxInputTokens,
            compressionThreshold: config.compressionThreshold ?? 0.8,
            pruneProtectTokens: config.pruneProtectTokens ?? 40000,
            sessionId: config.sessionId,
        };
        this.deps = deps;
        this.logger = deps.logger.createChild(DextoLogComponent.CONTEXT);
    }

    /**
     * Execute a turn (complete agent response to user input).
     *
     * This runs the main agent loop:
     * 1. Check for queued messages
     * 2. Check for overflow and compress if needed
     * 3. Execute single step
     * 4. Check termination conditions
     * 5. Prune old tool outputs
     * 6. Repeat until done
     *
     * Uses TC39 Explicit Resource Management (`await using`) for automatic cleanup.
     *
     * @returns Result of the turn execution
     */
    async execute(): Promise<TurnResult> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        // Automatic cleanup using TC39 Explicit Resource Management
        // This ensures full cleanup regardless of how the method exits
        await using _ = deferAsync(async () => {
            this.cleanup();
        });

        let stepCount = 0;
        let lastStepUsage: StepUsage | null = null;
        let lastResult: StepResult | null = null;
        let compressionTriggered = false;

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
                    // Continue to execute step with compressed context
                }

                // 3. Get current messages and execute single step
                const messages = await this.deps.getMessages();
                lastResult = await this.deps.stepExecutor(messages, signal);
                stepCount++;

                // 4. Capture actual tokens for next iteration
                lastStepUsage = lastResult.usage;

                this.logger.debug(
                    `TurnExecutor: Step ${stepCount} finished - reason: ${lastResult.finishReason}, ` +
                        `tokens: ${lastStepUsage.inputTokens} in, ${lastStepUsage.outputTokens} out`
                );

                // 5. Check termination conditions
                if (lastResult.finishReason !== 'tool-calls') {
                    this.logger.debug(
                        `TurnExecutor: Terminating - finish reason: ${lastResult.finishReason}`
                    );
                    break;
                }

                if (signal.aborted) {
                    this.logger.debug('TurnExecutor: Terminating - aborted');
                    break;
                }

                if (stepCount >= this.config.maxSteps) {
                    this.logger.debug(
                        `TurnExecutor: Terminating - max steps reached (${this.config.maxSteps})`
                    );
                    break;
                }

                // 6. Prune old tool outputs between steps
                await this.pruneToolOutputs();
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                this.logger.debug('TurnExecutor: Execution aborted');
                return this.buildResult(lastResult, stepCount, 'abort', compressionTriggered);
            }
            this.logger.error(`TurnExecutor: Error during execution: ${String(error)}`);
            return this.buildResult(lastResult, stepCount, 'error', compressionTriggered);
        }

        return this.buildResult(lastResult, stepCount, undefined, compressionTriggered);
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
     * Clean up resources after execution (called automatically via defer).
     * - Clears the message queue to prevent stale messages
     * - Resets the abort controller
     */
    private cleanup(): void {
        this.logger.debug('TurnExecutor: Cleanup started');

        // Clear any pending queued messages
        if (this.deps.clearMessageQueue) {
            this.deps.clearMessageQueue();
            this.logger.debug('TurnExecutor: Message queue cleared');
        }

        // Reset abort controller
        this.abortController = null;

        this.logger.debug('TurnExecutor: Cleanup completed');
    }

    /**
     * Check if we're in overflow (actual tokens exceed threshold).
     */
    private isOverflow(usage: StepUsage): boolean {
        const threshold = this.config.maxInputTokens * this.config.compressionThreshold;
        return usage.inputTokens > threshold;
    }

    /**
     * Apply compression strategies sequentially.
     */
    private async compress(): Promise<void> {
        const messages = await this.deps.getMessages();
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

                // Handle async strategies
                workingHistory = result instanceof Promise ? await result : result;

                const afterTokens = this.countTokens(workingHistory);

                // Validate if strategy provides validation
                if (strategy.validate && !strategy.validate(beforeTokens, afterTokens)) {
                    this.logger.warn(
                        `TurnExecutor: Strategy ${strategy.name} validation failed ` +
                            `(before: ${beforeTokens}, after: ${afterTokens})`
                    );
                    continue;
                }

                // Check if we're under threshold now
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
     * Prune old tool outputs to free up context space.
     */
    private async pruneToolOutputs(): Promise<void> {
        const messages = await this.deps.getMessages();

        // pruneOldToolOutputs mutates messages in place
        pruneOldToolOutputs(
            messages as InternalMessage[], // Cast needed since getMessages returns readonly
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

    /**
     * Build the final turn result.
     */
    private buildResult(
        lastResult: StepResult | null,
        stepsExecuted: number,
        overrideReason?: 'abort' | 'error',
        compressionTriggered: boolean = false
    ): TurnResult {
        const finishReason = overrideReason ?? this.mapFinishReason(lastResult?.finishReason);

        const result: TurnResult = {
            text: lastResult?.text ?? '',
            finishReason,
            usage: lastResult?.usage ?? {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
            },
            stepsExecuted,
            compressionTriggered,
        };

        // Only include reasoning if present (exactOptionalPropertyTypes)
        if (lastResult?.reasoning) {
            result.reasoning = lastResult.reasoning;
        }

        return result;
    }

    /**
     * Map step finish reason to turn finish reason.
     */
    private mapFinishReason(
        stepReason: StepResult['finishReason'] | undefined
    ): TurnResult['finishReason'] {
        switch (stepReason) {
            case 'stop':
                return 'stop';
            case 'tool-calls':
                return 'max-steps'; // If we ended with tool-calls, we hit max steps
            case 'length':
            case 'content-filter':
            case 'error':
                return 'error';
            default:
                return 'stop';
        }
    }
}
