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
import {
    summarizeToolContentForText,
    getImageData,
    expandBlobReferences,
    sanitizeToolResult,
} from '../../context/utils.js';
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
import { trace, context, propagation } from '@opentelemetry/api';

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
                            this.sessionEventBus.emit('llm:tool-call', {
                                toolName,
                                args: args as Record<string, unknown>,
                                callId,
                            });

                            const rawResult = await this.toolManager.executeTool(
                                toolName,
                                args as Record<string, unknown>,
                                this.sessionId
                            );

                            // TODO: Temp fix - will be replaced by TurnExecutor in Phase 8
                            // Sanitize first, then persist
                            const persisted = await sanitizeToolResult(
                                rawResult,
                                {
                                    blobStore: this.contextManager
                                        .getResourceManager()
                                        .getBlobStore(),
                                    toolName,
                                    toolCallId: callId,
                                    success: true,
                                },
                                this.logger
                            );
                            await this.contextManager.addToolResult(callId, toolName, persisted);

                            this.logger.debug(
                                `[vercel] Emitting toolResult event for ${toolName} with callId ${callId}`
                            );
                            this.sessionEventBus.emit('llm:tool-result', {
                                toolName,
                                callId,
                                success: true,
                                sanitized: persisted,
                                ...(shouldIncludeRawToolResult() ? { rawResult } : {}),
                            });

                            // Expand blob references to actual base64 data before sending to LLM
                            // Tool results are stored with @blob: refs, but LLM needs actual data
                            this.logger.debug(
                                `[vercel] Expanding blob refs for tool result. Input content types: ${persisted.content.map((p) => p.type).join(', ')}`
                            );
                            const expandedContent = await expandBlobReferences(
                                persisted.content,
                                this.contextManager.getResourceManager(),
                                this.logger
                            );
                            this.logger.debug(
                                `[vercel] Expanded content types: ${Array.isArray(expandedContent) ? expandedContent.map((p) => `${p.type}${p.type === 'image' ? `(${typeof (p as { image?: unknown }).image === 'string' && (p as { image: string }).image.startsWith('@blob:') ? 'blob-ref' : 'base64'})` : ''}`).join(', ') : 'string'}`
                            );

                            // Convert sanitized content to Vercel AI SDK multimodal format
                            // This enables images in tool results to be properly sent to the LLM
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
                                    const imageData = getImageData(part, this.logger);
                                    if (imageData) {
                                        contentValue.push({
                                            type: 'media',
                                            data: imageData,
                                            mediaType: part.mimeType || 'image/jpeg',
                                        });
                                    }
                                } else if (part.type === 'file') {
                                    // Files are also sent as media if supported
                                    const fileData =
                                        typeof part.data === 'string'
                                            ? part.data
                                            : Buffer.from(part.data as ArrayBuffer).toString(
                                                  'base64'
                                              );
                                    contentValue.push({
                                        type: 'media',
                                        data: fileData,
                                        mediaType: part.mimeType || 'application/octet-stream',
                                    });
                                }
                            }

                            // If we have multimodal content, return it in the proper format
                            // Otherwise fall back to text summary for compatibility
                            if (
                                contentValue.length > 0 &&
                                contentValue.some((v) => v.type === 'media')
                            ) {
                                return { type: 'content' as const, value: contentValue };
                            }

                            // Fallback to text summary if no media content
                            return summarizeToolContentForText(persisted.content);
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
                                // TODO: Temp fix - will be replaced by TurnExecutor in Phase 8
                                const persisted = await sanitizeToolResult(
                                    errorResult,
                                    {
                                        blobStore: this.contextManager
                                            .getResourceManager()
                                            .getBlobStore(),
                                        toolName,
                                        toolCallId: callId,
                                        success: false,
                                    },
                                    this.logger
                                );
                                await this.contextManager.addToolResult(
                                    callId,
                                    toolName,
                                    persisted
                                );

                                this.sessionEventBus.emit('llm:tool-result', {
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
        // Get active span and context
        const activeSpan = trace.getActiveSpan();
        const currentContext = context.active();

        const provider = this.config.provider;
        const model = this.getModelId();

        // Set on active span
        if (activeSpan) {
            activeSpan.setAttribute('llm.provider', provider);
            activeSpan.setAttribute('llm.model', model);
        }

        // Add to baggage for child span propagation
        const existingBaggage = propagation.getBaggage(currentContext);
        const baggageEntries: Record<string, import('@opentelemetry/api').BaggageEntry> = {};

        // Preserve existing baggage
        if (existingBaggage) {
            existingBaggage.getAllEntries().forEach(([key, entry]) => {
                baggageEntries[key] = entry;
            });
        }

        // Add LLM metadata
        baggageEntries['llm.provider'] = { value: provider };
        baggageEntries['llm.model'] = { value: model };

        const updatedContext = propagation.setBaggage(
            currentContext,
            propagation.createBaggage(baggageEntries)
        );

        // Execute rest of method in updated context
        return await context.with(updatedContext, async () => {
            // Add user message, with optional image and file data
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

            this.sessionEventBus.emit('llm:thinking');
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
        });
    }

    async generateText(
        messages: ModelMessage[],
        tools: VercelToolSet,
        maxSteps: number = 50,
        signal?: AbortSignal
    ): Promise<string> {
        // Set provider and model attributes at the start of the span
        const activeSpan = trace.getActiveSpan();
        if (activeSpan) {
            activeSpan.setAttribute('llm.provider', this.config.provider);
            activeSpan.setAttribute('llm.model', this.getModelId());
        }

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

            // LLM context for formatting during prepareStep compression
            const llmContext = { provider: this.config.provider, model: this.getModelId() };

            const response = await generateText({
                model: this.model,
                messages,
                tools: effectiveTools,
                ...(signal ? { abortSignal: signal } : {}),
                // prepareStep runs BEFORE each step - use it to compress messages mid-loop
                prepareStep: ({ messages: stepMessages }) => {
                    const result = this.contextManager.compressMessagesForPrepareStep(
                        stepMessages as ModelMessage[],
                        llmContext
                    );

                    // Emit event if compression occurred
                    if (result.compressed && result.metadata) {
                        this.sessionEventBus.emit('context:compressed', {
                            originalTokens: result.metadata.originalTokens,
                            compressedTokens: result.metadata.compressedTokens,
                            originalMessages: result.metadata.originalMessages,
                            compressedMessages: result.metadata.compressedMessages,
                            strategy: result.metadata.strategy,
                            reason: 'token_limit',
                        });
                    }

                    return { messages: result.messages };
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

                    // Update actual token count from step usage for better compression estimates
                    // This helps prepareStep make more accurate decisions on next iteration
                    const stepUsage = step.usage;
                    if (stepUsage && typeof stepUsage.inputTokens === 'number') {
                        this.logger.debug(
                            `Step ${stepIteration} usage: input=${stepUsage.inputTokens}, output=${stepUsage.outputTokens}, total=${stepUsage.totalTokens}`
                        );
                        // Use inputTokens as the current context size estimate
                        this.contextManager.updateActualTokenCount(stepUsage.inputTokens);
                    }

                    // Do not emit intermediate llm:response; generateText is non-stream so we only emit once after completion.
                    // toolCall and toolResult events are now emitted immediately in execute() function
                },
                stopWhen: stepCountIs(maxSteps),
                ...(includeMaxOutputTokens ? { maxOutputTokens: maxOutputTokens as number } : {}),
                ...(temperature !== undefined && { temperature }),
            });
            // Emit final response with reasoning and token usage (authoritative)
            this.sessionEventBus.emit('llm:response', {
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
            // Note: llm.provider and llm.model are already set at the start of the method
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
            const error = this.mapProviderError(err, 'generate');
            this.sessionEventBus.emit('llm:error', {
                error: error as Error,
                context: 'generateText',
                recoverable: false,
            });
            return '';
        }
    }

    private mapProviderError(err: unknown, phase: 'generate' | 'stream'): Error {
        // APICallError from Vercel AI SDK) {
        if (APICallError.isInstance?.(err)) {
            this.logger.error(`APICallError in mapProviderError: ${JSON.stringify(err, null, 2)}`);
            const status = err.statusCode;
            const headers = (err.responseHeaders || {}) as Record<string, string>;
            const retryAfter = headers['retry-after'] ? Number(headers['retry-after']) : undefined;
            const body =
                typeof err.responseBody === 'string'
                    ? err.responseBody
                    : JSON.stringify(err.responseBody ?? '');

            if (status === 429) {
                return new DextoRuntimeError(
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
                return new DextoRuntimeError(
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
            return new DextoRuntimeError(
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

        // convert any other errors (including DextoRuntimeError and DextoValidationError) to an Error
        return toError(err, this.logger);
    }

    // Updated streamText to behave like generateText - returns string and handles message processing internally
    async streamText(
        messages: ModelMessage[],
        tools: VercelToolSet,
        maxSteps: number = 10,
        signal?: AbortSignal
    ): Promise<string> {
        // Set provider and model attributes at the start of the span
        const activeSpan = trace.getActiveSpan();
        if (activeSpan) {
            activeSpan.setAttribute('llm.provider', this.config.provider);
            activeSpan.setAttribute('llm.model', this.getModelId());
        }

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

        // LLM context for formatting during prepareStep compression
        const llmContext = { provider: this.config.provider, model: this.getModelId() };

        let response;
        response = streamText({
            model: this.model,
            messages,
            tools: effectiveTools,
            ...(signal ? { abortSignal: signal } : {}),
            // prepareStep runs BEFORE each step - use it to compress messages mid-loop
            prepareStep: ({ messages: stepMessages }) => {
                const result = this.contextManager.compressMessagesForPrepareStep(
                    stepMessages as ModelMessage[],
                    llmContext
                );

                // Emit event if compression occurred
                if (result.compressed && result.metadata) {
                    this.sessionEventBus.emit('context:compressed', {
                        originalTokens: result.metadata.originalTokens,
                        compressedTokens: result.metadata.compressedTokens,
                        originalMessages: result.metadata.originalMessages,
                        compressedMessages: result.metadata.compressedMessages,
                        strategy: result.metadata.strategy,
                        reason: 'token_limit',
                    });
                }

                return { messages: result.messages };
            },
            onChunk: (chunk) => {
                this.logger.debug(`Chunk type: ${chunk.chunk.type}`);
                if (chunk.chunk.type === 'text-delta') {
                    this.sessionEventBus.emit('llm:chunk', {
                        chunkType: 'text',
                        content: chunk.chunk.text,
                        isComplete: false,
                    });
                } else if (chunk.chunk.type === 'reasoning-delta') {
                    this.sessionEventBus.emit('llm:chunk', {
                        chunkType: 'reasoning',
                        content: chunk.chunk.text,
                        isComplete: false,
                    });
                }
            },
            // TODO: Add onAbort handler when we implement partial response handling.
            // Vercel triggers onAbort instead of onError for cancelled streams.
            // This is where cancellation logic should be handled properly.
            onError: (error) => {
                const err = this.mapProviderError(error, 'stream');
                this.logger.error(`Error in streamText after parsing: ${err.toString()}`);

                this.sessionEventBus.emit('llm:error', {
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

                // Update actual token count from step usage for better compression estimates
                // This helps prepareStep make more accurate decisions on next iteration
                const stepUsage = step.usage;
                if (stepUsage && typeof stepUsage.inputTokens === 'number') {
                    this.logger.debug(
                        `Step ${stepIteration} usage: input=${stepUsage.inputTokens}, output=${stepUsage.outputTokens}, total=${stepUsage.totalTokens}`
                    );
                    // Use inputTokens as the current context size estimate
                    this.contextManager.updateActualTokenCount(stepUsage.inputTokens);
                }

                // Do not emit intermediate llm:response; chunks update the UI during streaming.
                // toolCall and toolResult events are now emitted immediately in execute() function
            },
            // No onFinish: we finalize after the stream completes below.
            stopWhen: stepCountIs(maxSteps),
            ...(includeMaxOutputTokens ? { maxOutputTokens: maxOutputTokens as number } : {}),
            ...(temperature !== undefined && { temperature }),
        });

        // Check for streaming errors BEFORE consuming response promises
        //this.logger.debug(`streamText streamErr: ${JSON.stringify(streamErr, null, 2)}`);
        if (streamErr) {
            // Error was already handled via llm:error event in onError callback
            return '';
        }

        //this.logger.debug(`awaiting promises`);
        // Consume to completion via helpers and prepare final payload

        let finalText: string;
        let usage: any;
        let reasoningText: string | undefined;

        // [finalText, usage, reasoningText] = await Promise.all([
        //     response.text,
        //     response.totalUsage,
        //     response.reasoningText,
        // ]);
        try {
            [finalText, usage, reasoningText] = await Promise.all([
                response.text,
                response.totalUsage,
                response.reasoningText,
            ]);
        } catch (_error) {
            // Log finalization failures to aid debugging
            this.logger.debug(
                `streamText finalization failed while awaiting text/usage/reasoning: ${String(_error)}`
            );
            /* nov 21 2025 - this is the error we get when model generation fails here
             * [API] 7:50:02 PM [ERROR] [llm:default-agent] ${JSON.stringify(error, null, 2): {
             * [API]   "name": "AI_NoOutputGeneratedError"
             * [API] }
             * [API] 7:50:02 PM [ERROR] [llm:default-agent] error.cause: undefined
             * [API] 7:50:02 PM [ERROR] [llm:default-agent] error.name: AI_NoOutputGeneratedError
             * [API] 7:50:02 PM [ERROR] [llm:default-agent] error.stack: AI_NoOutputGeneratedError: No output generated. Check the stream for errors.
             * [API]     at Object.flush (file:///Users/karaj/Projects/dexto/node_modules/.pnpm/ai@5.0.29_zod@3.25.76/node_modules/ai/dist/index.mjs:4682:27)
             * [API]     at invokePromiseCallback (node:internal/webstreams/util:181:10)
             * [API]     at Object.<anonymous> (node:internal/webstreams/util:186:23)
             * [API]     at transformStreamDefaultSinkCloseAlgorithm (node:internal/webstreams/transformstream:613:43)
             * [API]     at node:internal/webstreams/transformstream:371:11
             * [API]     at writableStreamDefaultControllerProcessClose (node:internal/webstreams/writablestream:1153:28)
             * [API]     at writableStreamDefaultControllerAdvanceQueueIfNeeded (node:internal/webstreams/writablestream:1233:5)
             * [API]     at writableStreamDefaultControllerClose (node:internal/webstreams/writablestream:1200:3)
             * [API]     at writableStreamClose (node:internal/webstreams/writablestream:713:3)
             * [API]     at writableStreamDefaultWriterClose (node:internal/webstreams/writablestream:1082:10)
             * [API] 7:50:02 PM [ERROR] [llm:default-agent] error.toString: AI_NoOutputGeneratedError: No output generated. Check the stream for errors.
             */
            return '';
        }

        this.logger.debug(`streamText finalText: ${finalText}`);
        this.logger.debug(`streamText usage: ${JSON.stringify(usage, null, 2)}`);
        this.logger.debug(`streamText reasoningText: ${reasoningText}`);

        // Emit final response with reasoning and full token usage (authoritative)
        this.sessionEventBus.emit('llm:response', {
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
        // Note: llm.provider and llm.model are already set at the start of the method
        const activeSpan2 = trace.getActiveSpan();
        if (activeSpan2) {
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
            activeSpan2.setAttributes(attributes);
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
                this.getModelId(),
                this.logger
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
