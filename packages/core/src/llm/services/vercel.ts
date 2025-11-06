import {
    generateText,
    LanguageModel,
    streamText,
    type ModelMessage,
    APICallError,
    stepCountIs,
} from 'ai';
import { ToolManager } from '../../tools/tool-manager.js';
import { ILLMService, LLMServiceConfig } from './types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import { ToolSet } from '../../tools/types.js';
import { ToolSet as VercelToolSet, jsonSchema } from 'ai';
import { ContextManager } from '../../context/manager.js';
import { summarizeToolContentForText } from '../../context/utils.js';
import { shouldIncludeRawToolResult } from '../../utils/debug.js';
import { getMaxInputTokensForModel, getEffectiveMaxInputTokens } from '../registry.js';
import { ImageData, FileData } from '../../context/types.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { LLMErrorCode } from '../error-codes.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import type { SessionEventBus } from '../../events/index.js';
import { toError } from '../../utils/error-conversion.js';
import { ToolErrorCode } from '../../tools/error-codes.js';
import type { IConversationHistoryProvider } from '../../session/history/types.js';
import type { SystemPromptManager } from '../../systemPrompt/manager.js';
import { VercelMessageFormatter } from '../formatters/vercel.js';
import { createTokenizer } from '../tokenizer/factory.js';
import type { ValidatedLLMConfig } from '../schemas.js';
import { InstrumentClass } from '../../telemetry/decorators.js';
import { trace } from '@opentelemetry/api';

/**
 * Vercel AI SDK implementation of LLMService
 * TODO: improve token counting logic across all LLM services - approximation isn't matching vercel actual token count properly
 * TODO (Telemetry): Add OpenTelemetry metrics collection
 *   - LLM call counters (by provider/model)
 *   - Token usage histograms (input/output/total/reasoning)
 *   - Request latency histograms
 *   - Error rate counters
 *   See feature-plans/telemetry.md for details
 */
@InstrumentClass({
    prefix: 'llm.vercel',
    excludeMethods: ['getModelId', 'getAllTools', 'formatTools', 'validateToolSupport'],
})
export class VercelLLMService implements ILLMService {
    private model: LanguageModel;
    private config: ValidatedLLMConfig;
    private toolManager: ToolManager;
    private contextManager: ContextManager<ModelMessage>;
    private sessionEventBus: SessionEventBus;
    private readonly sessionId: string;
    private toolSupportCache: Map<string, boolean> = new Map();
    private logger: IDextoLogger;

    /**
     * Helper to extract model ID from LanguageModel union type (string | LanguageModelV2)
     */
    private getModelId(): string {
        return typeof this.model === 'string' ? this.model : this.model.modelId;
    }

    constructor(
        toolManager: ToolManager,
        model: LanguageModel,
        systemPromptManager: SystemPromptManager,
        historyProvider: IConversationHistoryProvider,
        sessionEventBus: SessionEventBus,
        config: ValidatedLLMConfig,
        sessionId: string,
        resourceManager: import('../../resources/index.js').ResourceManager,
        logger: IDextoLogger
    ) {
        this.logger = logger.createChild(DextoLogComponent.LLM);
        this.model = model;
        this.config = config;
        this.toolManager = toolManager;
        this.sessionEventBus = sessionEventBus;
        this.sessionId = sessionId;

        // Create properly-typed ContextManager for Vercel
        const formatter = new VercelMessageFormatter(this.logger);
        const tokenizer = createTokenizer(config.provider, this.getModelId(), this.logger);
        const maxInputTokens = getEffectiveMaxInputTokens(config, this.logger);

        // Use the provided ResourceManager

        this.contextManager = new ContextManager<ModelMessage>(
            config,
            formatter,
            systemPromptManager,
            maxInputTokens,
            tokenizer,
            historyProvider,
            sessionId,
            resourceManager,
            this.logger
            // compressionStrategies uses default
        );

        this.logger.debug(
            `[VercelLLMService] Initialized for model: ${this.getModelId()}, provider: ${this.config.provider}, temperature: ${this.config.temperature}, maxOutputTokens: ${this.config.maxOutputTokens}`
        );
    }

