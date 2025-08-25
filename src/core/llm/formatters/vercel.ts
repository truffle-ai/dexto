import type { ModelMessage, AssistantContent, ToolContent, ToolResultPart } from 'ai';
import { IMessageFormatter } from './types.js';
import { LLMContext } from '../types.js';
import { InternalMessage } from '@core/context/types.js';
import type { GenerateTextResult, StreamTextResult, ToolSet as VercelToolSet } from 'ai';
import { getImageData, getFileData, filterMessagesByLLMCapabilities } from '@core/context/utils.js';
import { logger } from '@core/logger/index.js';

/**
 * Message formatter for Vercel AI SDK.
 *
 * Converts the internal message format to Vercel's specific structure:
 * - System prompt is included in the messages array
 * - Tool calls use function_call property instead of tool_calls
 * - Tool results use the 'function' role instead of 'tool'
 *
 * Note: Vercel's implementation is different from OpenAI's standard,
 * particularly in its handling of function calls and responses.
 */
export class VercelMessageFormatter implements IMessageFormatter {
    /**
     * Formats internal messages into Vercel AI SDK format
     *
     * @param history Array of internal messages to format
     * @param systemPrompt System prompt to include at the beginning of messages
     * @returns Array of messages formatted for Vercel's API
     */
    format(
        history: Readonly<InternalMessage[]>,
        context: LLMContext,
        systemPrompt: string | null
    ): ModelMessage[] {
        // Returns Vercel-specific type
        const formatted: ModelMessage[] = [];

        // Apply model-aware capability filtering for Vercel
        let filteredHistory: InternalMessage[];
        try {
            filteredHistory = filterMessagesByLLMCapabilities([...history], context);

            const modelInfo = `${context.provider}/${context.model}`;
            logger.debug(`Applied Vercel filtering for ${modelInfo}`);
        } catch (error) {
            logger.warn(`Failed to apply capability filtering, using original history: ${error}`);
            filteredHistory = [...history];
        }

        // Add system message if present
        if (systemPrompt) {
            formatted.push({
                role: 'system',
                content: systemPrompt,
            });
        }

        for (const msg of filteredHistory) {
            switch (msg.role) {
                case 'user':
                    // Images (and text) in user content arrays are handled natively
                    // by the Vercel SDK. We can forward the array of TextPart/ImagePart directly.
                    if (msg.content !== null) {
                        // Convert internal content types to AI SDK types
                        const content =
                            typeof msg.content === 'string'
                                ? msg.content
                                : msg.content.map((part) => {
                                      if (part.type === 'file') {
                                          return {
                                              type: 'file' as const,
                                              data: part.data,
                                              mediaType: part.mimeType, // Convert mimeType -> mediaType
                                              ...(part.filename && { filename: part.filename }),
                                          };
                                      } else if (part.type === 'image') {
                                          return {
                                              type: 'image' as const,
                                              image: part.image,
                                              ...(part.mimeType && { mediaType: part.mimeType }), // Convert mimeType -> mediaType
                                          };
                                      }
                                      return part; // TextPart doesn't need conversion
                                  });

                        formatted.push({
                            role: 'user',
                            content,
                        });
                    }
                    break;

                case 'system':
                    // System messages
                    if (msg.content !== null) {
                        formatted.push({
                            role: 'system',
                            content: String(msg.content),
                        });
                    }
                    break;

                case 'assistant':
                    formatted.push({ role: 'assistant', ...this.formatAssistantMessage(msg) });
                    break;

                case 'tool':
                    formatted.push({ role: 'tool', ...this.formatToolMessage(msg) });
                    break;
            }
        }

        return formatted;
    }

    /**
     * Vercel handles system prompts in the messages array
     * This method returns null since the system prompt is already
     * included directly in the formatted messages.
     *
     * @returns null as Vercel doesn't need a separate system prompt
     */
    formatSystemPrompt(): null {
        return null;
    }

    /**
     * Parses raw Vercel SDK stream response into internal message objects.
     * This handles StreamTextResult which has different structure than GenerateTextResult
     */
    async parseStreamResponse(
        response: StreamTextResult<VercelToolSet, unknown>
    ): Promise<InternalMessage[]> {
        // For streaming, we need to wait for the response to complete
        // and then access the messages from the resolved promise
        const resolvedResponse = await response.response;

        // Convert the structure to match what parseResponse expects
        const adaptedResponse = {
            response: {
                messages: resolvedResponse?.messages || [],
            },
        };

        // Reuse the existing parseResponse logic
        return this.parseResponse(adaptedResponse as GenerateTextResult<VercelToolSet, unknown>);
    }

