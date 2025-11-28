/**
 * Vercel AI SDK Adapter for TurnExecutor.
 *
 * Bridges TurnExecutor's step-based execution with Vercel's streamText API.
 * Creates a StepExecutor that:
 * - Wraps streamText with stopWhen: stepCountIs(1)
 * - Handles tool formatting for Vercel SDK
 * - Processes stream events and returns StepResult
 *
 * @see /complete-context-management-plan.md
 */

import {
    streamText,
    LanguageModel,
    stepCountIs,
    type ToolSet as VercelToolSet,
    jsonSchema,
} from 'ai';
import type { InternalMessage } from '../../context/types.js';
import type { ToolSet } from '../../tools/types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import type { StepExecutor, StepResult, StepUsage } from './turn-executor.js';
import type { SessionEventBus } from '../../events/index.js';
import type { VercelMessageFormatter } from '../formatters/vercel.js';
import {
    summarizeToolContentForText,
    expandBlobReferences,
    getImageData,
} from '../../context/utils.js';
import type { ResourceManager } from '../../resources/index.js';
import type { ContextManager } from '../../context/manager.js';
import type { ValidatedLLMConfig } from '../schemas.js';
import type { LLMContext } from '../types.js';
import { shouldIncludeRawToolResult } from '../../utils/debug.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { ToolErrorCode } from '../../tools/error-codes.js';

/**
 * Configuration for creating a Vercel step executor.
 */
export interface VercelAdapterConfig {
    /** The Vercel language model to use */
    model: LanguageModel;
    /** LLM configuration (temperature, maxOutputTokens, etc.) */
    llmConfig: ValidatedLLMConfig;
    /** Tool definitions from ToolManager */
    tools: ToolSet;
    /** Session event bus for emitting events */
    sessionEventBus: SessionEventBus;
    /** Session ID for event context */
    sessionId: string;
    /** Message formatter for converting internal messages */
    formatter: VercelMessageFormatter;
    /** Resource manager for blob expansion */
    resourceManager: ResourceManager;
    /** Context manager for tool result persistence */
    contextManager: ContextManager<unknown>;
    /** Logger instance */
    logger: IDextoLogger;
    /** Tool executor function */
    executeTool: (
        toolName: string,
        args: Record<string, unknown>,
        sessionId: string
    ) => Promise<unknown>;
    /** System prompt to include in messages */
    getSystemPrompt: () => Promise<string | null>;
}

/**
 * Create a StepExecutor that uses Vercel's streamText with stepCountIs(1).
 *
 * This is the bridge between TurnExecutor's controlled loop and Vercel's SDK.
 */
