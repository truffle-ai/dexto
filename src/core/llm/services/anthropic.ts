import Anthropic from '@anthropic-ai/sdk';
import { ToolManager } from '../../tools/tool-manager.js';
import { ILLMService, LLMServiceConfig } from './types.js';
import { ToolSet } from '../../tools/types.js';
import { logger } from '../../logger/index.js';
import { ContextManager } from '../../context/manager.js';
import { getMaxInputTokensForModel } from '../registry.js';
import { ImageData, FileData } from '../../context/types.js';
import type { SessionEventBus } from '../../events/index.js';

/**
 * Anthropic implementation of LLMService
 * Not actively maintained, so might be buggy or outdated
 */
export class AnthropicService implements ILLMService {
    private anthropic: Anthropic;
    private model: string;
    private toolManager: ToolManager;
    private contextManager: ContextManager;
    private sessionEventBus: SessionEventBus;
    private maxIterations: number;
    private readonly sessionId: string;

    constructor(
        toolManager: ToolManager,
        anthropic: Anthropic,
        sessionEventBus: SessionEventBus,
        contextManager: ContextManager,
        model: string,
        maxIterations: number = 10,
        sessionId: string
    ) {
        this.maxIterations = maxIterations;
        this.model = model;
        this.anthropic = anthropic;
        this.toolManager = toolManager;
        this.sessionEventBus = sessionEventBus;
        this.contextManager = contextManager;
        this.sessionId = sessionId;
    }

    getAllTools(): Promise<any> {
        return this.toolManager.getAllTools();
    }

    async completeTask(
        textInput: string,
        imageData?: ImageData,
        fileData?: FileData,
        _stream?: boolean
    ): Promise<string> {
        // Add user message with optional image and file data
        await this.contextManager.addUserMessage(textInput, imageData, fileData);

        // Get all tools
        const rawTools = await this.toolManager.getAllTools();
        const formattedTools = this.formatToolsForClaude(rawTools);

        logger.silly(`Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`);

        // Notify thinking
        this.sessionEventBus.emit('llmservice:thinking');

        let iterationCount = 0;
        let fullResponse = '';
        let totalTokens = 0;

        try {
            while (iterationCount < this.maxIterations) {
                iterationCount++;
                logger.debug(`Iteration ${iterationCount}`);

                // Use the new method that implements proper flow: get system prompt, compress history, format messages
                // For system prompt generation, we need to pass the mcpManager as the context expects

                const contributorContext = {
                    mcpManager: this.toolManager.getMcpManager(),
                };

                const llmContext = {
                    provider: 'anthropic' as const,
                    model: this.model,
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

                logger.debug(`Messages: ${JSON.stringify(formattedMessages, null, 2)}`);
                logger.debug(`Estimated tokens being sent to Anthropic: ${tokensUsed}`);

                const response = await this.anthropic.messages.create({
                    model: this.model,
                    messages: formattedMessages,
                    ...(formattedSystemPrompt && { system: formattedSystemPrompt }),
                    tools: formattedTools,
                    max_tokens: 4096,
                });

                // Track token usage
                if (response.usage) {
                    totalTokens += response.usage.input_tokens + response.usage.output_tokens;
                }

                // Extract text content and tool uses
                let textContent = '';
                const toolUses = [];

                for (const content of response.content) {
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
                    await this.contextManager.addAssistantMessage(textContent, formattedToolCalls);
                } else {
                    // Add regular assistant message
                    await this.contextManager.addAssistantMessage(textContent);
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
                        model: this.model,
                        tokenCount: totalTokens > 0 ? totalTokens : undefined,
                    });
                    return fullResponse;
                }

                // If text content exists, append it to the full response
                if (textContent) {
                    fullResponse += textContent + '\n';
                }

                // Handle tool uses
                for (const toolUse of toolUses) {
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
                        await this.contextManager.addToolResult(toolUseId, toolName, result);

                        // Notify tool result
                        this.sessionEventBus.emit('llmservice:toolResult', {
                            toolName,
                            result,
                            callId: toolUseId,
                            success: true,
                        });
                    } catch (error) {
                        // Handle tool execution error
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        logger.error(`Tool execution error for ${toolName}: ${errorMessage}`);

                        // Add error as tool result
                        await this.contextManager.addToolResult(toolUseId, toolName, {
                            error: errorMessage,
                        });

                        this.sessionEventBus.emit('llmservice:toolResult', {
                            toolName,
                            result: { error: errorMessage },
                            callId: toolUseId,
                            success: false,
                        });
                    }
                }

                // Notify thinking for next iteration
                this.sessionEventBus.emit('llmservice:thinking');
            }

            // If we reached max iterations
            logger.warn(`Reached maximum iterations (${this.maxIterations}) for task.`);

            // Update ContextManager with actual token count for hybrid approach
            if (totalTokens > 0) {
                this.contextManager.updateActualTokenCount(totalTokens);
            }

            this.sessionEventBus.emit('llmservice:response', {
                content: fullResponse,
                model: this.model,
                tokenCount: totalTokens > 0 ? totalTokens : undefined,
            });
            return (
                fullResponse ||
                'Reached maximum number of tool call iterations without a final response.'
            );
        } catch (error) {
            // Handle API errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Error in Anthropic service API call: ${errorMessage}`, { error });

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
        const modelMaxInputTokens = getMaxInputTokensForModel('anthropic', this.model);

        return {
            router: 'in-built',
            provider: 'anthropic',
            model: this.model,
            configuredMaxInputTokens: configuredMaxInputTokens,
            modelMaxInputTokens: modelMaxInputTokens,
        };
    }

    private formatToolsForClaude(tools: ToolSet): any[] {
        return Object.entries(tools).map(([toolName, tool]) => {
            const input_schema: { type: string; properties: any; required: string[] } = {
                type: 'object',
                properties: {},
                required: [],
            };

            // Map tool parameters to JSON Schema format
            if (tool.parameters) {
                // The actual parameters structure appears to be a JSON Schema object
                const jsonSchemaParams = tool.parameters as any;

                if (jsonSchemaParams.type === 'object' && jsonSchemaParams.properties) {
                    input_schema.properties = jsonSchemaParams.properties;
                    if (Array.isArray(jsonSchemaParams.required)) {
                        input_schema.required = jsonSchemaParams.required;
                    }
                } else {
                    logger.warn(
                        `Unexpected parameters format for tool ${toolName}:`,
                        jsonSchemaParams
                    );
                }
            } else {
                // Handle case where tool might have no parameters
                logger.debug(`Tool ${toolName} has no defined parameters.`);
            }

            return {
                name: toolName,
                description: tool.description,
                input_schema: input_schema,
            };
        });
    }
}
