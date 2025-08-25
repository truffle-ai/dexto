import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { ToolManager } from '../../tools/tool-manager.js';
import { ILLMService, LLMServiceConfig } from './types.js';
import { ToolSet } from '../../tools/types.js';
import { logger } from '../../logger/index.js';
import { ContextManager } from '../../context/manager.js';
import { getMaxInputTokensForModel, getEffectiveMaxInputTokens } from '../registry.js';
import { ImageData, FileData } from '../../context/types.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { LLMErrorCode } from '../error-codes.js';
import type { SessionEventBus } from '../../events/index.js';
import type { IConversationHistoryProvider } from '../../session/history/types.js';
import type { PromptManager } from '../../systemPrompt/manager.js';
import { OpenAIMessageFormatter } from '../formatters/openai.js';
import { createTokenizer } from '../tokenizer/factory.js';
import type { ValidatedLLMConfig } from '../schemas.js';

/**
 * OpenAI implementation of LLMService
 * Not actively maintained, so might be buggy or outdated
 */
export class OpenAIService implements ILLMService {
    private openai: OpenAI;
    private config: ValidatedLLMConfig;
    private toolManager: ToolManager;
    private contextManager: ContextManager<ChatCompletionMessageParam>;
    private sessionEventBus: SessionEventBus;
    private readonly sessionId: string;

    constructor(
        toolManager: ToolManager,
        openai: OpenAI,
        promptManager: PromptManager,
        historyProvider: IConversationHistoryProvider,
        sessionEventBus: SessionEventBus,
        config: ValidatedLLMConfig,
        sessionId: string
    ) {
        this.config = config;
        this.openai = openai;
        this.toolManager = toolManager;
        this.sessionEventBus = sessionEventBus;
        this.sessionId = sessionId;

        // Create properly-typed ContextManager for OpenAI
        const formatter = new OpenAIMessageFormatter();
        const tokenizer = createTokenizer(config.provider, config.model);
        const maxInputTokens = getEffectiveMaxInputTokens(config);

        this.contextManager = new ContextManager<ChatCompletionMessageParam>(
            formatter,
            promptManager,
            sessionEventBus,
            maxInputTokens,
            tokenizer,
            historyProvider,
            sessionId
        );
    }

    getAllTools(): Promise<ToolSet> {
        return this.toolManager.getAllTools();
    }

    async completeTask(
        textInput: string,
        imageData?: ImageData,
        fileData?: FileData,
        stream?: boolean
    ): Promise<string> {
        // Add user message with optional image and file data
        await this.contextManager.addUserMessage(textInput, imageData, fileData);

        // Get all tools
        const rawTools = await this.toolManager.getAllTools();
        const formattedTools = this.formatToolsForOpenAI(rawTools);

        logger.silly(`Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`);

        // Notify thinking
        this.sessionEventBus.emit('llmservice:thinking');

        // Route to streaming or non-streaming implementation
        if (stream) {
            return await this.completeTaskWithStreaming(formattedTools);
        } else {
            return await this.completeTaskWithoutStreaming(formattedTools);
        }
    }

