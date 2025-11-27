import type {
    ModelMessage,
    AssistantContent,
    ToolContent,
    ToolResultPart,
    TextPart as VercelTextPart,
    ImagePart as VercelImagePart,
    FilePart as VercelFilePart,
    ToolCallPart,
} from 'ai';
import { IMessageFormatter } from './types.js';
import { LLMContext } from '../types.js';
import { InternalMessage } from '@core/context/types.js';
import type { GenerateTextResult, StreamTextResult, ToolSet as VercelToolSet } from 'ai';
import { getImageData, getFileData, filterMessagesByLLMCapabilities } from '@core/context/utils.js';
import type { IDextoLogger } from '@core/logger/v2/types.js';
import { DextoLogComponent } from '@core/logger/v2/types.js';

/**
 * Message formatter for Vercel AI SDK.
 *
 * Converts the internal message format to Vercel's specific structure:
 * - System prompt is included in the messages array
 * - Tool calls use function_call property instead of tool_calls
 * - Tool results use the 'tool' role (SDK v5)
 *
 * Note: Vercel's implementation is different from OpenAI's standard,
 * particularly in its handling of function calls and responses.
 */
export class VercelMessageFormatter implements IMessageFormatter {
    private logger: IDextoLogger;

    constructor(logger: IDextoLogger) {
        this.logger = logger.createChild(DextoLogComponent.LLM);
    }
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
            filteredHistory = filterMessagesByLLMCapabilities([...history], context, this.logger);

