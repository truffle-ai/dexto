import Anthropic from '@anthropic-ai/sdk';
import { ClientManager } from '../../client/manager.js';
import { ILLMService } from './types.js';
import { ToolSet } from '../types.js';
import { logger } from '../../utils/logger.js';
import { EventEmitter } from 'events';
/**
 * Anthropic implementation of LLMService
 */
export class AnthropicService implements ILLMService {
    private anthropic: Anthropic;
    private model: string;
    private clientManager: ClientManager;
    private messages: any[] = [];
    private systemContext: string = '';
    private eventEmitter: EventEmitter;
    constructor(
        clientManager: ClientManager,
        systemPrompt: string,
        apiKey: string,
        model?: string
    ) {
        this.model = model || 'claude-3-7-sonnet-20250219';
        this.anthropic = new Anthropic({ apiKey });
        this.clientManager = clientManager;
        this.systemContext = systemPrompt;
        this.eventEmitter = new EventEmitter();
    }

    getEventEmitter(): EventEmitter {
        return this.eventEmitter;
    }

    getAllTools(): Promise<any> {
        return this.clientManager.getAllTools();
    }

    updateSystemContext(newSystemPrompt: string): void {
        this.systemContext = newSystemPrompt;
    }

    async completeTask(userInput: string): Promise<string> {
        // Prepend system context to first message or use standalone
        const effectiveUserInput =
            this.messages.length === 0 ? `${this.systemContext}\n\n${userInput}` : userInput;

        // Add user message
        this.messages.push({ role: 'user', content: effectiveUserInput });

        // Get all tools
        const rawTools = await this.clientManager.getAllTools();
        const formattedTools = this.formatToolsForClaude(rawTools);

        logger.silly(`Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`);

        // Notify thinking
        this.eventEmitter.emit('thinking');

        // Maximum number of tool use iterations
        const MAX_ITERATIONS = 10;
        let iterationCount = 0;
        let fullResponse = '';

        try {
            while (iterationCount < MAX_ITERATIONS) {
                iterationCount++;
                logger.debug(`Iteration ${iterationCount}`);

                logger.debug(`Messages: ${JSON.stringify(this.messages, null, 2)}`);

                const response = await this.anthropic.messages.create({
                    model: this.model,
                    messages: this.messages,
                    tools: formattedTools,
                    max_tokens: 4096,
                });

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

                // Add response to the conversation
                this.messages.push({
                    role: 'assistant',
                    content: response.content,
                });

                // If no tools were used, we're done
                if (toolUses.length === 0) {
                    fullResponse += textContent;
                    this.eventEmitter.emit('response', fullResponse);
                    return fullResponse;
                }

                // If text content exists, append it to the full response
                if (textContent) {
                    fullResponse += textContent + '\n';
                }

                // Handle tool uses
                const toolResults = [];

                for (const toolUse of toolUses) {
                    const toolName = toolUse.name;
                    const args = toolUse.input;
                    const toolUseId = toolUse.id; // Capture the tool use ID

                    // Notify tool call
                    this.eventEmitter.emit('toolCall', toolName, args);

                    // Execute tool
                    try {
                        const result = await this.clientManager.executeTool(toolName, args);
                        toolResults.push({ toolName, result, toolUseId }); // Store the ID with the result

                        // Notify tool result
                        this.eventEmitter.emit('toolResult', toolName, result);
                    } catch (error) {
                        // Handle tool execution error
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        toolResults.push({ toolName, error: errorMessage, toolUseId }); // Store the ID with the error

                        this.eventEmitter.emit('toolResult', toolName, { error: errorMessage });
                    }
                }

                // Add tool results as a single user message with properly formatted tool_result objects
                if (toolResults.length > 0) {
                    // Helper function to extract text from tool results
                    const extractTextContent = (result: any): string => {
                        // If it's a string, return as-is
                        if (typeof result === 'string') {
                            return result;
                        }

                        // Check for the specific structure {"content":[{"type":"text","text":"..."}]}
                        if (result && Array.isArray(result.content)) {
                            // Extract all text entries and join them
                            const textEntries = result.content
                                .filter((item) => item.type === 'text' && item.text)
                                .map((item) => item.text);

                            if (textEntries.length > 0) {
                                return textEntries.join('\n');
                            }
                        }

                        // For other object structures, stringify them
                        return JSON.stringify(result);
                    };

                    const contentArray = toolResults.map(({ _, result, error, toolUseId }) => {
                        const resultValue = error ? `Error: ${error}` : extractTextContent(result);

                        return {
                            type: 'tool_result',
                            tool_use_id: toolUseId,
                            content: resultValue,
                        };
                    });

                    this.messages.push({
                        role: 'user',
                        content: contentArray,
                    });
                }

                // Notify thinking for next iteration
                this.eventEmitter.emit('thinking');
            }

            // If we reached max iterations
            this.eventEmitter.emit('response', fullResponse);
            return (
                fullResponse ||
                'Reached maximum number of tool call iterations without a final response.'
            );
        } catch (error) {
            // Handle API errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Error in Anthropic service: ${errorMessage}`);

            this.eventEmitter.emit(
                'error',
                error instanceof Error ? error : new Error(errorMessage)
            );
            return `Error: ${errorMessage}`;
        }
    }

