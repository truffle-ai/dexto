import { MCPClientManager } from '../../../client/manager.js';
import { ILLMService, LLMServiceConfig } from './types.js';
import { logger } from '../../../logger/index.js';
import { streamText, generateText, CoreMessage, LanguageModelV1 } from 'ai';
import { ToolSet } from '../../types.js';
import { ToolSet as VercelToolSet, jsonSchema } from 'ai';
import { EventEmitter } from 'events';
import { MessageManager } from '../messages/manager.js';
import { getMaxTokensForModel } from '../registry.js';
import { ImageData } from '../messages/types.js';
import { ModelNotFoundError } from '../errors.js';

/**
 * Vercel implementation of LLMService
 */
export class VercelLLMService implements ILLMService {
    private model: LanguageModelV1;
    private provider: string;
    private clientManager: MCPClientManager;
    private messageManager: MessageManager;
    private eventEmitter: EventEmitter;
    private maxIterations: number;

    constructor(
        clientManager: MCPClientManager,
        model: LanguageModelV1,
        provider: string,
        agentEventBus: EventEmitter,
        messageManager: MessageManager,
        maxIterations: number
    ) {
        this.maxIterations = maxIterations;
        this.model = model;
        this.clientManager = clientManager;
        this.eventEmitter = agentEventBus;
        this.provider = provider;
        this.messageManager = messageManager;
        logger.debug(
            `[VercelLLMService] Initialized for model: ${this.model.modelId}, provider: ${this.provider}, messageManager: ${this.messageManager}`
        );
    }

    getAllTools(): Promise<ToolSet> {
        return this.clientManager.getAllTools();
    }

    formatTools(tools: ToolSet): VercelToolSet {
        logger.debug(`Formatting tools for vercel`);
        return Object.keys(tools).reduce<VercelToolSet>((acc, toolName) => {
            acc[toolName] = {
                description: tools[toolName].description,
                parameters: jsonSchema(tools[toolName].parameters as any),
                execute: async (args: any) => {
                    return await this.clientManager.executeTool(toolName, args);
                },
            };
            return acc;
        }, {});
    }

    async completeTask(userInput: string, imageData?: ImageData): Promise<string> {
        // Add user message, with optional image data
        this.messageManager.addUserMessage(userInput, imageData);

        // Get all tools
        const tools: any = await this.clientManager.getAllTools();
        logger.silly(
            `[VercelLLMService] Tools before formatting: ${JSON.stringify(tools, null, 2)}`
        );

        const formattedTools = this.formatTools(tools);
        logger.silly(
            `[VercelLLMService] Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`
        );

        let iterationCount = 0;
        let fullResponse = '';

        try {
            while (iterationCount < 1) {
                this.eventEmitter.emit('llmservice:thinking');
                iterationCount++;
                logger.debug(`Iteration ${iterationCount}`);

                // Get formatted messages from message manager
                const formattedMessages = await this.messageManager.getFormattedMessages({
                    clientManager: this.clientManager,
                });

                logger.debug(
                    `Messages (potentially compressed): ${JSON.stringify(formattedMessages, null, 2)}`
                );
                logger.silly(`Tools: ${JSON.stringify(formattedTools, null, 2)}`);

                // Estimate tokens before sending (optional)
                const currentTokens = this.messageManager.getTokenCount();
                logger.debug(`Estimated tokens being sent to Vercel provider: ${currentTokens}`);

                // Choose between generateText or processStream
                // generateText waits for the full response, processStream handles chunks
                fullResponse = await this.generateText(
                    formattedMessages,
                    formattedTools,
                    this.maxIterations
                );
                // OR
                // fullResponse = await this.processStream(formattedMessages, formattedTools, MAX_ITERATIONS);
            }

            return (
                fullResponse ||
                'Reached maximum number of tool call iterations without a final response.'
            );
        } catch (error) {
            // Handle API errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Error in Vercel LLM service execution: ${errorMessage}`, { error });
            // Hint for token overflow
            logger.warn(
                `Possible token overflow encountered. If due to exceeding model's token limit, configure 'maxTokens' in your LLMConfig.`
            );
            this.eventEmitter.emit(
                'llmservice:error',
                error instanceof Error ? error : new Error(errorMessage)
            );
            return `Error processing request: ${errorMessage}`;
        }
    }

    async generateText(
        messages: CoreMessage[],
        tools: VercelToolSet,
        maxSteps: number = 50
    ): Promise<string> {
        let stepIteration = 0;

        const response = await generateText({
            model: this.model,
            messages: messages,
            tools,
            onStepFinish: (step) => {
                logger.debug(`Step iteration: ${stepIteration}`);
                stepIteration++;
                logger.debug(`Step finished, step type: ${step.stepType}`);
                logger.debug(`Step finished, step text: ${step.text}`);
                logger.debug(
                    `Step finished, step tool calls: ${JSON.stringify(step.toolCalls, null, 2)}`
                );
                logger.debug(
                    `Step finished, step tool results: ${JSON.stringify(step.toolResults, null, 2)}`
                );

                if (step.text) {
                    this.eventEmitter.emit('llmservice:response', step.text);
                }
                // Emit events based on step content (kept from original)
                if (step.toolCalls && step.toolCalls.length > 0) {
                    for (const toolCall of step.toolCalls) {
                        this.eventEmitter.emit(
                            'llmservice:toolCall',
                            toolCall.toolName,
                            toolCall.args
                        );
                    }
                }
                if (step.toolResults && step.toolResults.length > 0) {
                    for (const toolResult of step.toolResults as any) {
                        this.eventEmitter.emit(
                            'llmservice:toolResult',
                            toolResult.toolName,
                            toolResult.result
                        );
                    }
                }
                // NOTE: Message manager additions are now handled after generateText completes
            },
            maxSteps: maxSteps,
        });

        // Parse and append each new InternalMessage from the formatter using MessageManager
        this.messageManager.processLLMResponse(response);
        // Return the plain text of the response
        return response.text;
    }

