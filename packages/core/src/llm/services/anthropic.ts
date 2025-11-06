import Anthropic from '@anthropic-ai/sdk';
import { MessageParam } from '@anthropic-ai/sdk/resources';
import { ToolManager } from '../../tools/tool-manager.js';
import { ILLMService, LLMServiceConfig } from './types.js';
import { ToolSet } from '../../tools/types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import { ContextManager } from '../../context/manager.js';
import { getMaxInputTokensForModel, getEffectiveMaxInputTokens } from '../registry.js';
import { ImageData, FileData } from '../../context/types.js';
import type { SessionEventBus } from '../../events/index.js';
import type { IConversationHistoryProvider } from '../../session/history/types.js';
import type { SystemPromptManager } from '../../systemPrompt/manager.js';
import { AnthropicMessageFormatter } from '../formatters/anthropic.js';
import { createTokenizer } from '../tokenizer/factory.js';
import type { ValidatedLLMConfig } from '../schemas.js';
import { shouldIncludeRawToolResult } from '../../utils/debug.js';
import { InstrumentClass } from '../../telemetry/decorators.js';
import { trace } from '@opentelemetry/api';

/**
 * Anthropic implementation of LLMService
 * Not actively maintained, so might be buggy or outdated
 * TODO (Telemetry): Add OpenTelemetry metrics collection
 *   - LLM call counters (by provider/model)
 *   - Token usage histograms (input/output/total)
 *   - Request latency histograms
 *   - Error rate counters
 *   See feature-plans/telemetry.md for details
 */
@InstrumentClass({
    prefix: 'llm.anthropic',
    excludeMethods: ['getAllTools', 'formatToolsForClaude', 'getConfig', 'getContextManager'],
})
export class AnthropicService implements ILLMService {
    private anthropic: Anthropic;
    private config: ValidatedLLMConfig;
    private toolManager: ToolManager;
    private contextManager: ContextManager<MessageParam>;
    private sessionEventBus: SessionEventBus;
    private readonly sessionId: string;
    private logger: IDextoLogger;