export function createVercelStepExecutor(config: VercelAdapterConfig): StepExecutor {
    const logger = config.logger.createChild(DextoLogComponent.LLM);

    // Format tools for Vercel SDK
    const vercelTools = formatToolsForVercel(config);

    return async function executeStep(
        messages: InternalMessage[],
        signal: AbortSignal
    ): Promise<StepResult> {
        // Get system prompt and create LLM context
        const systemPrompt = await config.getSystemPrompt();
        const llmContext = {
            provider: config.llmConfig.provider,
            model: typeof config.model === 'string' ? config.model : config.model.modelId,
        };

        // Convert internal messages to Vercel format
        const vercelMessages = config.formatter.format(messages, llmContext, systemPrompt);

        // Track step state
        let text = '';
        let reasoning: string | undefined;
        let usage: StepUsage = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
        };
        let finishReason: StepResult['finishReason'] = 'stop';
        let hasToolCalls = false;

        logger.debug(`VercelAdapter: Starting step with ${messages.length} messages`);

        // Execute single step with Vercel SDK
        const response = streamText({
            model: config.model,
            messages: vercelMessages,
            tools: vercelTools,
            abortSignal: signal,
            stopWhen: stepCountIs(1),
            ...(config.llmConfig.temperature !== undefined && {
                temperature: config.llmConfig.temperature,
            }),
            ...(typeof config.llmConfig.maxOutputTokens === 'number' && {
                maxOutputTokens: config.llmConfig.maxOutputTokens,
            }),
            onChunk: (chunk) => {
                if (chunk.chunk.type === 'text-delta') {
                    config.sessionEventBus.emit('llm:chunk', {
                        chunkType: 'text',
                        content: chunk.chunk.text,
                        isComplete: false,
                    });
                } else if (chunk.chunk.type === 'reasoning-delta') {
                    config.sessionEventBus.emit('llm:chunk', {
                        chunkType: 'reasoning',
                        content: chunk.chunk.text,
                        isComplete: false,
                    });
                }
            },
            onStepFinish: async (step) => {
                // Capture step data
                hasToolCalls = (step.toolCalls?.length ?? 0) > 0;

                // Capture actual token usage
                if (step.usage) {
                    usage = {
                        inputTokens: step.usage.inputTokens ?? 0,
                        outputTokens: step.usage.outputTokens ?? 0,
                        totalTokens: step.usage.totalTokens ?? 0,
                    };
                    if (step.usage.reasoningTokens !== undefined) {
                        usage.reasoningTokens = step.usage.reasoningTokens;
                    }
                }

                logger.debug(
                    `VercelAdapter: Step finished - hasToolCalls: ${hasToolCalls}, ` +
                        `tokens: ${usage.inputTokens} in, ${usage.outputTokens} out`
                );

                // Add assistant message to context if tools were called
                if (hasToolCalls && step.toolCalls) {
                    const toolCalls = step.toolCalls.map((tc) => ({
                        id: tc.toolCallId,
                        type: 'function' as const,
                        function: {
                            name: tc.toolName,
                            arguments:
                                typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input),
                        },
                    }));
                    await config.contextManager.addAssistantMessage(step.text || null, toolCalls);
                }
            },
        });

        // Await the stream completion
        try {
            [text, reasoning] = await Promise.all([response.text, response.reasoningText]);

            // Map finish reason
            const responseFinishReason = await response.finishReason;
            finishReason = mapFinishReason(responseFinishReason);
        } catch (error) {
            logger.error(`VercelAdapter: Error during step: ${String(error)}`);
            finishReason = 'error';
        }

        // Emit final response
        config.sessionEventBus.emit('llm:response', {
            content: text,
            ...(reasoning && { reasoning }),
            provider: config.llmConfig.provider,
            model: typeof config.model === 'string' ? config.model : config.model.modelId,
            router: 'vercel',
            tokenUsage: {
                ...(usage.inputTokens && { inputTokens: usage.inputTokens }),
                ...(usage.outputTokens && { outputTokens: usage.outputTokens }),
                ...(usage.reasoningTokens && { reasoningTokens: usage.reasoningTokens }),
                ...(usage.totalTokens && { totalTokens: usage.totalTokens }),
            },
        });

        const result: StepResult = {
            text,
            finishReason,
            usage,
            hasToolCalls,
        };

        if (reasoning) {
            result.reasoning = reasoning;
        }

        return result;
    };
}

/**
 * Format tools for Vercel AI SDK.
 *
 * Creates tool definitions with execute callbacks that:
 * - Run the tool via ToolManager
 * - Persist results via ContextManager
 * - Emit events for UI
 * - Return properly formatted content for LLM
 */