    async processStream(
        messages: CoreMessage[],
        tools: VercelToolSet,
        maxSteps: number = 10
    ): Promise<string> {
        const stream = await this.streamText(messages, tools, maxSteps);
        let fullResponse = '';
        for await (const textPart of stream) {
            fullResponse += textPart;
            // this.eventEmitter.emit('chunk', textPart);
        }

        // Add final assistant message, might not be needed
        this.messageManager.addAssistantMessage(fullResponse);

        this.eventEmitter.emit('llmservice:response', fullResponse);
        return fullResponse;
    }

    // returns AsyncIterable<string> & ReadableStream<string>
    async streamText(
        messages: CoreMessage[],
        tools: VercelToolSet,
        maxSteps: number = 10
    ): Promise<any> {
        let stepIteration = 0;
        // use vercel's streamText with mcp
        const response = streamText({
            model: this.model,
            messages: messages,
            tools,
            onChunk: (chunk) => {
                logger.debug(`Chunk type: ${chunk.chunk.type}`);
                if (chunk.chunk.type === 'text-delta') {
                    this.eventEmitter.emit('llmservice:chunk', chunk.chunk.textDelta);
                }
            },
            onError: (error) => {
                logger.error(`Error in streamText: ${JSON.stringify(error, null, 2)}`);
                this.eventEmitter.emit(
                    'llmservice:error',
                    error instanceof Error ? error : new Error(String(error))
                );
            },
            onStepFinish: (step) => {
                logger.debug(`Step iteration: ${stepIteration}`);
                stepIteration++;
                logger.debug(`Step finished, step type: ${step.stepType}`);
                logger.debug(`Step finished, step text: ${step.text}`);
                logger.debug(
                    `Step finished, step tool calls: ${JSON.stringify(step.toolCalls, null, 2)}`
                );
                logger.debug(
                    `Step finished, step tool results: ${JSON.stringify(step.toolResults, null, 2)}`
                );

                // Process tool calls
                if (step.toolCalls && step.toolCalls.length > 0) {
                    // Don't add assistant message with tool calls to history
                    // Just emit the events
                    for (const toolCall of step.toolCalls) {
                        this.eventEmitter.emit(
                            'llmservice:toolCall',
                            toolCall.toolName,
                            toolCall.args
                        );
                    }
                }

                // Process tool results
                if (step.stepType === 'tool-result' && step.toolResults) {
                    for (const toolResult of step.toolResults as any) {
                        // Don't add tool results to message manager
                        // Just emit the events
                        this.eventEmitter.emit(
                            'llmservice:toolResult',
                            toolResult.toolName,
                            toolResult.result
                        );
                    }
                }
            },
            onFinish: (result) => {
                logger.debug(`Stream finished, result finishReason: ${result.finishReason}`);
                logger.debug(`Stream finished, result text: ${result.text}`);
                logger.debug(
                    `Stream finished, result tool calls: ${JSON.stringify(result.toolCalls, null, 2)}`
                );
                logger.debug(
                    `Stream finished, result tool results: ${JSON.stringify(
                        result.toolResults,
                        null,
                        2
                    )}`
                );
            },
            maxSteps: maxSteps,
            // maxTokens: this.maxTokens,
            // temperature: this.temperature,
        });

        logger.silly(`streamText response object: ${JSON.stringify(response, null, 2)}`);

        // Return the textStream part for processStream to iterate over
        return response.textStream;
    }

    resetConversation(): void {
        this.messageManager.reset();
        this.eventEmitter.emit('llmservice:conversationReset');
    }

    /**
     * Get configuration information about the LLM service
     * @returns Configuration object with provider and model information
     */
    getConfig(): LLMServiceConfig {
        const configuredMaxTokens = this.messageManager.getMaxTokens();
        let modelMaxTokens: number;

        // Fetching max tokens from LLM registry - default to configured max tokens if not found
        // Max tokens may not be found if the model is supplied by user
        try {
            modelMaxTokens = getMaxTokensForModel(this.provider, this.model.modelId);
        } catch (error) {
            // if the model is not found in the LLM registry, log and default to configured max tokens
            if (error instanceof ModelNotFoundError) {
                modelMaxTokens = configuredMaxTokens;
                logger.debug(
                    `Could not find model ${this.model.modelId} in LLM registry to get max tokens. Using configured max tokens: ${configuredMaxTokens}.`
                );
                // for any other error, throw
            } else {
                throw error;
            }
        }
        return {
            router: 'vercel',
            provider: `${this.provider}`,
            model: this.model,
            configuredMaxTokens: configuredMaxTokens,
            modelMaxTokens,
        };
    }
}
