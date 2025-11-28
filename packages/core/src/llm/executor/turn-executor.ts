import {
    LanguageModel,
    streamText,
    stepCountIs,
    ToolSet as VercelToolSet,
    jsonSchema,
    type ModelMessage,
} from 'ai';
import { ContextManager } from '../../context/manager.js';
import type { TextPart, ImagePart, FilePart, UIResourcePart } from '../../context/types.js';
import { ToolManager } from '../../tools/tool-manager.js';
import { ToolSet } from '../../tools/types.js';
import { StreamProcessor } from './stream-processor.js';
import { ExecutorResult } from './types.js';
import { TokenUsage } from '../types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import type { SessionEventBus } from '../../events/index.js';
import type { ResourceManager } from '../../resources/index.js';
import { DynamicContributorContext } from '../../systemPrompt/types.js';
import { LLMContext } from '../types.js';

/**
 * TurnExecutor orchestrates the agent loop using `stopWhen: stepCountIs(1)`.
 *
 * This is the main entry point that replaces Vercel's internal loop with our
 * controlled execution, giving us control between steps for:
 * - Message queue injection (Phase 6)
 * - Compression decisions (Phase 4)
 * - Pruning old tool outputs (Phase 5)
 *
 * Key design: Uses stopWhen: stepCountIs(1) to regain control after each step.
 * A "step" = ONE LLM call + ALL tool executions from that call.
 */
export class TurnExecutor {
    private logger: IDextoLogger;
    private abortController: AbortController;

    constructor(
        private model: LanguageModel,
        private toolManager: ToolManager,
        private contextManager: ContextManager<ModelMessage>,
        private eventBus: SessionEventBus,
        private resourceManager: ResourceManager,
        private sessionId: string,
        private config: {
            maxSteps: number;
            maxOutputTokens?: number;
            temperature?: number;
        },
        private llmContext: LLMContext,
        logger: IDextoLogger
    ) {
        this.logger = logger.createChild(DextoLogComponent.EXECUTOR);
        this.abortController = new AbortController();
    }

    /**
     * Main agent execution loop.
     * Uses stopWhen: stepCountIs(1) to regain control after each step.
     */
    async execute(contributorContext: DynamicContributorContext): Promise<ExecutorResult> {
        // TODO Phase 7: Add defer() for automatic cleanup
        // using _ = defer(() => this.cleanup());

        let stepCount = 0;
        let lastStepTokens: TokenUsage | null = null;
        let lastFinishReason = 'unknown';

        this.eventBus.emit('llm:thinking');

        try {
            while (true) {
                // 1. Check for queued messages (mid-loop injection)
                // TODO Phase 6: Implement message queue
                // const coalesced = this.messageQueue.dequeueAll();
                // if (coalesced) {
                //     await this.contextManager.addUserMessage(coalesced.content);
                // }

                // 2. Check for compression need (reactive, based on actual tokens)
                // TODO Phase 4: Implement compression
                // if (lastStepTokens && this.isOverflow(lastStepTokens)) {
                //     await this.compress();
                //     continue;  // Start fresh iteration after compression
                // }

                // 3. Get formatted messages for this step
                const prepared = await this.contextManager.getFormattedMessagesWithCompression(
                    contributorContext,
                    this.llmContext
                );

                this.logger.debug(
                    `Step ${stepCount}: Starting with ${prepared.tokensUsed} estimated tokens`
                );

                // 4. Create tools with execute callbacks and toModelOutput
                const tools = await this.createTools();

                // 5. Execute single step with stream processing
                const streamProcessor = new StreamProcessor(
                    this.contextManager,
                    this.eventBus,
                    this.resourceManager,
                    this.abortController.signal,
                    this.logger
                );

                const result = await streamProcessor.process(() =>
                    streamText({
                        model: this.model,
                        stopWhen: stepCountIs(1),
                        tools,
                        abortSignal: this.abortController.signal,
                        messages: prepared.formattedMessages,
                        ...(this.config.maxOutputTokens !== undefined && {
                            maxOutputTokens: this.config.maxOutputTokens,
                        }),
                        ...(this.config.temperature !== undefined && {
                            temperature: this.config.temperature,
                        }),
                    })
                );

                // 6. Capture actual tokens for next iteration's overflow check
                lastStepTokens = result.usage;
                lastFinishReason = result.finishReason;

                this.logger.debug(
                    `Step ${stepCount}: Finished with reason="${result.finishReason}", ` +
                        `tokens=${JSON.stringify(result.usage)}`
                );

                // 7. Check termination conditions
                if (result.finishReason !== 'tool-calls') {
                    this.logger.debug(`Terminating: finishReason is "${result.finishReason}"`);
                    break;
                }
                if (this.abortController.signal.aborted) {
                    this.logger.debug('Terminating: abort signal received');
                    break;
                }
                if (++stepCount >= this.config.maxSteps) {
                    this.logger.debug(`Terminating: reached maxSteps (${this.config.maxSteps})`);
                    break;
                }

                // 8. Prune old tool outputs (mark with compactedAt)
                await this.pruneOldToolOutputs();
            }
        } catch (error) {
            this.logger.error('TurnExecutor failed', { error });
            throw error;
        }

        return {
            stepCount,
            usage: lastStepTokens,
            finishReason: lastFinishReason,
        };
    }

