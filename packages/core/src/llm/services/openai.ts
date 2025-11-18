import OpenAI, { APIError } from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { ToolManager } from '../../tools/tool-manager.js';
import { ILLMService, LLMServiceConfig } from './types.js';
import { ToolSet } from '../../tools/types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import { ContextManager } from '../../context/manager.js';
import { getMaxInputTokensForModel, getEffectiveMaxInputTokens } from '../registry.js';
import { ImageData, FileData } from '../../context/types.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { LLMErrorCode } from '../error-codes.js';
import type { SessionEventBus } from '../../events/index.js';
import type { IConversationHistoryProvider } from '../../session/history/types.js';
import type { SystemPromptManager } from '../../systemPrompt/manager.js';
import { OpenAIMessageFormatter } from '../formatters/openai.js';
import { createTokenizer } from '../tokenizer/factory.js';
import type { ValidatedLLMConfig } from '../schemas.js';
import { shouldIncludeRawToolResult } from '../../utils/debug.js';
import { InstrumentClass } from '../../telemetry/decorators.js';
import { trace, context, propagation } from '@opentelemetry/api';

/**
 * OpenAI implementation of LLMService
 * Not actively maintained, so might be buggy or outdated
 * TODO (Telemetry): Add OpenTelemetry metrics collection
 *   - LLM call counters (by provider/model)
 *   - Token usage histograms (input/output/total/reasoning)
 *   - Request latency histograms
 *   - Error rate counters
 *   See feature-plans/telemetry.md for details
 */
@InstrumentClass({
    prefix: 'llm.openai',
    excludeMethods: ['getAllTools', 'formatToolsForOpenAI', 'getConfig', 'getContextManager'],
})
export class OpenAIService implements ILLMService {
    private openai: OpenAI;
    private config: ValidatedLLMConfig;
    private toolManager: ToolManager;
    private contextManager: ContextManager<ChatCompletionMessageParam>;
    private sessionEventBus: SessionEventBus;
    private readonly sessionId: string;
    private logger: IDextoLogger;

