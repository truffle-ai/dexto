import { ChatCompletionMessageParam, ChatCompletionContentPart } from 'openai/resources';
import { IMessageFormatter } from './types.js';
import { LLMContext } from '../types.js';
import { InternalMessage } from '@core/context/types.js';
import {
    getImageData,
    filterMessagesByLLMCapabilities,
    toTextForToolMessage,
} from '@core/context/utils.js';
import type { IDextoLogger } from '@core/logger/v2/types.js';
import { DextoLogComponent } from '@core/logger/v2/types.js';

/**
 * Message formatter for OpenAI's Chat Completion API.
 *
 * Converts the internal message format to OpenAI's specific structure:
 * - System prompt is included in the messages array
 * - Tool calls use the tool_calls property with a structure matching OpenAI's API
 * - Tool results use the 'tool' role with tool_call_id and name
 */
export class OpenAIMessageFormatter implements IMessageFormatter {
    private logger: IDextoLogger;

    constructor(logger: IDextoLogger) {
        this.logger = logger.createChild(DextoLogComponent.LLM);
    }
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
    ): ChatCompletionMessageParam[] {
        // Returns OpenAI-specific type
        const formatted: ChatCompletionMessageParam[] = [];

        // Apply model-aware capability filtering
        let filteredHistory: InternalMessage[];
        try {
            filteredHistory = filterMessagesByLLMCapabilities([...history], context, this.logger);
        } catch (error) {
            this.logger.warn(
                `Failed to apply capability filtering, using original history: ${error}`
            );
            filteredHistory = [...history];
        }

        // Add system message if provided
        if (systemPrompt) {
            formatted.push({
                role: 'system',
                content: systemPrompt,
            });
        }

        // Track pending tool calls to detect orphans (tool calls without results)
        const pendingToolCallIds = new Set<string>();

        for (const msg of filteredHistory) {
            switch (msg.role) {
                case 'system':
                    // We already handled the systemPrompt, but if there are additional
                    // system messages in the history, add them
                    formatted.push({
                        role: 'system',
                        content: String(msg.content || ''),
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
                            content: String(msg.content || ''),
                            tool_calls: msg.toolCalls,
                        });
                        // Track these tool call IDs as pending
                        for (const toolCall of msg.toolCalls) {
                            pendingToolCallIds.add(toolCall.id);
                        }
                    } else {
                        formatted.push({
                            role: 'assistant',
                            content: String(msg.content || ''),
                        });
                    }
                    break;

                case 'tool':
                    // Tool results for OpenAI — only text field is supported.
                    // Only add if we've seen the corresponding tool call
                    if (msg.toolCallId && pendingToolCallIds.has(msg.toolCallId)) {
                        formatted.push({
                            role: 'tool',
                            content: toTextForToolMessage(msg.content),
                            tool_call_id: msg.toolCallId,
                        });
                        // Remove from pending since we found its result
                        pendingToolCallIds.delete(msg.toolCallId);
                    } else {
                        // Orphaned tool result (result without matching call)
                        // Skip it to prevent API errors - can't send result without corresponding call
                        this.logger.warn(
                            `Skipping orphaned tool result ${msg.toolCallId} (no matching tool call found) - cannot send to OpenAI without corresponding tool_calls`
                        );
                    }
                    break;
            }
        }

        // Add synthetic error results for any orphaned tool calls
        // This can happen when CLI crashes/interrupts before tool execution completes
        if (pendingToolCallIds.size > 0) {
            for (const toolCallId of pendingToolCallIds) {
                formatted.push({
                    role: 'tool',
                    content:
                        'Error: Tool execution was interrupted (session crashed or cancelled before completion)',
                    tool_call_id: toolCallId,
                });
                this.logger.warn(
                    `Tool call ${toolCallId} had no matching tool result - added synthetic error result to prevent API errors`
                );
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

    // Helper to format user message parts (text + image + file) into chat API shape
    private formatUserContent(
        content: InternalMessage['content']
    ): string | ChatCompletionContentPart[] {
        if (!Array.isArray(content)) {
            return String(content || '');
        }

        const parts = content
            .map((part): ChatCompletionContentPart | null => {
                if (part.type === 'text') {
                    return { type: 'text', text: part.text };
                }
                if (part.type === 'image') {
                    const raw = getImageData(part, this.logger);
                    const url =
                        raw.startsWith('http://') ||
                        raw.startsWith('https://') ||
                        raw.startsWith('data:')
                            ? raw
                            : `data:${part.mimeType || 'application/octet-stream'};base64,${raw}`;
                    return { type: 'image_url', image_url: { url } };
                }
                if (part.type === 'file') {
                    // Transform FilePart to OpenAI's expected File format
                    // Note: This is a simplified conversion - OpenAI expects file_data (base64) or file_id
                    const fileData = typeof part.data === 'string' ? part.data : undefined;
                    return {
                        type: 'file' as const,
                        file: {
                            ...(fileData && { file_data: fileData }),
                            ...(part.filename && { filename: part.filename }),
                        },
                    };
                }
                return null;
            })
            .filter((part): part is ChatCompletionContentPart => part !== null);

        return parts;
    }
}