    private async completeTaskWithoutStreaming(formattedTools: any[]): Promise<string> {
        let iterationCount = 0;
        let totalTokens = 0;

        try {
            while (iterationCount < this.config.maxIterations) {
                iterationCount++;

                // Attempt to get a response, with retry logic
                const { message, usage } = await this.getAIResponseWithRetries(formattedTools);

                // Track token usage
                if (usage) {
                    totalTokens += usage.total_tokens;
                }

                // If there are no tool calls, we're done
                if (!message.tool_calls || message.tool_calls.length === 0) {
                    const responseText = message.content || '';

                    // Add assistant message to history
                    await this.contextManager.addAssistantMessage(responseText);

                    // Update ContextManager with actual token count for hybrid approach
                    if (totalTokens > 0) {
                        this.contextManager.updateActualTokenCount(totalTokens);
                    }

                    // Emit final response with token usage (total only)
                    this.sessionEventBus.emit('llmservice:response', {
                        content: responseText,
                        model: this.config.model,
                        ...(totalTokens > 0 && { tokenUsage: { totalTokens } }),
                    });
                    return responseText;
                }

                // Add assistant message with tool calls to history
                await this.contextManager.addAssistantMessage(message.content, message.tool_calls);

                // Handle tool calls
                for (const toolCall of message.tool_calls) {
                    logger.debug(`Tool call initiated: ${JSON.stringify(toolCall, null, 2)}`);
                    const toolName = toolCall.function.name;
                    let args: any = {};

                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (e) {
                        logger.error(`Error parsing arguments for ${toolName}:`, e);
                        await this.contextManager.addToolResult(toolCall.id, toolName, {
                            error: `Failed to parse arguments: ${e}`,
                        });
                        // Notify failure so UI & logging subscribers stay in sync
                        this.sessionEventBus.emit('llmservice:toolResult', {
                            toolName,
                            result: { error: `Failed to parse arguments: ${e}` },
                            callId: toolCall.id,
                            success: false,
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
                        await this.contextManager.addToolResult(toolCall.id, toolName, result);

                        // Notify tool result
                        this.sessionEventBus.emit('llmservice:toolResult', {
                            toolName,
                            result,
                            callId: toolCall.id,
                            success: true,
                        });
                    } catch (error) {
                        // Handle tool execution error
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        logger.error(`Tool execution error for ${toolName}: ${errorMessage}`);

                        // Add error as tool result
                        await this.contextManager.addToolResult(toolCall.id, toolName, {
                            error: errorMessage,
                        });

                        this.sessionEventBus.emit('llmservice:toolResult', {
                            toolName,
                            result: { error: errorMessage },
                            callId: toolCall.id,
                            success: false,
                        });
                    }
                }

                // Continue to next iteration without additional thinking notification
            }

            // If we reached max iterations, return a message
            logger.warn(`Reached maximum iterations (${this.config.maxIterations}) for task.`);
            const finalResponse = 'Task completed but reached maximum tool call iterations.';
            await this.contextManager.addAssistantMessage(finalResponse);

            // Update ContextManager with actual token count for hybrid approach
            if (totalTokens > 0) {
                this.contextManager.updateActualTokenCount(totalTokens);
            }

            // Emit final response with token usage (total only)
            this.sessionEventBus.emit('llmservice:response', {
                content: finalResponse,
                model: this.config.model,
                ...(totalTokens > 0 && { tokenUsage: { totalTokens } }),
            });
            return finalResponse;
        } catch (error) {
            // Handle API errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Error in OpenAI service API call: ${errorMessage}`, { error });
            // Hint for token overflow
            logger.warn(
                `If this error is due to token overflow, consider configuring 'maxInputTokens' in your LLMConfig.`
            );
            this.sessionEventBus.emit('llmservice:error', {
                error: error instanceof Error ? error : new Error(errorMessage),
                context: 'OpenAI API call',
                recoverable: false,
            });
            await this.contextManager.addAssistantMessage(
                `Error processing request: ${errorMessage}`
            );
            return `Error processing request: ${errorMessage}`;
        }
    }

    private async completeTaskWithStreaming(
        formattedTools: OpenAI.Chat.Completions.ChatCompletionTool[]
    ): Promise<string> {
        let iterationCount = 0;
        let totalTokens = 0;
        let fullResponse = '';

        try {
            while (iterationCount < this.config.maxIterations) {
                iterationCount++;

                // Attempt to get a streaming response
                const streamResult = await this.getAIStreamingResponseWithRetries(formattedTools);
                const { message, usage } = streamResult;

                // Track token usage
                if (usage) {
                    totalTokens += usage.total_tokens;
                }

                // If there are no tool calls, we're done
                if (!message.tool_calls || message.tool_calls.length === 0) {
                    const responseText = message.content || '';
                    fullResponse += responseText;

                    // Add assistant message to history
                    await this.contextManager.addAssistantMessage(responseText);

                    // Update ContextManager with actual token count
                    if (totalTokens > 0) {
                        this.contextManager.updateActualTokenCount(totalTokens);
                    }

                    // Emit final response with token usage (always emit, even if 0)
                    this.sessionEventBus.emit('llmservice:response', {
                        content: fullResponse,
                        model: this.config.model,
                        tokenUsage: { totalTokens },
                    });
                    return fullResponse;
                }

                // Add assistant message with tool calls to history FIRST (crucial for OpenAI conversation flow)
                await this.contextManager.addAssistantMessage(message.content, message.tool_calls);

                // Handle tool calls (emit tool call events)
                for (const toolCall of message.tool_calls) {
                    if (toolCall.type === 'function') {
                        const toolName = toolCall.function.name;
                        const toolArgs = JSON.parse(toolCall.function.arguments || '{}');

                        this.sessionEventBus.emit('llmservice:toolCall', {
                            toolName,
                            args: toolArgs,
                            callId: toolCall.id,
                        });

                        // Execute the tool and emit result event
                        try {
                            const result = await this.toolManager.executeTool(
                                toolName,
                                toolArgs,
                                this.sessionId
                            );

                            // Add tool result to conversation history (after assistant message)
                            await this.contextManager.addToolResult(toolCall.id, toolName, result);

                            this.sessionEventBus.emit('llmservice:toolResult', {
                                toolName,
                                result,
                                callId: toolCall.id,
                                success: true,
                            });
                        } catch (error) {
                            const errorMessage =
                                error instanceof Error ? error.message : String(error);
                            const errorResult = { error: errorMessage };

                            // Add error result to conversation history (after assistant message)
                            await this.contextManager.addToolResult(
                                toolCall.id,
                                toolName,
                                errorResult
                            );

                            this.sessionEventBus.emit('llmservice:toolResult', {
                                toolName,
                                result: errorResult,
                                callId: toolCall.id,
                                success: false,
                            });
                        }
                    }
                }

                // Continue to next iteration
            }

            // If we reached max iterations
            logger.warn(
                `Reached maximum iterations (${this.config.maxIterations}) for streaming task.`
            );
            const finalResponse =
                fullResponse || 'Task completed but reached maximum tool call iterations.';

            // Update ContextManager with actual token count
            if (totalTokens > 0) {
                this.contextManager.updateActualTokenCount(totalTokens);
            }

            // Emit final response with token usage (always emit, even if 0)
            this.sessionEventBus.emit('llmservice:response', {
                content: finalResponse,
                model: this.config.model,
                tokenUsage: { totalTokens },
            });
            return finalResponse;
        } catch (error) {
            // Handle API errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Error in OpenAI streaming service API call: ${errorMessage}`, { error });

            this.sessionEventBus.emit('llmservice:error', {
                error: error instanceof Error ? error : new Error(errorMessage),
                context: 'OpenAI streaming API call',
                recoverable: false,
            });

            const errorResponse = `Error processing streaming request: ${errorMessage}`;
            await this.contextManager.addAssistantMessage(errorResponse);
            return errorResponse;
        }
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
            modelMaxInputTokens = getMaxInputTokensForModel('openai', this.config.model);
        } catch (error) {
            // if the model is not found in the LLM registry, log and default to configured max tokens
            if (error instanceof DextoRuntimeError && error.code === LLMErrorCode.MODEL_UNKNOWN) {
                modelMaxInputTokens = configuredMaxInputTokens;
                logger.debug(
                    `Could not find model ${this.config.model} in LLM registry to get max tokens. Using configured max tokens: ${configuredMaxInputTokens}.`
                );
                // for any other error, throw
            } else {
                throw error;
            }
        }

        return {
            router: 'in-built',
            provider: 'openai',
            model: this.config.model,
            configuredMaxInputTokens: configuredMaxInputTokens,
            modelMaxInputTokens,
        };
    }

    // Helper methods
    private async getAIResponseWithRetries(
        tools: OpenAI.Chat.Completions.ChatCompletionTool[]
    ): Promise<{
        message: OpenAI.Chat.Completions.ChatCompletionMessage;
        usage?: OpenAI.Completions.CompletionUsage;
    }> {
        let attempts = 0;
        const MAX_ATTEMPTS = 3;

        // Add a log of tools size
        logger.debug(`Tools size in getAIResponseWithRetries: ${tools.length}`);

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
                    { provider: 'openai' as const, model: this.config.model }
                );

                logger.silly(
                    `Message history (potentially compressed) in getAIResponseWithRetries: ${JSON.stringify(formattedMessages, null, 2)}`
                );
                logger.debug(`Estimated tokens being sent to OpenAI: ${tokensUsed}`);

                // Call OpenAI API
                const response = await this.openai.chat.completions.create({
                    model: this.config.model,
                    messages: formattedMessages,
                    tools: attempts === 1 ? tools : [], // Only offer tools on first attempt
                    tool_choice: attempts === 1 ? 'auto' : 'none', // Disable tool choice on retry
                });

                logger.silly(
                    'OPENAI CHAT COMPLETION RESPONSE: ',
                    JSON.stringify(response, null, 2)
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
                const apiError = error as any;
                logger.error(
                    `Error in OpenAI API call (Attempt ${attempts}/${MAX_ATTEMPTS}): ${apiError.message || JSON.stringify(apiError, null, 2)}`,
                    { status: apiError.status, headers: apiError.headers }
                );

                if (apiError.status === 400 && apiError.error?.code === 'context_length_exceeded') {
                    logger.warn(
                        `Context length exceeded. ContextManager compression might not be sufficient. Error details: ${JSON.stringify(apiError.error)}`
                    );
                }

                if (attempts >= MAX_ATTEMPTS) {
                    logger.error(
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
        tools: OpenAI.Chat.Completions.ChatCompletionTool[]
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
                    { provider: 'openai' as const, model: this.config.model }
                );

                logger.silly(
                    `Streaming message history (potentially compressed): ${JSON.stringify(formattedMessages, null, 2)}`
                );
                logger.debug(`Estimated tokens being sent to OpenAI streaming: ${tokensUsed}`);

                // Create streaming chat completion
                const stream = await this.openai.chat.completions.create({
                    model: this.config.model,
                    messages: formattedMessages,
                    tools: attempts === 1 ? tools : [], // Only offer tools on first attempt
                    tool_choice: attempts === 1 ? 'auto' : 'none', // Disable tool choice on retry
                    stream: true,
                    stream_options: {
                        include_usage: true,
                    },
                });

                // Collect the streaming response
                let content = '';
                let toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
                let usage: OpenAI.Completions.CompletionUsage | undefined;

                for await (const chunk of stream) {
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
                            const index = toolCall.index!;

                            // Initialize tool call if needed
                            if (!toolCalls[index]) {
                                toolCalls[index] = {
                                    id: toolCall.id!,
                                    type: 'function',
                                    function: { name: '', arguments: '' },
                                };
                            }

                            // Accumulate tool call data
                            if (toolCall.function?.name) {
                                toolCalls[index].function.name += toolCall.function.name;
                            }
                            if (toolCall.function?.arguments) {
                                toolCalls[index].function.arguments += toolCall.function.arguments;
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

                logger.debug(`OpenAI streaming completed. Usage info: ${usage}`);
                return { message, ...(usage && { usage }) };
            } catch (error) {
                const apiError = error as any;
                logger.error(
                    `Error in OpenAI streaming API call (Attempt ${attempts}/${MAX_ATTEMPTS}): ${apiError.message || JSON.stringify(apiError, null, 2)}`,
                    { status: apiError.status, headers: apiError.headers }
                );

                if (
                    apiError.status === 400 &&
                    apiError.message?.includes('maximum context length')
                ) {
                    logger.warn(
                        `Context length exceeded in streaming. ContextManager compression might not be sufficient. Error details: ${JSON.stringify(apiError.error)}`
                    );
                }

                if (attempts >= MAX_ATTEMPTS) {
                    logger.error(
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
                    parameters: tool.parameters as Record<string, any>,
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