    /**
     * Parses raw Vercel SDK response into internal message objects.
     * TODO: Break this into smaller functions
     */
    parseResponse(response: GenerateTextResult<VercelToolSet, unknown>): InternalMessage[] {
        const internal: InternalMessage[] = [];
        if (!response.response.messages) return internal;
        for (const msg of response.response.messages) {
            const role = msg.role as InternalMessage['role'];
            switch (role) {
                case 'user':
                    if (typeof msg.content === 'string') {
                        internal.push({
                            role: 'user',
                            content: [{ type: 'text', text: msg.content }],
                        });
                    }
                    break;
                case 'assistant': {
                    let text: string | null = null;
                    const calls: InternalMessage['toolCalls'] = [];
                    if (typeof msg.content === 'string') {
                        text = msg.content;
                    } else if (Array.isArray(msg.content)) {
                        let combined = '';
                        for (const part of msg.content) {
                            if (part.type === 'text') {
                                combined += part.text;
                            } else if (part.type === 'tool-call') {
                                calls.push({
                                    id: part.toolCallId,
                                    type: 'function',
                                    function: {
                                        name: part.toolName,
                                        arguments:
                                            typeof part.input === 'string'
                                                ? part.input
                                                : JSON.stringify(part.input),
                                    },
                                });
                            }
                        }
                        text = combined || null;
                    }
                    const assistantMessage: InternalMessage = {
                        role: 'assistant',
                        content: text,
                    };
                    if (calls.length > 0) {
                        assistantMessage.toolCalls = calls;
                    }
                    internal.push(assistantMessage);
                    break;
                }
                case 'tool':
                    if (Array.isArray(msg.content)) {
                        for (const part of msg.content) {
                            if (part.type === 'tool-result') {
                                let content: InternalMessage['content'];
                                // Handle the new LanguageModelV2ToolResultOutput structure
                                const output = part.output;
                                if (output.type === 'content') {
                                    content = output.value.map((item) => {
                                        if (item.type === 'media') {
                                            return {
                                                type: 'image',
                                                image: item.data,
                                                mimeType: item.mediaType,
                                            };
                                        } else {
                                            return {
                                                type: 'text',
                                                text: item.text,
                                            };
                                        }
                                    });
                                } else if (output.type === 'text' || output.type === 'error-text') {
                                    content = output.value;
                                } else if (output.type === 'json' || output.type === 'error-json') {
                                    content = JSON.stringify(output.value);
                                } else {
                                    content = JSON.stringify(output);
                                }
                                internal.push({
                                    role: 'tool',
                                    content,
                                    toolCallId: part.toolCallId,
                                    name: part.toolName,
                                });
                            }
                        }
                    }
                    break;
                default:
                    // ignore system or unknown
                    break;
            }
        }
        return internal;
    }

    // Helper to format Assistant messages (with optional tool calls)
    // Todo: improve typingwhen InternalMessage type is updated
    private formatAssistantMessage(msg: InternalMessage): {
        content: AssistantContent;
        function_call?: { name: string; arguments: string };
    } {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
            const contentParts = [];
            if (msg.content) {
                contentParts.push({ type: 'text', text: msg.content });
            }
            for (const toolCall of msg.toolCalls) {
                const rawArgs = toolCall.function.arguments;
                let parsed: any = {};
                if (typeof rawArgs === 'string') {
                    try {
                        parsed = JSON.parse(rawArgs);
                    } catch {
                        parsed = {};
                        logger.warn(
                            `Vercel formatter: invalid tool args JSON for ${toolCall.function.name}`
                        );
                    }
                } else {
                    parsed = rawArgs;
                }
                contentParts.push({
                    type: 'tool-call',
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    args: parsed,
                });
            }
            const firstToolCall = msg.toolCalls?.[0];
            if (firstToolCall) {
                return {
                    content: contentParts as AssistantContent,
                    function_call: {
                        name: firstToolCall.function.name,
                        arguments:
                            typeof firstToolCall.function.arguments === 'string'
                                ? firstToolCall.function.arguments
                                : JSON.stringify(firstToolCall.function.arguments),
                    },
                };
            }
        }
        return { content: msg.content as AssistantContent };
    }

    // Helper to format Tool result messages
    private formatToolMessage(msg: InternalMessage): { content: ToolContent } {
        let toolResultPart: ToolResultPart;
        if (Array.isArray(msg.content)) {
            if (msg.content[0]?.type === 'image') {
                const imagePart = msg.content[0];
                const imageDataBase64 = getImageData(imagePart);
                toolResultPart = {
                    type: 'tool-result',
                    toolCallId: msg.toolCallId!,
                    toolName: msg.name!,
                    output: {
                        type: 'content',
                        value: [
                            {
                                type: 'media',
                                data: imageDataBase64,
                                mediaType: imagePart.mimeType || 'image/jpeg',
                            },
                        ],
                    },
                };
            } else if (msg.content[0]?.type === 'file') {
                const filePart = msg.content[0];
                const fileDataBase64 = getFileData(filePart);
                toolResultPart = {
                    type: 'tool-result',
                    toolCallId: msg.toolCallId!,
                    toolName: msg.name!,
                    output: {
                        type: 'content',
                        value: [
                            {
                                type: 'media',
                                data: fileDataBase64,
                                mediaType: filePart.mimeType,
                            },
                        ],
                    },
                };
            } else {
                const textContent = Array.isArray(msg.content)
                    ? msg.content
                          .map((part) => (part.type === 'text' ? part.text : JSON.stringify(part)))
                          .join('\n')
                    : String(msg.content);
                toolResultPart = {
                    type: 'tool-result',
                    toolCallId: msg.toolCallId!,
                    toolName: msg.name!,
                    output: {
                        type: 'text',
                        value: textContent,
                    },
                };
            }
        } else {
            toolResultPart = {
                type: 'tool-result',
                toolCallId: msg.toolCallId!,
                toolName: msg.name!,
                output: {
                    type: 'text',
                    value: String(msg.content || ''),
                },
            };
        }
        return { content: [toolResultPart] };
    }
}