    getAllTools(): Promise<ToolSet> {
        return this.toolManager.getAllTools();
    }

    formatTools(tools: ToolSet): VercelToolSet {
        this.logger.debug(`Formatting tools for vercel`);
        return Object.keys(tools).reduce<VercelToolSet>((acc, toolName) => {
            const tool = tools[toolName];
            if (tool) {
                acc[toolName] = {
                    inputSchema: jsonSchema(tool.parameters),
                    execute: async (args: unknown, options: { toolCallId: string }) => {
                        const callId = options.toolCallId;

                        try {
                            // Emit toolCall event FIRST before execution
                            this.logger.debug(
                                `[vercel] Emitting toolCall event for ${toolName} with callId ${callId}`
                            );
                            this.sessionEventBus.emit('llmservice:toolCall', {
                                toolName,
                                args: args as Record<string, unknown>,
                                callId,
                            });

                            const rawResult = await this.toolManager.executeTool(
                                toolName,
                                args as Record<string, unknown>,
                                this.sessionId
                            );

                            // Persist result and emit event immediately after tool execution
                            // This sanitizes the result, persists blobs to storage, and returns sanitized parts
                            const persisted = await this.contextManager.addToolResult(
                                callId,
                                toolName,
                                rawResult,
                                { success: true }
                            );

                            this.logger.debug(
                                `[vercel] Emitting toolResult event for ${toolName} with callId ${callId}`
                            );
                            this.sessionEventBus.emit('llmservice:toolResult', {
                                toolName,
                                callId,
                                success: true,
                                sanitized: persisted,
                                ...(shouldIncludeRawToolResult() ? { rawResult } : {}),
                            });

                            // Generate summary text from the already-sanitized content
                            // (avoids redundant normalization since addToolResult already did it)
                            const summaryText = summarizeToolContentForText(persisted.content);
                            return summaryText;
                        } catch (err: unknown) {
                            // Handle tool execution errors
                            // Note: toolCall event was already emitted before execution
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

                            // Persist error result and emit event immediately
                            try {
                                const persisted = await this.contextManager.addToolResult(
                                    callId,
                                    toolName,
                                    errorResult,
                                    { success: false }
                                );

                                this.sessionEventBus.emit('llmservice:toolResult', {
                                    toolName,
                                    callId,
                                    success: false,
                                    sanitized: persisted,
                                    ...(shouldIncludeRawToolResult()
                                        ? { rawResult: errorResult }
                                        : {}),
                                });
                            } catch (persistErr) {
                                this.logger.error(
                                    `Failed to persist error result for ${toolName}: ${String(persistErr)}`
                                );
                            }

                            // Return a concise error string for consistency with success path
                            return `Tool ${toolName} failed${errorFlags}: ${errorResult.error}`;
                        }
                    },
                    ...(tool.description && { description: tool.description }),
                };
            }
            return acc;
        }, {});
    }