    /**
     * Abort the current execution.
     */
    abort(): void {
        this.abortController.abort();
    }

    /**
     * Creates tools with execute callbacks and toModelOutput.
     *
     * Key design decisions:
     * - execute() returns raw result with inline images (async)
     * - toModelOutput() formats for LLM consumption (sync)
     * - StreamProcessor handles persistence via tool-result events
     */
    private async createTools(): Promise<VercelToolSet> {
        const tools: ToolSet = await this.toolManager.getAllTools();

        return Object.fromEntries(
            Object.entries(tools).map(([name, tool]) => [
                name,
                {
                    inputSchema: jsonSchema(tool.parameters),
                    ...(tool.description && { description: tool.description }),

                    /**
                     * Execute callback - runs the tool and returns raw result.
                     * Does NOT persist - StreamProcessor handles that on tool-result event.
                     */
                    execute: async (
                        args: unknown,
                        _options: { toolCallId: string }
                    ): Promise<unknown> => {
                        this.logger.debug(`Executing tool: ${name}`);

                        // Run tool via toolManager - returns raw result with inline images
                        const rawResult = await this.toolManager.executeTool(
                            name,
                            args as Record<string, unknown>,
                            this.sessionId
                        );

                        return rawResult;
                    },

                    /**
                     * toModelOutput - formats raw result for LLM consumption.
                     * Called by Vercel SDK when preparing messages for next LLM call.
                     * SYNC - images are already inline in the raw result.
                     */
                    toModelOutput: (result: unknown) => {
                        return this.formatToolResultForLLM(result, name);
                    },
                },
            ])
        );
    }

    /**
     * Format tool result for LLM consumption.
     * Handles multimodal content (text + images).
     *
     * This handles RAW tool results - the structure may vary.
     */
    private formatToolResultForLLM(
        result: unknown,
        toolName: string
    ):
        | { type: 'text'; value: string }
        | {
              type: 'content';
              value: Array<
                  | { type: 'text'; text: string }
                  | { type: 'media'; data: string; mediaType: string }
              >;
          } {
        // Handle error results
        if (result && typeof result === 'object' && 'error' in result) {
            const errorResult = result as { error: string; denied?: boolean; timeout?: boolean };
            let errorFlags = '';
            if (errorResult.denied) errorFlags += ' (denied)';
            if (errorResult.timeout) errorFlags += ' (timeout)';
            return {
                type: 'text',
                value: `Tool ${toolName} failed${errorFlags}: ${errorResult.error}`,
            };
        }

        // Handle multimodal results with content array
        if (this.hasMultimodalContent(result)) {
            const contentArray = (
                result as { content: Array<{ type: string; [key: string]: unknown }> }
            ).content;
            const contentValue: Array<
                { type: 'text'; text: string } | { type: 'media'; data: string; mediaType: string }
            > = [];

            for (const part of contentArray) {
                if (part.type === 'text' && typeof part.text === 'string') {
                    contentValue.push({ type: 'text', text: part.text });
                } else if (part.type === 'image') {
                    // Handle various image formats - check both 'image' and 'data' fields
                    const imageData = this.extractImageData(part);
                    if (imageData) {
                        contentValue.push({
                            type: 'media',
                            data: imageData,
                            mediaType: (part.mimeType as string) || 'image/jpeg',
                        });
                    }
                } else if (part.type === 'file') {
                    const fileData = this.extractFileData(part);
                    if (fileData) {
                        contentValue.push({
                            type: 'media',
                            data: fileData,
                            mediaType: (part.mimeType as string) || 'application/octet-stream',
                        });
                    }
                }
            }

            // If we have multimodal content (media), return it
            if (contentValue.length > 0 && contentValue.some((v) => v.type === 'media')) {
                return { type: 'content', value: contentValue };
            }

            // Text-only content array - concatenate text parts
            const textParts = contentArray
                .filter((p) => p.type === 'text' && typeof p.text === 'string')
                .map((p) => p.text as string);
            return {
                type: 'text',
                value: textParts.join('\n') || '[empty result]',
            };
        }

        // Fallback: convert to string
        if (typeof result === 'string') {
            return { type: 'text', value: result };
        }

        return {
            type: 'text',
            value:
                typeof result === 'object' && result !== null
                    ? JSON.stringify(result)
                    : String(result),
        };
    }