            const modelInfo = `${context.provider}/${context.model}`;
            this.logger.debug(`Applied Vercel filtering for ${modelInfo}`);
        } catch (error) {
            this.logger.warn(
                `Failed to apply capability filtering, using original history: ${error}`
            );
            filteredHistory = [...history];
        }

        // Add system message if present
        if (systemPrompt) {
            formatted.push({
                role: 'system',
                content: systemPrompt,
            });
        }

        // Track pending tool calls to detect orphans (tool calls without results)
        // Map stores toolCallId -> toolName for proper synthetic result generation
        const pendingToolCalls = new Map<string, string>();

        for (const msg of filteredHistory) {
            switch (msg.role) {
                case 'user':
                    // Images (and text) in user content arrays are handled natively
                    // by the Vercel SDK. We can forward the array of TextPart/ImagePart directly.
                    if (msg.content !== null) {
                        // Convert internal content types to AI SDK types
                        // Filter out UIResourcePart - these are for UI rendering, not LLM processing
                        const content =
                            typeof msg.content === 'string'
                                ? msg.content
                                : msg.content
                                      .filter((part) => part.type !== 'ui-resource')
                                      .map((part) => {
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
                                                  ...(part.mimeType && {
                                                      mediaType: part.mimeType,
                                                  }), // Convert mimeType -> mediaType
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
                    // Track tool call IDs and names as pending
                    if (msg.toolCalls && msg.toolCalls.length > 0) {
                        for (const toolCall of msg.toolCalls) {
                            pendingToolCalls.set(toolCall.id, toolCall.function.name);
                        }
                    }
                    break;

                case 'tool':
                    // Only add if we've seen the corresponding tool call
                    if (msg.toolCallId && pendingToolCalls.has(msg.toolCallId)) {
                        formatted.push({ role: 'tool', ...this.formatToolMessage(msg) });
                        // Remove from pending since we found its result
                        pendingToolCalls.delete(msg.toolCallId);
                    } else {
                        // Orphaned tool result (result without matching call)
                        // Skip it to prevent API errors - can't send result without corresponding call
                        this.logger.warn(
                            `Skipping orphaned tool result ${msg.toolCallId} (no matching tool call found) - cannot send to Vercel AI SDK without corresponding tool-call`
                        );
                    }
                    break;
            }
        }

        // Add synthetic error results for any orphaned tool calls
        // This can happen when CLI crashes/interrupts before tool execution completes
        if (pendingToolCalls.size > 0) {
            for (const [toolCallId, toolName] of pendingToolCalls.entries()) {
                // Vercel AI SDK uses tool-result content parts with output property
                formatted.push({
                    role: 'tool',
                    content: [
                        {
                            type: 'tool-result',
                            toolCallId: toolCallId,
                            toolName: toolName,
                            output: {
                                type: 'text',
                                value: 'Error: Tool execution was interrupted (session crashed or cancelled before completion)',
                            },
                            isError: true,
                        } as ToolResultPart,
                    ],
                });
                this.logger.warn(
                    `Tool call ${toolCallId} (${toolName}) had no matching tool result - added synthetic error result to prevent API errors`
                );
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
        const internal = this.parseResponse(
            adaptedResponse as GenerateTextResult<VercelToolSet, unknown>
        );

        // Attach final reasoning, usage, and model, if available, to the last assistant message
        const lastAssistant = [...internal].reverse().find((m) => m.role === 'assistant');
        if (lastAssistant) {
            const usage = await response.totalUsage;
            const reasoningText = await response.reasoningText;
            if (reasoningText) {
                lastAssistant.reasoning = reasoningText;
            }
            if (usage) {
                lastAssistant.tokenUsage = {
                    ...(usage.inputTokens !== undefined && { inputTokens: usage.inputTokens }),
                    ...(usage.outputTokens !== undefined && { outputTokens: usage.outputTokens }),
                    ...(usage.reasoningTokens !== undefined && {
                        reasoningTokens: usage.reasoningTokens,
                    }),
                    ...(usage.totalTokens !== undefined && { totalTokens: usage.totalTokens }),
                };
            }
            // provider/router/model is enriched by ContextManager from current config
        }
        return internal;
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
                    } else if (Array.isArray(msg.content)) {
                        const srcParts = msg.content as Array<
                            VercelTextPart | VercelImagePart | VercelFilePart
                        >;
                        const parts = srcParts.map((p) => {
                            if (p.type === 'text') return { type: 'text', text: p.text } as const;
                            if (p.type === 'image')
                                return {
                                    type: 'image',
                                    image: p.image,
                                    mimeType: p.mediaType ?? 'image/jpeg',
                                } as const;
                            if (p.type === 'file')
                                return {
                                    type: 'file',
                                    data: p.data,
                                    mimeType: p.mediaType,
                                    filename: p.filename,
                                } as const;
                            return { type: 'text', text: JSON.stringify(p) } as const;
                        });
                        internal.push({
                            role: 'user',
                            content: parts as InternalMessage['content'],
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

        // Attach final reasoning, usage, and model, if available, to the last assistant message
        const lastAssistant = [...internal].reverse().find((m) => m.role === 'assistant');
        const anyResp = response;
        const usage = anyResp.totalUsage;
        const reasoningText = anyResp.reasoningText;
        const modelId = response.response?.modelId;
        if (lastAssistant) {
            if (typeof reasoningText === 'string' && reasoningText.length > 0) {
                lastAssistant.reasoning = reasoningText;
            }
            if (usage) {
                lastAssistant.tokenUsage = {
                    ...(usage.inputTokens !== undefined && { inputTokens: usage.inputTokens }),
                    ...(usage.outputTokens !== undefined && { outputTokens: usage.outputTokens }),
                    ...(usage.reasoningTokens !== undefined && {
                        reasoningTokens: usage.reasoningTokens,
                    }),
                    ...(usage.totalTokens !== undefined && { totalTokens: usage.totalTokens }),
                };
            }
            if (modelId) {
                lastAssistant.model = modelId;
            }
            // Router is enriched by ContextManager from current config
        }
        return internal;
    }

    // Helper to format Assistant messages (with optional tool calls)
    // TODO: improve typing when InternalMessage type is updated
    private formatAssistantMessage(msg: InternalMessage): {
        content: AssistantContent;
        function_call?: { name: string; arguments: string };
    } {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
            const contentParts: AssistantContent = [];
            if (typeof msg.content === 'string' && msg.content.length > 0) {
                contentParts.push({ type: 'text', text: msg.content });
            } else if (Array.isArray(msg.content)) {
                // Robustness: if assistant content is accidentally an array, extract text parts
                const combined = msg.content
                    .map((part) => (part.type === 'text' ? part.text : ''))
                    .filter(Boolean)
                    .join('\n');
                if (combined) {
                    contentParts.push({ type: 'text', text: combined });
                }
            }
            for (const toolCall of msg.toolCalls) {
                const rawArgs = toolCall.function.arguments;
                let parsed: unknown = {};
                if (typeof rawArgs === 'string') {
                    try {
                        parsed = JSON.parse(rawArgs);
                    } catch {
                        parsed = {};
                        this.logger.warn(
                            `Vercel formatter: invalid tool args JSON for ${toolCall.function.name}`
                        );
                    }
                } else {
                    parsed = rawArgs ?? {};
                }
                // AI SDK v5 expects 'input' for tool-call arguments (not 'args').
                contentParts.push({
                    type: 'tool-call',
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    input: parsed,
                });
            }
            const firstToolCall = msg.toolCalls?.[0];
            if (firstToolCall) {
                // Ensure function_call.arguments is always a valid JSON string
                const argString = (() => {
                    const raw = firstToolCall.function.arguments;
                    if (typeof raw === 'string') return raw;
                    try {
                        return JSON.stringify(raw ?? {});
                    } catch {
                        return '{}';
                    }
                })();
                return {
                    content: contentParts,
                    function_call: {
                        name: firstToolCall.function.name,
                        arguments: argString,
                    },
                };
            }
        }
        return {
            content:
                typeof msg.content === 'string'
                    ? [{ type: 'text', text: msg.content }]
                    : (msg.content as AssistantContent),
        };
    }

    /**
     * Parses raw ModelMessage[] into InternalMessage[] for mid-loop compression.
     * This is used by prepareStep to convert SDK messages before applying compression.
     * Unlike parseResponse, this works directly on messages without needing a response wrapper.
     *
     * @param messages Array of Vercel ModelMessage to parse
     * @returns Array of InternalMessage (excluding system messages which are handled separately)
     */
    parseMessages(messages: ModelMessage[]): InternalMessage[] {
        const internal: InternalMessage[] = [];

        for (const msg of messages) {
            const role = msg.role as string;
            switch (role) {
                case 'system':
                    // Skip system messages - they're handled separately
                    break;

                case 'user':
                    if (typeof msg.content === 'string') {
                        internal.push({
                            role: 'user',
                            content: [{ type: 'text', text: msg.content }],
                        });
                    } else if (Array.isArray(msg.content)) {
                        const srcParts = msg.content as Array<
                            VercelTextPart | VercelImagePart | VercelFilePart
                        >;
                        const parts = srcParts.map((p) => {
                            if (p.type === 'text') return { type: 'text', text: p.text } as const;
                            if (p.type === 'image')
                                return {
                                    type: 'image',
                                    image: p.image,
                                    mimeType: p.mediaType ?? 'image/jpeg',
                                } as const;
                            if (p.type === 'file')
                                return {
                                    type: 'file',
                                    data: p.data,
                                    mimeType: p.mediaType,
                                    filename: p.filename,
                                } as const;
                            return { type: 'text', text: JSON.stringify(p) } as const;
                        });
                        internal.push({
                            role: 'user',
                            content: parts as InternalMessage['content'],
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
                                const toolCallPart = part as ToolCallPart;
                                calls.push({
                                    id: toolCallPart.toolCallId,
                                    type: 'function',
                                    function: {
                                        name: toolCallPart.toolName,
                                        arguments:
                                            typeof toolCallPart.input === 'string'
                                                ? toolCallPart.input
                                                : JSON.stringify(toolCallPart.input),
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
                                const toolResultPart = part as ToolResultPart;
                                let content: InternalMessage['content'];
                                // Handle the LanguageModelV2ToolResultOutput structure
                                const output = toolResultPart.output;
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
                                    toolCallId: toolResultPart.toolCallId,
                                    name: toolResultPart.toolName,
                                });
                            }
                        }
                    }
                    break;

                default:
                    // ignore unknown roles
                    break;
            }
        }

        return internal;
    }

    // Helper to format Tool result messages
    private formatToolMessage(msg: InternalMessage): { content: ToolContent } {
        let toolResultPart: ToolResultPart;
        if (Array.isArray(msg.content)) {
            if (msg.content[0]?.type === 'image') {
                const imagePart = msg.content[0];
                const imageDataBase64 = getImageData(imagePart, this.logger);
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
                const fileDataBase64 = getFileData(filePart, this.logger);
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