    private async validateToolSupport(): Promise<boolean> {
        const modelKey = `${this.config.provider}:${this.getModelId()}:${this.config.baseURL ?? ''}`;

        // Check cache first
        if (this.toolSupportCache.has(modelKey)) {
            return this.toolSupportCache.get(modelKey)!;
        }

        // Only test tool support for providers using custom baseURL endpoints
        // Built-in providers without baseURL have known tool support
        if (!this.config.baseURL) {
            this.logger.debug(`Skipping tool validation for ${modelKey} - no custom baseURL`);
            // Assume built-in providers support tools
            this.toolSupportCache.set(modelKey, true);
            return true;
        }

        this.logger.debug(`Testing tool support for custom endpoint model: ${modelKey}`);

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

        try {
            // Make a minimal generateText call with tools to test support
            await generateText({
                model: this.model,
                messages: [{ role: 'user', content: 'Hello' }],
                tools: testTool,
                stopWhen: stepCountIs(1),
            });

            // If we get here, tools are supported
            this.toolSupportCache.set(modelKey, true);
            this.logger.debug(`Model ${modelKey} supports tools`);
            return true;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('does not support tools')) {
                this.toolSupportCache.set(modelKey, false);
                this.logger.debug(`Model ${modelKey} does not support tools`);
                return false;
            }
            // Other errors - assume tools are supported and let the actual call handle it
            this.logger.debug(
                `Tool validation error for ${modelKey}, assuming supported: ${errorMessage}`
            );
            this.toolSupportCache.set(modelKey, true);
            return true;
        }
    }

    async completeTask(
        textInput: string,
        options: { signal?: AbortSignal },
        imageData?: ImageData,
        fileData?: FileData,
        stream?: boolean
    ): Promise<string> {
        // Add user message, with optional image and file data
        this.logger.debug(
            `[VercelLLMService] addUserMessage(text ~${textInput.length} chars, image=${Boolean(
                imageData
            )}, file=${Boolean(fileData)})`
        );
        await this.contextManager.addUserMessage(textInput, imageData, fileData);

        // Get all tools
        const tools = await this.toolManager.getAllTools();
        this.logger.silly(
            `[VercelLLMService] Tools before formatting: ${JSON.stringify(tools, null, 2)}`
        );

        const formattedTools = this.formatTools(tools);

        this.logger.silly(
            `[VercelLLMService] Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`
        );

        let fullResponse = '';

        this.sessionEventBus.emit('llmservice:thinking');
        const prepared = await this.contextManager.getFormattedMessagesWithCompression(
            { mcpManager: this.toolManager.getMcpManager() },
            { provider: this.config.provider, model: this.getModelId() }
        );
        const formattedMessages: ModelMessage[] = prepared.formattedMessages as ModelMessage[];
        const tokensUsed: number = prepared.tokensUsed;

        this.logger.silly(
            `Messages (potentially compressed): ${JSON.stringify(formattedMessages, null, 2)}`
        );
        this.logger.silly(`Tools: ${JSON.stringify(formattedTools, null, 2)}`);
        this.logger.debug(`Estimated tokens being sent to Vercel provider: ${tokensUsed}`);

        // Both methods now return strings and handle message processing internally
        if (stream) {
            fullResponse = await this.streamText(
                formattedMessages,
                formattedTools,
                this.config.maxIterations,
                options?.signal
            );
        } else {
            fullResponse = await this.generateText(
                formattedMessages,
                formattedTools,
                this.config.maxIterations,
                options?.signal
            );
        }

        // If the run was cancelled, don't emit the "max steps" fallback.
        if (options?.signal?.aborted) {
            return fullResponse; // likely '', which upstream can treat as "no content"
        }
        return (
            fullResponse ||
            `Reached maximum number of steps (${this.config.maxIterations}) without a final response.`
        );
    }

    async generateText(
        messages: ModelMessage[],
        tools: VercelToolSet,
        maxSteps: number = 50,
        signal?: AbortSignal
    ): Promise<string> {
        let stepIteration = 0;

        const estimatedTokens = Math.ceil(JSON.stringify(messages, null, 2).length / 4);
        this.logger.debug(
            `vercel generateText:Generating text with messages (${estimatedTokens} estimated tokens)`
        );

        const temperature = this.config.temperature;
        const maxOutputTokens = this.config.maxOutputTokens;

        // Check if model supports tools and adjust accordingly
        const supportsTools = await this.validateToolSupport();
        const effectiveTools = supportsTools ? tools : {};

        if (!supportsTools && Object.keys(tools).length > 0) {
            this.logger.debug(
                `Model ${this.getModelId()} does not support tools, using empty tools object for generation`
            );
        }

        try {
            const includeMaxOutputTokens = typeof maxOutputTokens === 'number';
            const response = await generateText({
                model: this.model,
                messages,
                tools: effectiveTools,
                ...(signal ? { abortSignal: signal } : {}),
                onStepFinish: async (step) => {
                    this.logger.debug(`Step iteration: ${stepIteration}`);
                    stepIteration++;
                    this.logger.debug(`Step finished, text: ${step.text}`);
                    this.logger.debug(
                        `Step finished, step tool calls: ${JSON.stringify(step.toolCalls, null, 2)}`
                    );
                    this.logger.debug(
                        `Step finished, step tool results: ${JSON.stringify(step.toolResults, null, 2)}`
                    );

                    // Do not emit intermediate llmservice:response; generateText is non-stream so we only emit once after completion.
                    // toolCall and toolResult events are now emitted immediately in execute() function
                    // Clean up any remaining raw results from the queue
                },
                stopWhen: stepCountIs(maxSteps),
                ...(includeMaxOutputTokens ? { maxOutputTokens: maxOutputTokens as number } : {}),
                ...(temperature !== undefined && { temperature }),
            });
            // Emit final response with reasoning and token usage (authoritative)
            this.sessionEventBus.emit('llmservice:response', {
                content: response.text,
                ...(response.reasoningText && { reasoning: response.reasoningText }),
                provider: this.config.provider,
                model: this.getModelId(),
                router: 'vercel',
                tokenUsage: {
                    ...(response.totalUsage.inputTokens !== undefined && {
                        inputTokens: response.totalUsage.inputTokens,
                    }),
                    ...(response.totalUsage.outputTokens !== undefined && {
                        outputTokens: response.totalUsage.outputTokens,
                    }),
                    ...(response.totalUsage.reasoningTokens !== undefined && {
                        reasoningTokens: response.totalUsage.reasoningTokens,
                    }),
                    ...(response.totalUsage.totalTokens !== undefined && {
                        totalTokens: response.totalUsage.totalTokens,
                    }),
                },
            });

            // Add token usage to active span (if telemetry is enabled)
            const activeSpan = trace.getActiveSpan();
            if (activeSpan) {
                const attributes: Record<string, number> = {};
                if (response.totalUsage.inputTokens !== undefined) {
                    attributes['gen_ai.usage.input_tokens'] = response.totalUsage.inputTokens;
                }
                if (response.totalUsage.outputTokens !== undefined) {
                    attributes['gen_ai.usage.output_tokens'] = response.totalUsage.outputTokens;
                }
                if (response.totalUsage.totalTokens !== undefined) {
                    attributes['gen_ai.usage.total_tokens'] = response.totalUsage.totalTokens;
                }
                if (response.totalUsage.reasoningTokens !== undefined) {
                    attributes['gen_ai.usage.reasoning_tokens'] =
                        response.totalUsage.reasoningTokens;
                }
                activeSpan.setAttributes(attributes);
            }

            // Persist and update token count
            await this.contextManager.processLLMResponse(response);
            if (typeof response.totalUsage.totalTokens === 'number') {
                this.contextManager.updateActualTokenCount(response.totalUsage.totalTokens);
            }

            // Return the plain text of the response
            return response.text;
        } catch (err: unknown) {
            this.mapProviderError(err, 'generate');
        }
    }

    private mapProviderError(err: unknown, phase: 'generate' | 'stream'): never {
        // APICallError from Vercel AI SDK
        if (APICallError.isInstance?.(err)) {
            const status = err.statusCode;
            const headers = (err.responseHeaders || {}) as Record<string, string>;
            const retryAfter = headers['retry-after'] ? Number(headers['retry-after']) : undefined;
            const body =
                typeof err.responseBody === 'string'
                    ? err.responseBody
                    : JSON.stringify(err.responseBody ?? '');

            if (status === 429) {
                throw new DextoRuntimeError(
                    LLMErrorCode.RATE_LIMIT_EXCEEDED,
                    ErrorScope.LLM,
                    ErrorType.RATE_LIMIT,
                    `Rate limit exceeded${body ? ` - ${body}` : ''}`,
                    {
                        sessionId: this.sessionId,
                        provider: this.config.provider,
                        model: this.getModelId(),
                        status,
                        retryAfter,
                        body,
                        phase,
                    }
                );
            }
            if (status === 408) {
                throw new DextoRuntimeError(
                    LLMErrorCode.GENERATION_FAILED,
                    ErrorScope.LLM,
                    ErrorType.TIMEOUT,
                    `Provider timed out${body ? ` - ${body}` : ''}`,
                    {
                        sessionId: this.sessionId,
                        provider: this.config.provider,
                        model: this.getModelId(),
                        status,
                        body,
                        phase,
                    }
                );
            }
            throw new DextoRuntimeError(
                LLMErrorCode.GENERATION_FAILED,
                ErrorScope.LLM,
                ErrorType.THIRD_PARTY,
                `Provider error ${status}${body ? ` - ${body}` : ''}`,
                {
                    sessionId: this.sessionId,
                    provider: this.config.provider,
                    model: this.getModelId(),
                    status,
                    body,
                    phase,
                }
            );
        }
        // rethrow any other errors (including DextoRuntimeError and DextoValidationError)
        throw err;
    }

    // Updated streamText to behave like generateText - returns string and handles message processing internally
    async streamText(
        messages: ModelMessage[],
        tools: VercelToolSet,
        maxSteps: number = 10,
        signal?: AbortSignal
    ): Promise<string> {
        let stepIteration = 0;

        const temperature = this.config.temperature;
        const maxOutputTokens = this.config.maxOutputTokens;

        // Check if model supports tools and adjust accordingly
        const supportsTools = await this.validateToolSupport();
        const effectiveTools = supportsTools ? tools : {};

        if (!supportsTools && Object.keys(tools).length > 0) {
            this.logger.debug(
                `Model ${this.getModelId()} does not support tools, using empty tools object for streaming`
            );
        }

        // use vercel's streamText
        let streamErr: unknown | undefined;
        const includeMaxOutputTokens = typeof maxOutputTokens === 'number';
        const response = streamText({
            model: this.model,
            messages,
            tools: effectiveTools,
            ...(signal ? { abortSignal: signal } : {}),
            onChunk: (chunk) => {
                this.logger.debug(`Chunk type: ${chunk.chunk.type}`);
                if (chunk.chunk.type === 'text-delta') {
                    this.sessionEventBus.emit('llmservice:chunk', {
                        type: 'text',
                        content: chunk.chunk.text,
                        isComplete: false,
                    });
                } else if (chunk.chunk.type === 'reasoning-delta') {
                    this.sessionEventBus.emit('llmservice:chunk', {
                        type: 'reasoning',
                        content: chunk.chunk.text,
                        isComplete: false,
                    });
                }
            },
            // TODO: Add onAbort handler when we implement partial response handling.
            // Vercel triggers onAbort instead of onError for cancelled streams.
            // This is where cancellation logic should be handled properly.
            onError: (error) => {
                const err = toError(error);
                this.logger.error(`Error in streamText: ${err?.stack ?? err}`);
                this.sessionEventBus.emit('llmservice:error', {
                    error: err,
                    context: 'streamText',
                    recoverable: false,
                });
                streamErr = error;
            },
            onStepFinish: async (step) => {
                this.logger.debug(`Step iteration: ${stepIteration}`);
                stepIteration++;
                this.logger.debug(`Step finished, text: ${step.text}`);
                this.logger.debug(
                    `Step finished, step tool calls: ${JSON.stringify(step.toolCalls, null, 2)}`
                );
                this.logger.debug(
                    `Step finished, step tool results: ${JSON.stringify(step.toolResults, null, 2)}`
                );

                // Do not emit intermediate llmservice:response; chunks update the UI during streaming.
                // toolCall and toolResult events are now emitted immediately in execute() function
            },
            // No onFinish: we finalize after the stream completes below.
            stopWhen: stepCountIs(maxSteps),
            ...(includeMaxOutputTokens ? { maxOutputTokens: maxOutputTokens as number } : {}),
            ...(temperature !== undefined && { temperature }),
        });
        // Consume to completion via helpers and prepare final payload
        const [finalText, usage, reasoningText] = await Promise.all([
            response.text,
            response.totalUsage,
            response.reasoningText,
        ]);

        response.totalUsage;

        // If streaming reported an error, return early since we already emitted llmservice:error event
        if (streamErr) {
            // TODO: Re-evaluate error handling strategy - should we emit events OR throw, not both?
            // Current approach: emit llmservice:error event for subscribers (WebSocket, CLI, webhooks)
            // Alternative: throw error and let generic handlers deal with it
            // Trade-offs: event-driven (flexible, multiple subscribers) vs exception-based (simpler, single path)

            // Error was already handled via llmservice:error event in onError callback
            // Don't re-throw to prevent duplicate error messages in WebSocket
            return '';
        }
        // Emit final response with reasoning and full token usage (authoritative)
        this.sessionEventBus.emit('llmservice:response', {
            content: finalText,
            ...(reasoningText && { reasoning: reasoningText }),
            provider: this.config.provider,
            model: this.getModelId(),
            router: 'vercel',
            tokenUsage: {
                ...(usage.inputTokens !== undefined && { inputTokens: usage.inputTokens }),
                ...(usage.outputTokens !== undefined && { outputTokens: usage.outputTokens }),
                ...(usage.reasoningTokens !== undefined && {
                    reasoningTokens: usage.reasoningTokens,
                }),
                ...(usage.totalTokens !== undefined && { totalTokens: usage.totalTokens }),
            },
        });

        // Add token usage to active span (if telemetry is enabled)
        const activeSpan = trace.getActiveSpan();
        if (activeSpan) {
            const attributes: Record<string, number> = {};
            if (usage.inputTokens !== undefined) {
                attributes['gen_ai.usage.input_tokens'] = usage.inputTokens;
            }
            if (usage.outputTokens !== undefined) {
                attributes['gen_ai.usage.output_tokens'] = usage.outputTokens;
            }
            if (usage.totalTokens !== undefined) {
                attributes['gen_ai.usage.total_tokens'] = usage.totalTokens;
            }
            if (usage.reasoningTokens !== undefined) {
                attributes['gen_ai.usage.reasoning_tokens'] = usage.reasoningTokens;
            }
            activeSpan.setAttributes(attributes);
        }

        // Update ContextManager with actual token count
        if (typeof usage.totalTokens === 'number') {
            this.contextManager.updateActualTokenCount(usage.totalTokens);
        }

        // Persist the messages via formatter
        await this.contextManager.processLLMStreamResponse(response);

        this.logger.silly(`streamText response object: ${JSON.stringify(response, null, 2)}`);

        // Return the final text string
        return finalText;
    }

    /**
     * Get configuration information about the LLM service
     * @returns Configuration object with provider and model information
     */
    getConfig(): LLMServiceConfig {
        const configuredMaxTokens = this.contextManager.getMaxInputTokens();
        let modelMaxInputTokens: number;

        // Fetching max tokens from LLM registry - default to configured max tokens if not found
        // Max tokens may not be found if the model is supplied by user
        try {
            modelMaxInputTokens = getMaxInputTokensForModel(
                this.config.provider, // Use our internal provider name
                this.getModelId()
            );
        } catch (error) {
            // if the model is not found in the LLM registry, log and default to configured max tokens
            if (error instanceof DextoRuntimeError && error.code === LLMErrorCode.MODEL_UNKNOWN) {
                modelMaxInputTokens = configuredMaxTokens;
                this.logger.debug(
                    `Could not find model ${this.getModelId()} in LLM registry to get max tokens. Using configured max tokens: ${configuredMaxTokens}.`
                );
                // for any other error, throw
            } else {
                throw error;
            }
        }
        return {
            router: 'vercel',
            provider: this.config.provider, // Use our internal provider name
            model: this.model,
            configuredMaxInputTokens: configuredMaxTokens,
            modelMaxInputTokens: modelMaxInputTokens,
        };
    }

    /**
     * Get the context manager for external access
     */
    getContextManager(): ContextManager<unknown> {
        return this.contextManager;
    }
}
