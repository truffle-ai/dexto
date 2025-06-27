import { IMessageFormatter } from './types.js';
import { InternalMessage } from '../types.js';
import type { GenerateTextResult, StreamTextResult } from 'ai';
import { getImageData } from '../utils.js';
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
    format(history: Readonly<InternalMessage[]>, systemPrompt: string | null): any[] {
        const formatted = [];

        // Add system message if present
        if (systemPrompt) {
            formatted.push({
                role: 'system',
                content: systemPrompt,
            });
        }

        for (const msg of history) {
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
    async parseStreamResponse(response: StreamTextResult<any, any>): Promise<InternalMessage[]> {
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
        return this.parseResponse(adaptedResponse as GenerateTextResult<any, any>);
    }

    /**
     * Parses raw Vercel SDK response into internal message objects.
     * TODO: Break this into smaller functions
     */
    parseResponse(response: GenerateTextResult<any, any>): InternalMessage[] {
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
                    const assistantMessage: any = {
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
                                    content = part.experimental_content.map((img: any) => ({
                                        type: 'image',
                                        image: img.data,
                                        mimeType: img.mimeType,
                                    }));
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
        content: any;
        function_call?: { name: string; arguments: string };
    } {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
            const contentParts: any[] = [];
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
    private formatToolMessage(msg: InternalMessage): { content: any[] } {
        let toolResultPart: any;
        if (Array.isArray(msg.content) && msg.content[0]?.type === 'image') {
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