function formatToolsForVercel(config: VercelAdapterConfig): VercelToolSet {
    const logger = config.logger.createChild(DextoLogComponent.LLM);

    return Object.keys(config.tools).reduce<VercelToolSet>((acc, toolName) => {
        const tool = config.tools[toolName];
        if (!tool) return acc;

        acc[toolName] = {
            inputSchema: jsonSchema(tool.parameters),
            execute: async (args: unknown, options: { toolCallId: string }) => {
                const callId = options.toolCallId;

                try {
                    // Emit toolCall event FIRST before execution
                    logger.debug(
                        `[vercel-adapter] Emitting toolCall event for ${toolName} with callId ${callId}`
                    );
                    config.sessionEventBus.emit('llm:tool-call', {
                        toolName,
                        args: args as Record<string, unknown>,
                        callId,
                    });

                    const rawResult = await config.executeTool(
                        toolName,
                        args as Record<string, unknown>,
                        config.sessionId
                    );

                    // Persist result and emit event
                    const persisted = await config.contextManager.addToolResult(
                        callId,
                        toolName,
                        rawResult,
                        { success: true }
                    );

                    logger.debug(
                        `[vercel-adapter] Emitting toolResult event for ${toolName} with callId ${callId}`
                    );
                    config.sessionEventBus.emit('llm:tool-result', {
                        toolName,
                        callId,
                        success: true,
                        sanitized: persisted,
                        ...(shouldIncludeRawToolResult() ? { rawResult } : {}),
                    });

                    // Expand blob references to actual base64 data before sending to LLM
                    const expandedContent = await expandBlobReferences(
                        persisted.content,
                        config.resourceManager,
                        logger
                    );

                    // Convert sanitized content to Vercel AI SDK multimodal format
                    const contentValue: Array<
                        | { type: 'text'; text: string }
                        | { type: 'media'; data: string; mediaType: string }
                    > = [];

                    const contentArray = Array.isArray(expandedContent)
                        ? expandedContent
                        : [{ type: 'text' as const, text: String(expandedContent) }];

                    for (const part of contentArray) {
                        if (part.type === 'text') {
                            contentValue.push({ type: 'text', text: part.text });
                        } else if (part.type === 'image') {
                            const imageData = getImageData(part, logger);
                            if (imageData) {
                                contentValue.push({
                                    type: 'media',
                                    data: imageData,
                                    mediaType: part.mimeType || 'image/jpeg',
                                });
                            }
                        } else if (part.type === 'file') {
                            const fileData =
                                typeof part.data === 'string'
                                    ? part.data
                                    : Buffer.from(part.data as ArrayBuffer).toString('base64');
                            contentValue.push({
                                type: 'media',
                                data: fileData,
                                mediaType: part.mimeType || 'application/octet-stream',
                            });
                        }
                    }

                    // If we have multimodal content, return it in the proper format
                    if (contentValue.length > 0 && contentValue.some((v) => v.type === 'media')) {
                        return { type: 'content' as const, value: contentValue };
                    }

                    // Fallback to text summary if no media content
                    return summarizeToolContentForText(persisted.content);
                } catch (err: unknown) {
                    // Handle tool execution errors
                    let errorResult: { error: string; denied?: boolean; timeout?: boolean };
                    let errorFlags = '';

                    if (
                        err instanceof DextoRuntimeError &&
                        err.code === ToolErrorCode.EXECUTION_DENIED
                    ) {
                        errorResult = { error: err.message, denied: true };
                        errorFlags = ' (denied)';
                    } else if (
                        err instanceof DextoRuntimeError &&
                        err.code === ToolErrorCode.CONFIRMATION_TIMEOUT
                    ) {
                        errorResult = { error: err.message, denied: true, timeout: true };
                        errorFlags = ' (timeout)';
                    } else {
                        const message = err instanceof Error ? err.message : String(err);
                        errorResult = { error: message };
                    }

                    // Persist error result and emit event
                    try {
                        const persisted = await config.contextManager.addToolResult(
                            callId,
                            toolName,
                            errorResult,
                            { success: false }
                        );

                        config.sessionEventBus.emit('llm:tool-result', {
                            toolName,
                            callId,
                            success: false,
                            sanitized: persisted,
                            ...(shouldIncludeRawToolResult() ? { rawResult: errorResult } : {}),
                        });
                    } catch (persistErr) {
                        logger.error(
                            `Failed to persist error result for ${toolName}: ${String(persistErr)}`
                        );
                    }

                    return `Tool ${toolName} failed${errorFlags}: ${errorResult.error}`;
                }
            },
            ...(tool.description && { description: tool.description }),
        };

        return acc;
    }, {});
}

/**
 * Map Vercel finish reason to TurnExecutor finish reason.
 */
function mapFinishReason(
    vercelReason:
        | 'stop'
        | 'length'
        | 'content-filter'
        | 'tool-calls'
        | 'error'
        | 'other'
        | 'unknown'
        | undefined
): StepResult['finishReason'] {
    switch (vercelReason) {
        case 'stop':
            return 'stop';
        case 'tool-calls':
            return 'tool-calls';
        case 'length':
            return 'length';
        case 'content-filter':
            return 'content-filter';
        case 'error':
            return 'error';
        default:
            return 'stop';
    }
}

/**
 * Create all TurnExecutor dependencies from vercel.ts context.
 *
 * This is the main factory function that bridges VercelLLMService with TurnExecutor.
 */
export interface CreateTurnExecutorDepsOptions {
    model: LanguageModel;
    llmConfig: ValidatedLLMConfig;
    tools: ToolSet;
    sessionEventBus: SessionEventBus;
    sessionId: string;
    formatter: VercelMessageFormatter;
    resourceManager: ResourceManager;
    contextManager: ContextManager<unknown>;
    logger: IDextoLogger;
    executeTool: (
        toolName: string,
        args: Record<string, unknown>,
        sessionId: string
    ) => Promise<unknown>;
    getSystemPrompt: () => Promise<string | null>;
}