    resetConversation(): void {
        // Clear all messages
        this.messages = [];
        this.eventEmitter.emit('conversationReset');
    }

    /**
     * Get configuration information about the LLM service
     * @returns Configuration object with provider and model information
     */
    getConfig(): { provider: string; model: string; [key: string]: any } {
        return {
            provider: 'anthropic',
            model: this.model,
        };
    }

    // needs refactor
    private formatToolsForClaude(tools: ToolSet): any[] {
        // Convert the ToolSet object to an array of tools
        // ToolSet is an object where keys are tool names and values are Tool objects
        return Object.entries(tools).map(([toolName, tool]) => {
            // Create input_schema structure (same as parameters in OpenAI)
            const input_schema = {
                type: 'object',
                properties: {},
                required: [],
            };

            // Map tool parameters to JSON Schema format
            if (tool.parameters) {
                // The actual parameters structure appears to be a JSON Schema object
                // which doesn't match the simple ToolParameters interface
                const jsonSchemaParams = tool.parameters as any;

                if (
                    jsonSchemaParams.properties &&
                    typeof jsonSchemaParams.properties === 'object'
                ) {
                    // Extract parameters from the properties object
                    for (const [name, paramRaw] of Object.entries(jsonSchemaParams.properties)) {
                        // Type assertion to make TypeScript happy
                        const param = paramRaw as any;
                        let paramType = param.type || 'string';
                        let paramEnum = undefined;

                        // Handle type conversion
                        if (typeof paramType === 'string') {
                            if (paramType.includes('number')) paramType = 'number';
                            else if (paramType.includes('boolean')) paramType = 'boolean';
                            else if (paramType.includes('array')) paramType = 'array';
                            else if (paramType.includes('enum')) {
                                paramType = 'string';
                                // Extract enum values if they exist
                                const enumMatch = paramType.match(/\[(.*?)\]/);
                                if (enumMatch) {
                                    paramEnum = enumMatch[1]
                                        .split(',')
                                        .map((v) => v.trim().replace(/["']/g, ''));
                                }
                            }
                        }

                        input_schema.properties[name] = {
                            type: paramType,
                            description: param.description || `The ${name} parameter`,
                        };

                        // Add items property for array types
                        if (paramType === 'array') {
                            // Use the items property from the original schema if it exists
                            if (param.items) {
                                input_schema.properties[name].items = param.items;
                            } else {
                                // Default to array of strings if no items specification is provided
                                input_schema.properties[name].items = { type: 'string' };
                            }
                        }

                        // Handle enums if present
                        if (paramEnum) {
                            input_schema.properties[name].enum = paramEnum;
                        }
                    }

                    // Use the required array from inputSchema if it exists
                    if (Array.isArray(jsonSchemaParams.required)) {
                        input_schema.required = [...jsonSchemaParams.required];
                    }
                }
            }

            logger.silly('AFTER FORMATTING TOOL FOR ANTHROPIC');
            logger.silly(`Tool: ${toolName}`);
            logger.silly(`Description: ${tool.description}`);
            logger.silly(`Input Schema: ${JSON.stringify(input_schema)}`);

            // Return in Anthropic's expected format
            return {
                name: toolName,
                description: tool.description || `Tool for ${toolName}`,
                input_schema: input_schema,
            };
        });
    }
}
