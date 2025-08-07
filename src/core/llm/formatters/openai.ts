import { IMessageFormatter } from './types.js';
import { LLMContext } from '../types.js';
import { InternalMessage } from '@core/context/types.js';
import { getImageData, getFileData, filterMessagesByLLMCapabilities } from '@core/context/utils.js';
import { logger } from '@core/logger/index.js';

/**
 * Message formatter for OpenAI's Chat Completion API.
 *
 * Converts the internal message format to OpenAI's specific structure:
 * - System prompt is included in the messages array
 * - Tool calls use the tool_calls property with a structure matching OpenAI's API
 * - Tool results use the 'tool' role with tool_call_id and name
 */
export class OpenAIMessageFormatter implements IMessageFormatter {
    /**
     * Formats internal messages into OpenAI's Chat Completion API format
     *
     * @param history Array of internal messages to format
     * @param systemPrompt System prompt to include at the beginning of messages
     * @returns Array of messages formatted for OpenAI's API
     */
    format(
        history: Readonly<InternalMessage[]>,
        context: LLMContext,
        systemPrompt: string | null
    ): unknown[] {
        const formatted = [];

        // Apply model-aware capability filtering
        let filteredHistory: InternalMessage[];
        try {
            if (!context?.provider) {
                throw new Error('Provider is required for OpenAI formatter context');
            }

            filteredHistory = filterMessagesByLLMCapabilities([...history], context);
        } catch (error) {
            logger.warn(`Failed to apply capability filtering, using original history: ${error}`);
            filteredHistory = [...history];
        }

        // Add system message if provided
        if (systemPrompt) {
            formatted.push({
                role: 'system',
                content: systemPrompt,
            });
        }

        for (const msg of filteredHistory) {
            switch (msg.role) {
                case 'system':
                    // We already handled the systemPrompt, but if there are additional
                    // system messages in the history, add them
                    formatted.push({
                        role: 'system',
                        content: msg.content,
                    });
                    break;

                case 'user':
                    formatted.push({
                        role: 'user',
                        content: this.formatUserContent(msg.content),
                    });
                    break;

                case 'assistant':
                    // Assistant messages may or may not have tool calls
                    if (msg.toolCalls && msg.toolCalls.length > 0) {
                        formatted.push({
                            role: 'assistant',
                            content: msg.content,
                            tool_calls: msg.toolCalls,
                        });
                    } else {
                        formatted.push({
                            role: 'assistant',
                            content: msg.content,
                        });
                    }
                    break;

                case 'tool':
                    // Tool results for OpenAI
                    formatted.push({
                        role: 'tool',
                        content: msg.content,
                        tool_call_id: msg.toolCallId,
                        name: msg.name,
                    });
                    break;
            }
        }

        return formatted;
    }

    /**
     * OpenAI handles system prompts in the messages array
     * This method returns null since the system prompt is already
     * included directly in the formatted messages.
     *
     * @returns null as OpenAI doesn't need a separate system prompt
     */
    formatSystemPrompt(): null {
        return null;
    }

    /**
     * Parses OpenAI API response into internal message objects.
     */
    parseResponse(response: unknown): InternalMessage[] {
        const internal: InternalMessage[] = [];
        const typedResponse = response as { choices?: unknown[] };
        if (!typedResponse.choices || !Array.isArray(typedResponse.choices)) return internal;
        for (const choice of typedResponse.choices) {
            const msg = (choice as any).message;
            if (!msg || !msg.role) continue;
            const role = msg.role as InternalMessage['role'];
            // Assistant messages
            if (role === 'assistant') {
                const content = msg.content ?? null;
                // Handle tool calls if present
                if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                    const calls = msg.tool_calls.map((call: unknown) => {
                        const typedCall = call as any; // Type assertion for complex API response structure
                        return {
                            id: typedCall.id,
                            type: 'function' as const,
                            function: {
                                name: typedCall.function.name,
                                arguments: typedCall.function.arguments,
                            },
                        };
                    });
                    internal.push({ role: 'assistant', content, toolCalls: calls });
                } else {
                    internal.push({ role: 'assistant', content });
                }
            }
            // Tool result messages
            else if (role === 'tool') {
                internal.push({
                    role: 'tool',
                    content: msg.content!,
                    toolCallId: msg.tool_call_id!,
                    name: msg.name!,
                });
            }
            // User or system messages (rare in responses)
            else if (role === 'user' || role === 'system') {
                if (msg.content) {
                    internal.push({ role, content: msg.content });
                }
            }
        }
        return internal;
    }

    // Helper to format user message parts (text + image + file) into chat API shape
    private formatUserContent(content: InternalMessage['content']): unknown {
        if (!Array.isArray(content)) {
            return content;
        }
        return content
            .map((part) => {
                if (part.type === 'text') {
                    return { type: 'text', text: part.text };
                }
                if (part.type === 'image') {
                    const raw = getImageData(part);
                    const url =
                        raw.startsWith('http://') ||
                        raw.startsWith('https://') ||
                        raw.startsWith('data:')
                            ? raw
                            : `data:${part.mimeType || 'application/octet-stream'};base64,${raw}`;
                    return { type: 'image_url', image_url: { url } };
                }
                if (part.type === 'file') {
                    const raw = getFileData(part);
                    const url =
                        raw.startsWith('http://') ||
                        raw.startsWith('https://') ||
                        raw.startsWith('data:')
                            ? raw
                            : `data:${part.mimeType || 'application/octet-stream'};base64,${raw}`;
                    return { type: 'file_url', file_url: { url } };
                }
                return null;
            })
            .filter(Boolean);
    }
}