    constructor(
        toolManager: ToolManager,
        openai: OpenAI,
        systemPromptManager: SystemPromptManager,
        historyProvider: IConversationHistoryProvider,
        sessionEventBus: SessionEventBus,
        config: ValidatedLLMConfig,
        sessionId: string,
        resourceManager: import('../../resources/index.js').ResourceManager,
        logger: IDextoLogger
    ) {
        this.logger = logger.createChild(DextoLogComponent.LLM);
        this.config = config;
        this.openai = openai;
        this.toolManager = toolManager;
        this.sessionEventBus = sessionEventBus;
        this.sessionId = sessionId;

        // Create properly-typed ContextManager for OpenAI
        const formatter = new OpenAIMessageFormatter(this.logger);
        const tokenizer = createTokenizer(config.provider, config.model, this.logger);
        const maxInputTokens = getEffectiveMaxInputTokens(config, this.logger);

        this.contextManager = new ContextManager<ChatCompletionMessageParam>(
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
    }

    getAllTools(): Promise<ToolSet> {
        return this.toolManager.getAllTools();
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
        const model = this.config.model;

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
            // Add user message with optional image and file data
            await this.contextManager.addUserMessage(textInput, imageData, fileData);

            // Get all tools
            const rawTools = await this.toolManager.getAllTools();
            const formattedTools = this.formatToolsForOpenAI(rawTools);

            this.logger.silly(`Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`);

            // Notify thinking
            this.logger.debug(
                `[OpenAIService.completeTask] Emitting llmservice:thinking on sessionEventBus for session=${this.sessionId}`
            );
            this.sessionEventBus.emit('llmservice:thinking');

            let iterationCount = 0;
            let totalTokens = 0;
            let inputTokens = 0;
            let outputTokens = 0;
            let reasoningTokens = 0;
            let fullResponse = '';
            const contextStr = stream ? 'OpenAI streaming API call' : 'OpenAI API call';

            try {
                while (iterationCount < this.config.maxIterations) {
                    if (options?.signal?.aborted) {
                        throw Object.assign(new Error('Aborted'), {
                            name: 'AbortError',
                            aborted: true,
                        });
                    }
                    iterationCount++;

                    // Get response with appropriate method
                    const { message, usage } = stream
                        ? await this.getAIStreamingResponseWithRetries(
                              formattedTools,
                              options?.signal
                          )
                        : await this.getAIResponseWithRetries(formattedTools, options?.signal);

                    // Track token usage
                    if (usage) {
                        totalTokens += usage.total_tokens ?? 0;
                        inputTokens += usage.prompt_tokens ?? 0;
                        outputTokens += usage.completion_tokens ?? 0;
                        reasoningTokens += usage.completion_tokens_details?.reasoning_tokens ?? 0;
                    }

                    // If there are no tool calls, we're done
                    if (!message.tool_calls || message.tool_calls.length === 0) {
                        const responseText = message.content || '';
                        const finalContent = stream ? fullResponse + responseText : responseText;

                        // Add assistant message to history (include streamed prefix if any)
                        await this.contextManager.addAssistantMessage(finalContent, undefined, {
                            tokenUsage:
                                totalTokens > 0
                                    ? {
                                          totalTokens,
                                          inputTokens,
                                          outputTokens,
                                          reasoningTokens,
                                      }
                                    : undefined,
                        });

                        // Update ContextManager with actual token count
                        if (totalTokens > 0) {
                            this.contextManager.updateActualTokenCount(totalTokens);
                        }

                        // Always emit token usage
                        this.logger.debug(
                            `[OpenAIService.completeTask] Emitting llmservice:response on sessionEventBus for session=${this.sessionId}, totalTokens=${totalTokens}`
                        );
                        this.sessionEventBus.emit('llmservice:response', {
                            content: finalContent,
                            provider: this.config.provider,
                            model: this.config.model,
                            router: 'in-built',
                            tokenUsage: { totalTokens, inputTokens, outputTokens, reasoningTokens },
                        });
                        this.logger.debug(
                            `[OpenAIService.completeTask] Emitted llmservice:response successfully`
                        );

                        // Add token usage to active span (if telemetry is enabled)
                        // Note: llm.provider and llm.model are already set at the start of completeTask
                        const activeSpan = trace.getActiveSpan();
                        if (activeSpan && totalTokens > 0) {
                            const attributes: Record<string, number> = {
                                'gen_ai.usage.total_tokens': totalTokens,
                            };
                            if (inputTokens > 0) {
                                attributes['gen_ai.usage.input_tokens'] = inputTokens;
                            }
                            if (outputTokens > 0) {
                                attributes['gen_ai.usage.output_tokens'] = outputTokens;
                            }
                            if (reasoningTokens > 0) {
                                attributes['gen_ai.usage.reasoning_tokens'] = reasoningTokens;
                            }
                            activeSpan.setAttributes(attributes);
                        }

                        return finalContent;
                    }

                    // Add assistant message with tool calls to history
                    // OpenAI v5 supports both function and custom tool types
                    // We currently only handle function types, so filter for those
                    const functionToolCalls = message.tool_calls.filter(
                        (
                            toolCall
                        ): toolCall is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => {
                            this.logger.debug(`Tool call type received: ${toolCall.type}`);
                            return toolCall.type === 'function';
                        }
                    );

                    if (message.tool_calls.length > functionToolCalls.length) {
                        this.logger.warn(
                            `Filtered out ${message.tool_calls.length - functionToolCalls.length} non-function tool calls`
                        );
                    }

                    await this.contextManager.addAssistantMessage(
                        message.content,
                        functionToolCalls.length > 0 ? functionToolCalls : undefined,
                        {}
                    );

                    // Accumulate response for streaming mode
                    if (stream && message.content) {
                        fullResponse += message.content;
                    }

                    // Handle tool calls (using robust non-streaming approach)
                    // Only process function tool calls that we've added to history
                    for (const toolCall of functionToolCalls) {
                        if (options?.signal?.aborted) {
                            throw Object.assign(new Error('Aborted'), {
                                name: 'AbortError',
                                aborted: true,
                            });
                        }
                        this.logger.debug(`Tool call initiated - Type: ${toolCall.type}`);
                        this.logger.debug(
                            `Tool call details: ${JSON.stringify(toolCall, null, 2)}`
                        );
                        // Since we're only processing function tool calls now
                        const toolName = toolCall.function.name;
                        let args: Record<string, any> = {};

                        try {
                            args = JSON.parse(toolCall.function.arguments);
                        } catch (e) {
                            this.logger.error(`Error parsing arguments for ${toolName}:`, {
                                error: e instanceof Error ? e.message : String(e),
                            });
                            const sanitized = await this.contextManager.addToolResult(
                                toolCall.id,
                                toolName,
                                { error: `Failed to parse arguments: ${e}` },
                                { success: false }
                            );
                            // Notify failure so UI & logging subscribers stay in sync
                            this.sessionEventBus.emit('llmservice:toolResult', {
                                toolName,
                                callId: toolCall.id,
                                success: false,
                                sanitized,
                                ...(shouldIncludeRawToolResult()
                                    ? { rawResult: { error: `Failed to parse arguments: ${e}` } }
                                    : {}),
                            });
                            continue;
                        }

                        // Notify tool call
                        this.sessionEventBus.emit('llmservice:toolCall', {
                            toolName,
                            args,
                            callId: toolCall.id,
                        });

                        // Execute tool
                        try {
                            const result = await this.toolManager.executeTool(
                                toolName,
                                args,
                                this.sessionId
                            );

                            // Add tool result to message manager
                            const sanitized = await this.contextManager.addToolResult(
                                toolCall.id,
                                toolName,
                                result,
                                { success: true }
                            );

                            // Notify tool result
                            this.sessionEventBus.emit('llmservice:toolResult', {
                                toolName,
                                callId: toolCall.id,
                                success: true,
                                sanitized,
                                ...(shouldIncludeRawToolResult() ? { rawResult: result } : {}),
                            });
                        } catch (error) {
                            // Handle tool execution error
                            const errorMessage =
                                error instanceof Error ? error.message : String(error);
                            this.logger.error(
                                `Tool execution error for ${toolName}: ${errorMessage}`
                            );

                            // Add error as tool result
                            const sanitized = await this.contextManager.addToolResult(
                                toolCall.id,
                                toolName,
                                { error: errorMessage },
                                { success: false }
                            );

                            this.sessionEventBus.emit('llmservice:toolResult', {
                                toolName,
                                callId: toolCall.id,
                                success: false,
                                sanitized,
                                ...(shouldIncludeRawToolResult()
                                    ? { rawResult: { error: errorMessage } }
                                    : {}),
                            });
                        }
                    }

                    // Continue to next iteration
                }

                // If we reached max iterations
                this.logger.warn(
                    `Reached maximum iterations (${this.config.maxIterations}) for task.`
                );
                const finalResponse =
                    fullResponse || 'Task completed but reached maximum tool call iterations.';
                await this.contextManager.addAssistantMessage(finalResponse, undefined, {
                    tokenUsage:
                        totalTokens > 0
                            ? {
                                  totalTokens,
                                  inputTokens,
                                  outputTokens,
                                  reasoningTokens,
                              }
                            : undefined,
                });

                // Update ContextManager with actual token count
                if (totalTokens > 0) {
                    this.contextManager.updateActualTokenCount(totalTokens);
                }

                // Always emit token usage
                this.sessionEventBus.emit('llmservice:response', {
                    content: finalResponse,
                    provider: this.config.provider,
                    model: this.config.model,
                    router: 'in-built',
                    tokenUsage: { totalTokens, inputTokens, outputTokens, reasoningTokens },
                });

                // Add token usage to active span (if telemetry is enabled)
                // Note: llm.provider and llm.model are already set at the start of completeTask
                const activeSpan = trace.getActiveSpan();
                if (activeSpan && totalTokens > 0) {
                    const attributes: Record<string, number> = {
                        'gen_ai.usage.total_tokens': totalTokens,
                    };
                    if (inputTokens > 0) {
                        attributes['gen_ai.usage.input_tokens'] = inputTokens;
                    }
                    if (outputTokens > 0) {
                        attributes['gen_ai.usage.output_tokens'] = outputTokens;
                    }
                    if (reasoningTokens > 0) {
                        attributes['gen_ai.usage.reasoning_tokens'] = reasoningTokens;
                    }
                    activeSpan.setAttributes(attributes);
                }

                return finalResponse;
            } catch (error) {
                if (
                    error instanceof Error &&
                    (error.name === 'AbortError' || (error as any).aborted === true)
                ) {
                    throw error;
                }
                // Handle API errors
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.error(`Error in ${contextStr}: ${errorMessage}`, { error });

                if (!stream) {
                    // Hint for token overflow (only for non-streaming to avoid spam)
                    this.logger.warn(
                        `If this error is due to token overflow, consider configuring 'maxInputTokens' in your LLMConfig.`
                    );
                }

                this.sessionEventBus.emit('llmservice:error', {
                    error: error instanceof Error ? error : new Error(errorMessage),
                    context: contextStr,
                    recoverable: false,
                });

                const errorResponse = `Error processing ${stream ? 'streaming ' : ''}request: ${errorMessage}`;
                await this.contextManager.addAssistantMessage(errorResponse, undefined, {});
                return errorResponse;
            }
        });
    }

    /**
     * Get configuration information about the LLM service
     * @returns Configuration object with provider and model information
     */
    getConfig(): LLMServiceConfig {
        const configuredMaxInputTokens = this.contextManager.getMaxInputTokens();
        let modelMaxInputTokens: number;

        // Fetching max tokens from LLM registry - default to configured max tokens if not found
        // Max tokens may not be found if the model is supplied by user
        try {
            modelMaxInputTokens = getMaxInputTokensForModel(
                this.config.provider,
                this.config.model,
                this.logger
            );
        } catch (error) {
            // if the model is not found in the LLM registry, log and default to configured max tokens
            if (error instanceof DextoRuntimeError && error.code === LLMErrorCode.MODEL_UNKNOWN) {
                modelMaxInputTokens = configuredMaxInputTokens;
                this.logger.debug(
                    `Could not find model ${this.config.model} in LLM registry to get max tokens. Using configured max tokens: ${configuredMaxInputTokens}.`
                );
                // for any other error, throw
            } else {
                throw error;
            }
        }

        return {
            router: 'in-built',
            provider: this.config.provider,
            model: this.config.model,
            configuredMaxInputTokens: configuredMaxInputTokens,
            modelMaxInputTokens,
        };
    }

    // Helper methods
    private async getAIResponseWithRetries(
        tools: OpenAI.Chat.Completions.ChatCompletionTool[],
        signal?: AbortSignal
    ): Promise<{
        message: OpenAI.Chat.Completions.ChatCompletionMessage;
        usage?: OpenAI.Completions.CompletionUsage;
    }> {
        let attempts = 0;
        const MAX_ATTEMPTS = 3;

        // Add a log of tools size
        this.logger.debug(`Tools size in getAIResponseWithRetries: ${tools.length}`);

        while (attempts < MAX_ATTEMPTS) {
            attempts++;

            try {
                // Use the new method that implements proper flow: get system prompt, compress history, format messages
                const {
                    formattedMessages,
                    systemPrompt: _systemPrompt,
                    tokensUsed,
                } = await this.contextManager.getFormattedMessagesWithCompression(
                    { mcpManager: this.toolManager.getMcpManager() },
                    { provider: this.config.provider, model: this.config.model }
                );

                this.logger.silly(
                    `Message history (potentially compressed) in getAIResponseWithRetries: ${JSON.stringify(formattedMessages, null, 2)}`
                );
                this.logger.debug(`Estimated tokens being sent to OpenAI: ${tokensUsed}`);

                // Call OpenAI API
                const response = await this.openai.chat.completions.create(
                    {
                        model: this.config.model,
                        messages: formattedMessages,
                        tools: attempts === 1 ? tools : [], // Only offer tools on first attempt
                        tool_choice: attempts === 1 ? 'auto' : 'none', // Disable tool choice on retry
                    },
                    signal ? { signal } : undefined
                );

                this.logger.silly(
                    `OPENAI CHAT COMPLETION RESPONSE: ${JSON.stringify(response, null, 2)}`
                );

                // Get the response message
                const message = response.choices[0]?.message;
                if (!message) {
                    throw new Error('Received empty message from OpenAI API');
                }

                // Get usage information
                const usage = response.usage;

                return { message, ...(usage && { usage }) };
            } catch (error) {
                if (
                    error instanceof Error &&
                    (error.name === 'AbortError' || (error as any).aborted === true)
                ) {
                    throw error;
                }
                const apiError = error as APIError;
                this.logger.error(
                    `Error in OpenAI API call (Attempt ${attempts}/${MAX_ATTEMPTS}): ${apiError.message || JSON.stringify(apiError, null, 2)}`,
                    { status: apiError.status, headers: apiError.headers }
                );

                if (apiError.status === 400 && apiError.code === 'context_length_exceeded') {
                    this.logger.warn(
                        `Context length exceeded. ContextManager compression might not be sufficient. Error details: ${JSON.stringify(apiError.error)}`
                    );
                }

                if (attempts >= MAX_ATTEMPTS) {
                    this.logger.error(
                        `Failed to get response from OpenAI after ${MAX_ATTEMPTS} attempts.`
                    );
                    throw error;
                }

                await new Promise((resolve) => setTimeout(resolve, 500 * attempts));
            }
        }

        throw new Error('Failed to get response after maximum retry attempts');
    }

    private async getAIStreamingResponseWithRetries(
        tools: OpenAI.Chat.Completions.ChatCompletionTool[],
        signal?: AbortSignal
    ): Promise<{
        message: OpenAI.Chat.Completions.ChatCompletionMessage;
        usage?: OpenAI.Completions.CompletionUsage;
    }> {
        let attempts = 0;
        const MAX_ATTEMPTS = 3;

        while (attempts < MAX_ATTEMPTS) {
            attempts++;

            try {
                // Get formatted messages from context manager
                const {
                    formattedMessages,
                    systemPrompt: _systemPrompt,
                    tokensUsed,
                } = await this.contextManager.getFormattedMessagesWithCompression(
                    { mcpManager: this.toolManager.getMcpManager() },
                    { provider: this.config.provider, model: this.config.model }
                );

                this.logger.silly(
                    `Streaming message history (potentially compressed): ${JSON.stringify(formattedMessages, null, 2)}`
                );
                this.logger.debug(`Estimated tokens being sent to OpenAI streaming: ${tokensUsed}`);

                // Create streaming chat completion
                const stream = await this.openai.chat.completions.create(
                    {
                        model: this.config.model,
                        messages: formattedMessages,
                        tools: attempts === 1 ? tools : [], // Only offer tools on first attempt
                        tool_choice: attempts === 1 ? 'auto' : 'none', // Disable tool choice on retry
                        stream: true,
                        stream_options: {
                            include_usage: true,
                        },
                    },
                    signal ? { signal } : undefined
                );

                // Collect the streaming response
                let content = '';
                let toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
                let usage: OpenAI.Completions.CompletionUsage | undefined;

                for await (const chunk of stream) {
                    if (signal?.aborted) {
                        throw Object.assign(new Error('Aborted'), {
                            name: 'AbortError',
                            aborted: true,
                        });
                    }
                    const delta = chunk.choices[0]?.delta;

                    if (delta?.content) {
                        content += delta.content;
                        // Emit chunk event for real-time streaming
                        this.sessionEventBus.emit('llmservice:chunk', {
                            type: 'text',
                            content: delta.content,
                            isComplete: false,
                        });
                    }

                    if (delta?.tool_calls) {
                        // Handle streaming tool calls
                        for (const toolCall of delta.tool_calls) {
                            const index = toolCall.index;
                            if (typeof index !== 'number') {
                                // Skip malformed tool call delta until index materializes
                                continue;
                            }

                            // Initialize tool call if needed
                            if (!toolCalls[index]) {
                                // Initialize with a placeholder; update once a real id arrives
                                toolCalls[index] = {
                                    id: `pending-${index}`,
                                    type: 'function',
                                    function: { name: '', arguments: '' },
                                };
                            }
                            if (toolCall.id) {
                                toolCalls[index].id = toolCall.id;
                            }

                            // Accumulate tool call data
                            const existingToolCall = toolCalls[index];

                            // We only support function tool calls in streaming
                            // Tool calls are initialized with type: 'function' above
                            if (existingToolCall.type === 'function' && toolCall.function) {
                                // Handle function type tool calls
                                if (toolCall.function.name) {
                                    // Tool names come as complete tokens, not chunks - use assignment
                                    existingToolCall.function.name = toolCall.function.name;
                                }
                                if (toolCall.function.arguments) {
                                    // Arguments are streamed in chunks, so concatenate them
                                    existingToolCall.function.arguments +=
                                        toolCall.function.arguments;
                                }
                            }
                        }
                    }

                    // Capture usage info from the final chunk
                    if (chunk.usage) {
                        usage = chunk.usage;
                    }
                }

                // Emit completion chunk
                if (content) {
                    this.sessionEventBus.emit('llmservice:chunk', {
                        type: 'text',
                        content: '',
                        isComplete: true,
                    });
                }

                // Construct the final message
                const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
                    role: 'assistant',
                    content: content || null,
                    refusal: null,
                    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
                };

                this.logger.debug(`OpenAI streaming completed. Usage info: ${usage}`);
                return { message, ...(usage && { usage }) };
            } catch (error) {
                const apiError = error as APIError;
                this.logger.error(
                    `Error in OpenAI streaming API call (Attempt ${attempts}/${MAX_ATTEMPTS}): ${apiError.message || JSON.stringify(apiError, null, 2)}`,
                    { status: apiError.status, headers: apiError.headers }
                );

                if (
                    apiError.status === 400 &&
                    apiError.message?.includes('maximum context length')
                ) {
                    this.logger.warn(
                        `Context length exceeded in streaming. ContextManager compression might not be sufficient. Error details: ${JSON.stringify(apiError.error)}`
                    );
                }

                if (attempts >= MAX_ATTEMPTS) {
                    this.logger.error(
                        `Failed to get streaming response from OpenAI after ${MAX_ATTEMPTS} attempts.`
                    );
                    throw error;
                }

                await new Promise((resolve) => setTimeout(resolve, 500 * attempts));
            }
        }

        throw new Error('Failed to get streaming response after maximum retry attempts');
    }

    private formatToolsForOpenAI(tools: ToolSet): OpenAI.Chat.Completions.ChatCompletionTool[] {
        // Keep the existing implementation
        // Convert the ToolSet object to an array of tools in OpenAI's format
        return Object.entries(tools).map(([name, tool]) => {
            return {
                type: 'function' as const,
                function: {
                    name,
                    description: tool.description || '',
                    parameters: tool.parameters as OpenAI.FunctionParameters,
                },
            };
        });
    }

    /**
     * Get the context manager for external access
     */
    getContextManager(): ContextManager<unknown> {
        return this.contextManager;
    }
}