    /**
     * Extract image data from a part, handling various formats.
     */
    private extractImageData(part: { [key: string]: unknown }): string | null {
        // Try 'image' field first (our standard ImagePart format)
        if (typeof part.image === 'string') {
            return part.image;
        }
        // Try 'data' field (alternative format)
        if (typeof part.data === 'string') {
            return part.data;
        }
        // Handle Buffer/ArrayBuffer
        if (part.image instanceof Buffer) {
            return part.image.toString('base64');
        }
        if (part.data instanceof Buffer) {
            return (part.data as Buffer).toString('base64');
        }
        if (part.image instanceof ArrayBuffer) {
            return Buffer.from(new Uint8Array(part.image)).toString('base64');
        }
        if (part.data instanceof ArrayBuffer) {
            return Buffer.from(new Uint8Array(part.data as ArrayBuffer)).toString('base64');
        }
        return null;
    }

    /**
     * Extract file data from a part.
     */
    private extractFileData(part: { [key: string]: unknown }): string | null {
        if (typeof part.data === 'string') {
            return part.data;
        }
        if (part.data instanceof Buffer) {
            return (part.data as Buffer).toString('base64');
        }
        if (part.data instanceof ArrayBuffer) {
            return Buffer.from(new Uint8Array(part.data as ArrayBuffer)).toString('base64');
        }
        return null;
    }

    /**
     * Check if result has multimodal content array
     */
    private hasMultimodalContent(result: unknown): boolean {
        return (
            result !== null &&
            typeof result === 'object' &&
            'content' in result &&
            Array.isArray((result as { content: unknown }).content)
        );
    }

    // TODO Phase 4: Implement overflow detection
    // private isOverflow(tokens: TokenUsage): boolean {
    //     const contextLimit = this.modelLimits.contextWindow;
    //     const outputBuffer = Math.min(this.modelLimits.maxOutput, OUTPUT_TOKEN_MAX);
    //     const usable = contextLimit - outputBuffer;
    //     const used = tokens.inputTokens + (tokens.cacheReadTokens ?? 0);
    //     return used > usable;
    // }

    // TODO Phase 4: Implement compression
    // private async compress(): Promise<void> {
    //     // Use compression strategy to compress history
    // }

    /**
     * Constants for pruning thresholds
     */
    private static readonly PRUNE_PROTECT = 40_000; // Keep last 40K tokens of tool outputs
    private static readonly PRUNE_MINIMUM = 20_000; // Only prune if we can save 20K+

    /**
     * Prunes old tool outputs by marking them with compactedAt timestamp.
     * Does NOT modify content - transformation happens at format time in
     * ContextManager.getFormattedMessagesWithCompression().
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
     * Tool message content is always Array<TextPart | ImagePart | FilePart | UIResourcePart>
     * after sanitization via SanitizedToolResult.
     */
    private estimateToolTokens(
        content: Array<TextPart | ImagePart | FilePart | UIResourcePart>
    ): number {
        return content.reduce((sum, part) => {
            if (part.type === 'text') {
                return sum + Math.ceil(part.text.length / 4);
            }
            // Images/files contribute ~1000 tokens estimate
            if (part.type === 'image' || part.type === 'file') {
                return sum + 1000;
            }
            // UIResourcePart - minimal token contribution
            return sum;
        }, 0);
    }

    // TODO Phase 7: Implement cleanup with defer()
    // private cleanup(): void {
    //     this.abortController.abort();
    //     // Clear message queue, cleanup resources
    // }
}
