import { IMessageFormatter } from './types.js';
import { LLMContext } from '../types.js';
import { InternalMessage } from '@core/context/types.js';
import type { GenerateTextResult, StreamTextResult, ToolSet as VercelToolSet } from 'ai';
import { getImageData, getFileData, filterMessagesByLLMCapabilities } from '@core/context/utils.js';
import { logger } from '@core/logger/index.js';
// import Core SDK types if/when needed

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
    ): unknown[] {
        const formatted = [];

        // Apply model-aware capability filtering for Vercel
        let filteredHistory: InternalMessage[];
        try {
            if (!context?.provider) {
                logger.error(`Context: ${JSON.stringify(context)}`);
                throw new Error('Provider is required for Vercel formatter context');
            }

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
                case 'system':
                    // Images (and text) in user/system content arrays are handled natively
                    // by the Vercel SDK. We can forward the array of TextPart/ImagePart directly.
                    formatted.push({
                        role: msg.role,
                        content: msg.content,
                    });
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
                                            typeof part.args === 'string'
                                                ? part.args
                                                : JSON.stringify(part.args),
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
                                if (Array.isArray(part.experimental_content)) {
                                    content = part.experimental_content.map((img: unknown) => {
                                        const imgData = img as { data?: string; mimeType?: string };
                                        return {
                                            type: 'image',
                                            image: imgData.data || '',
                                            mimeType: imgData.mimeType || 'image/jpeg',
                                        };
                                    });
                                } else {
                                    // Ensure result is a string for InternalMessage.content
                                    const raw = part.result;
                                    content =
                                        typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
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
    private formatAssistantMessage(msg: InternalMessage): {
        content: unknown;
        function_call?: { name: string; arguments: string };
    } {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
            const contentParts: unknown[] = [];
            if (msg.content) {
                contentParts.push({ type: 'text', text: msg.content });
            }
            for (const toolCall of msg.toolCalls) {
                contentParts.push({
                    type: 'tool-call',
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    args:
                        typeof toolCall.function.arguments === 'string'
                            ? JSON.parse(toolCall.function.arguments)
                            : toolCall.function.arguments,
                });
            }
            const firstToolCall = msg.toolCalls?.[0];
            if (firstToolCall) {
                return {
                    content: contentParts,
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
        return { content: msg.content };
    }

    // Helper to format Tool result messages
    private formatToolMessage(msg: InternalMessage): { content: unknown[] } {
        let toolResultPart: unknown;
        if (Array.isArray(msg.content)) {
            if (msg.content[0]?.type === 'image') {
                const imagePart = msg.content[0];
                const imageDataBase64 = getImageData(imagePart);
                toolResultPart = {
                    type: 'tool-result',
                    toolCallId: msg.toolCallId!,
                    toolName: msg.name!,
                    result: null,
                    experimental_content: [
                        { type: 'image', data: imageDataBase64, mimeType: imagePart.mimeType },
                    ],
                };
            } else if (msg.content[0]?.type === 'file') {
                const filePart = msg.content[0];
                const fileDataBase64 = getFileData(filePart);
                toolResultPart = {
                    type: 'tool-result',
                    toolCallId: msg.toolCallId!,
                    toolName: msg.name!,
                    result: null,
                    experimental_content: [
                        {
                            type: 'file',
                            data: fileDataBase64,
                            mimeType: filePart.mimeType,
                            filename: filePart.filename,
                        },
                    ],
                };
            } else {
                toolResultPart = {
                    type: 'tool-result',
                    toolCallId: msg.toolCallId!,
                    toolName: msg.name!,
                    result: msg.content,
                };
            }
        } else {
            toolResultPart = {
                type: 'tool-result',
                toolCallId: msg.toolCallId!,
                toolName: msg.name!,
                result: msg.content,
            };
        }
        return { content: [toolResultPart] };
    }
}