    constructor(
        toolManager: ToolManager,
        anthropic: Anthropic,
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
        this.anthropic = anthropic;
        this.toolManager = toolManager;
        this.sessionEventBus = sessionEventBus;
        this.sessionId = sessionId;

        // Create properly-typed ContextManager for Anthropic
        const formatter = new AnthropicMessageFormatter(this.logger);
        const tokenizer = createTokenizer(config.provider, config.model, this.logger);
        const maxInputTokens = getEffectiveMaxInputTokens(config, this.logger);

        // Use the provided ResourceManager

        this.contextManager = new ContextManager<MessageParam>(
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
        // Add user message with optional image and file data
        await this.contextManager.addUserMessage(textInput, imageData, fileData);

        // Get all tools
        const rawTools = await this.toolManager.getAllTools();
        const formattedTools = this.formatToolsForClaude(rawTools);

        this.logger.silly(`Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`);

        // Notify thinking
        this.sessionEventBus.emit('llmservice:thinking');

        let iterationCount = 0;
        let fullResponse = '';
        let totalTokens = 0;

        try {
            while (iterationCount < this.config.maxIterations) {
                if (options?.signal?.aborted) {
                    throw Object.assign(new Error('Aborted'), {
                        name: 'AbortError',
                        aborted: true,
                    });
                }
                iterationCount++;
                this.logger.debug(`Iteration ${iterationCount}`);

                // Use the new method that implements proper flow: get system prompt, compress history, format messages
                // For system prompt generation, we need to pass the mcpManager as the context expects

                const contributorContext = {
                    mcpManager: this.toolManager.getMcpManager(),
                };

                const llmContext = {
                    provider: this.config.provider,
                    model: this.config.model,
                };

                const {
                    formattedMessages,
                    systemPrompt: _systemPrompt,
                    tokensUsed,
                } = await this.contextManager.getFormattedMessagesWithCompression(
                    contributorContext,
                    llmContext
                );

                // For Anthropic, we need to get the formatted system prompt separately
                const formattedSystemPrompt =
                    await this.contextManager.getFormattedSystemPrompt(contributorContext);

                this.logger.debug(`Messages: ${JSON.stringify(formattedMessages, null, 2)}`);
                this.logger.debug(`Estimated tokens being sent to Anthropic: ${tokensUsed}`);

                // Get response with appropriate method
                const { message, usage } = stream
                    ? await this.getAnthropicStreamingResponse(
                          formattedMessages,
                          formattedSystemPrompt || null,
                          formattedTools,
                          options?.signal
                      )
                    : await this.getAnthropicResponse(
                          formattedMessages,
                          formattedSystemPrompt || null,
                          formattedTools,
                          options?.signal
                      );

                // Track token usage
                if (usage) {
                    totalTokens += usage.input_tokens + usage.output_tokens;
                }

                // Extract text content and tool uses from message
                let textContent = '';
                const toolUses = [];

                for (const content of message.content) {
                    if (content.type === 'text') {
                        textContent += content.text;
                    } else if (content.type === 'tool_use') {
                        toolUses.push(content);
                    }
                }

                // Process assistant message
                if (toolUses.length > 0) {
                    // Transform all tool uses into the format expected by ContextManager
                    const formattedToolCalls = toolUses.map((toolUse) => ({
                        id: toolUse.id,
                        type: 'function' as const,
                        function: {
                            name: toolUse.name,
                            arguments: JSON.stringify(toolUse.input),
                        },
                    }));

                    // Add assistant message with all tool calls
                    await this.contextManager.addAssistantMessage(textContent, formattedToolCalls, {
                        tokenUsage: totalTokens > 0 ? { totalTokens } : undefined,
                    });
                } else {
                    // Add regular assistant message
                    await this.contextManager.addAssistantMessage(textContent, undefined, {
                        tokenUsage: totalTokens > 0 ? { totalTokens } : undefined,
                    });
                }

                // If no tools were used, we're done
                if (toolUses.length === 0) {
                    fullResponse += textContent;

                    // Update ContextManager with actual token count for hybrid approach
                    if (totalTokens > 0) {
                        this.contextManager.updateActualTokenCount(totalTokens);
                    }

                    this.sessionEventBus.emit('llmservice:response', {
                        content: fullResponse,
                        provider: this.config.provider,
                        model: this.config.model,
                        router: 'in-built',
                        ...(totalTokens > 0 && { tokenUsage: { totalTokens } }),
                    });

                    // Add token usage to active span (if telemetry is enabled)
                    const activeSpan = trace.getActiveSpan();
                    if (activeSpan && totalTokens > 0) {
                        activeSpan.setAttributes({
                            'gen_ai.usage.total_tokens': totalTokens,
                        });
                    }

                    return fullResponse;
                }

                // If text content exists, append it to the full response
                if (textContent) {
                    fullResponse += textContent + '\n';
                }

                // Handle tool uses
                for (const toolUse of toolUses) {
                    if (options?.signal?.aborted) {
                        throw Object.assign(new Error('Aborted'), {
                            name: 'AbortError',
                            aborted: true,
                        });
                    }
                    const toolName = toolUse.name;
                    const args = toolUse.input as Record<string, unknown>;
                    const toolUseId = toolUse.id;

                    // Notify tool call
                    this.sessionEventBus.emit('llmservice:toolCall', {
                        toolName,
                        args,
                        callId: toolUseId,
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
                            toolUseId,
                            toolName,
                            result,
                            { success: true }
                        );

                        // Notify tool result
                        this.sessionEventBus.emit('llmservice:toolResult', {
                            toolName,
                            callId: toolUseId,
                            success: true,
                            sanitized,
                            ...(shouldIncludeRawToolResult() ? { rawResult: result } : {}),
                        });
                    } catch (error) {
                        // Handle tool execution error
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        this.logger.error(`Tool execution error for ${toolName}: ${errorMessage}`);

                        // Add error as tool result
                        const sanitized = await this.contextManager.addToolResult(
                            toolUseId,
                            toolName,
                            { error: errorMessage },
                            { success: false }
                        );

                        this.sessionEventBus.emit('llmservice:toolResult', {
                            toolName,
                            callId: toolUseId,
                            success: false,
                            sanitized,
                            ...(shouldIncludeRawToolResult()
                                ? { rawResult: { error: errorMessage } }
                                : {}),
                        });
                    }
                }

                // Continue to next iteration without additional thinking notification
            }

            // If we reached max iterations
            this.logger.warn(`Reached maximum iterations (${this.config.maxIterations}) for task.`);

            // Update ContextManager with actual token count for hybrid approach
            if (totalTokens > 0) {
                this.contextManager.updateActualTokenCount(totalTokens);
            }

            this.sessionEventBus.emit('llmservice:response', {
                content: fullResponse,
                provider: this.config.provider,
                model: this.config.model,
                router: 'in-built',
                ...(totalTokens > 0 && { tokenUsage: { totalTokens } }),
            });

            // Add token usage to active span (if telemetry is enabled)
            const activeSpan = trace.getActiveSpan();
            if (activeSpan && totalTokens > 0) {
                activeSpan.setAttributes({
                    'gen_ai.usage.total_tokens': totalTokens,
                });
            }

            return (
                fullResponse ||
                'Reached maximum number of tool call iterations without a final response.'
            );
        } catch (error) {
            if (
                error instanceof Error &&
                (error.name === 'AbortError' || (error as any).aborted === true)
            ) {
                throw error;
            }
            // Handle API errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error in Anthropic service API call: ${errorMessage}`, { error });

            this.sessionEventBus.emit('llmservice:error', {
                error: error instanceof Error ? error : new Error(errorMessage),
                context: 'Anthropic API call',
                recoverable: false,
            });
            return `Error processing request: ${errorMessage}`;
        }
    }

    /**
     * Get configuration information about the LLM service
     * @returns Configuration object with provider and model information
     */
    getConfig(): LLMServiceConfig {
        const configuredMaxInputTokens = this.contextManager.getMaxInputTokens();
        const modelMaxInputTokens = getMaxInputTokensForModel(
            this.config.provider,
            this.config.model
        );

        return {
            router: 'in-built',
            provider: this.config.provider,
            model: this.config.model,
            configuredMaxInputTokens: configuredMaxInputTokens,
            modelMaxInputTokens: modelMaxInputTokens,
        };
    }

    private formatToolsForClaude(tools: ToolSet): Anthropic.Tool[] {
        return Object.entries(tools).map(([toolName, tool]) => {
            const input_schema: {
                type: 'object';
                properties: Record<string, any>;
                required: string[];
            } = {
                type: 'object',
                properties: {},
                required: [],
            };

            // Map tool parameters to JSON Schema format
            if (tool.parameters) {
                // The actual parameters structure appears to be a JSON Schema object
                const jsonSchemaParams = tool.parameters as Record<string, any>;

                if (jsonSchemaParams.type === 'object' && jsonSchemaParams.properties) {
                    input_schema.properties = jsonSchemaParams.properties;
                    if (Array.isArray(jsonSchemaParams.required)) {
                        input_schema.required = jsonSchemaParams.required;
                    }
                } else {
                    this.logger.warn(
                        `Unexpected parameters format for tool ${toolName}:`,
                        jsonSchemaParams
                    );
                }
            } else {
                // Handle case where tool might have no parameters
                this.logger.debug(`Tool ${toolName} has no defined parameters.`);
            }

            return {
                name: toolName,
                description: tool.description || '',
                input_schema: input_schema,
            };
        });
    }

    private async getAnthropicResponse(
        formattedMessages: MessageParam[],
        formattedSystemPrompt: string | null,
        formattedTools: Anthropic.Tool[],
        signal?: AbortSignal
    ): Promise<{
        message: Anthropic.Messages.Message;
        usage?: Anthropic.Messages.Usage;
    }> {
        const response = await this.anthropic.messages.create(
            {
                model: this.config.model,
                messages: formattedMessages,
                ...(formattedSystemPrompt && { system: formattedSystemPrompt }),
                tools: formattedTools,
                max_tokens: this.config.maxOutputTokens ?? 4096,
                ...(this.config.temperature !== undefined && {
                    temperature: this.config.temperature,
                }),
            },
            signal ? { signal } : undefined
        );

        return { message: response, usage: response.usage };
    }

    private async getAnthropicStreamingResponse(
        formattedMessages: MessageParam[],
        formattedSystemPrompt: string | null,
        formattedTools: Anthropic.Tool[],
        signal?: AbortSignal
    ): Promise<{
        message: Anthropic.Messages.Message;
        usage?: Anthropic.Messages.Usage;
    }> {
        const stream = await this.anthropic.messages.create(
            {
                model: this.config.model,
                messages: formattedMessages,
                ...(formattedSystemPrompt && { system: formattedSystemPrompt }),
                tools: formattedTools,
                max_tokens: this.config.maxOutputTokens ?? 4096,
                ...(this.config.temperature !== undefined && {
                    temperature: this.config.temperature,
                }),
                stream: true,
            },
            signal ? { signal } : undefined
        );

        // Collect streaming response
        let content: Anthropic.Messages.ContentBlock[] = [];
        let usage: Anthropic.Messages.Usage | undefined;
        let textAccumulator = '';
        let jsonAccumulators: Record<number, string> = {}; // Track JSON for each content block

        for await (const chunk of stream) {
            if (signal?.aborted) {
                throw Object.assign(new Error('Aborted'), { name: 'AbortError', aborted: true });
            }
            if (chunk.type === 'content_block_start') {
                content.push(chunk.content_block);
                // Reset text accumulator for new blocks
                if (chunk.content_block.type === 'text') {
                    textAccumulator = '';
                } else if (chunk.content_block.type === 'tool_use') {
                    // Initialize JSON accumulator for tool use block
                    jsonAccumulators[chunk.index] = '';
                }
            } else if (chunk.type === 'content_block_delta') {
                if (chunk.delta.type === 'text_delta') {
                    textAccumulator += chunk.delta.text;
                    // Emit chunk event for real-time streaming
                    this.sessionEventBus.emit('llmservice:chunk', {
                        type: 'text',
                        content: chunk.delta.text,
                        isComplete: false,
                    });

                    // Update the text content block
                    const lastContent = content[content.length - 1];
                    if (lastContent && lastContent.type === 'text') {
                        lastContent.text = textAccumulator;
                    }
                } else if (chunk.delta.type === 'input_json_delta') {
                    // Accumulate JSON string for tool use input
                    const blockIndex = chunk.index;
                    if (!(blockIndex in jsonAccumulators)) {
                        jsonAccumulators[blockIndex] = '';
                    }

                    jsonAccumulators[blockIndex] += chunk.delta.partial_json || '';

                    // Update the tool use content block
                    const toolContent = content[blockIndex];
                    if (toolContent && toolContent.type === 'tool_use') {
                        // Try to parse the accumulated JSON
                        try {
                            const jsonStr = jsonAccumulators[blockIndex];
                            if (jsonStr) {
                                toolContent.input = JSON.parse(jsonStr);
                            }
                        } catch {
                            // JSON is still incomplete, keep accumulating
                            this.logger.debug(
                                `Accumulating JSON for tool ${toolContent.name}: ${jsonAccumulators[blockIndex]}`
                            );
                        }
                    }
                }
            } else if (chunk.type === 'message_delta' && chunk.usage) {
                usage = {
                    input_tokens: usage?.input_tokens || 0,
                    output_tokens: chunk.usage.output_tokens || 0,
                    cache_creation_input_tokens: usage?.cache_creation_input_tokens || null,
                    cache_read_input_tokens: usage?.cache_read_input_tokens || null,
                    cache_creation: usage?.cache_creation || null,
                    server_tool_use: usage?.server_tool_use || null,
                    service_tier: usage?.service_tier || null,
                };
            } else if (chunk.type === 'message_start' && chunk.message.usage) {
                usage = chunk.message.usage;
            }
        }

        // Emit completion chunk
        if (textAccumulator) {
            this.sessionEventBus.emit('llmservice:chunk', {
                type: 'text',
                content: '',
                isComplete: true,
            });
        }

        // Construct the final message
        const message: Anthropic.Messages.Message = {
            id: 'streaming_response',
            type: 'message',
            role: 'assistant',
            content,
            model: this.config.model,
            stop_reason: null,
            stop_sequence: null,
            usage: usage || {
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
                cache_creation: null,
                server_tool_use: null,
                service_tier: null,
            },
        };

        return { message, ...(usage && { usage }) };
    }

    /**
     * Get the context manager for external access
     */
    getContextManager(): ContextManager<unknown> {
        return this.contextManager;
    }
}
