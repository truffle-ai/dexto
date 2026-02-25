import type { ModelMessage, AssistantContent, ToolContent, ToolResultPart } from 'ai';
import { LLMContext } from '../types.js';
import type { InternalMessage, AssistantMessage, ToolMessage } from '../../context/types.js';
import { getImageData, getFileData, filterMessagesByLLMCapabilities } from '../../context/utils.js';
import type { Logger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';

/**
 * Checks if a string is a URL (http:// or https://).
 * Returns a URL object if it's a valid URL string, otherwise returns the original value.
 */
function toUrlIfString<T>(value: T): T | URL {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
        try {
            return new URL(value);
        } catch {
            // Invalid URL, return original string
            return value;
        }
    }
    return value;
}

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
export class VercelMessageFormatter {
    private logger: Logger;

    constructor(logger: Logger) {
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
            // For Anthropic/Bedrock/Vertex Claude, add cacheControl to enable prompt caching
            // This marks the system prompt as cacheable (ephemeral = cached for session duration)
            const modelLower = context.model.toLowerCase();
            const isClaudeModel = modelLower.includes('claude');
            const isAnthropicProvider =
                context.provider === 'anthropic' ||
                (context.provider === 'bedrock' && isClaudeModel) ||
                (context.provider === 'vertex' && isClaudeModel);

            formatted.push({
                role: 'system',
                content: systemPrompt,
                ...(isAnthropicProvider && {
                    providerOptions: {
                        anthropic: { cacheControl: { type: 'ephemeral' } },
                    },
                }),
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
                                                  data: toUrlIfString(part.data),
                                                  mediaType: part.mimeType, // Convert mimeType -> mediaType
                                                  ...(part.filename && { filename: part.filename }),
                                              };
                                          } else if (part.type === 'image') {
                                              return {
                                                  type: 'image' as const,
                                                  image: toUrlIfString(part.image),
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
                    formatted.push({
                        role: 'assistant',
                        ...this.formatAssistantMessage(msg, {
                            // OpenAI/OpenRouter reasoning items can require strict output-item replay.
                            // Keep those providers on "no reasoning replay" to avoid invalid_request errors.
                            // For other providers we continue to round-trip reasoning where available.
                            includeReasoning: this.shouldRoundTripReasoning(context),
                        }),
                    });
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

    private shouldRoundTripReasoning(context: LLMContext): boolean {
        return (
            context.provider !== 'openai' &&
            context.provider !== 'openai-compatible' &&
            context.provider !== 'openrouter' &&
            context.provider !== 'dexto-nova'
        );
    }

    // Helper to format Assistant messages (with optional tool calls and reasoning)
    private formatAssistantMessage(
        msg: AssistantMessage,
        config?: { includeReasoning?: boolean }
    ): {
        content: AssistantContent;
        function_call?: { name: string; arguments: string };
    } {
        const contentParts: AssistantContent = [];
        const includeReasoning = config?.includeReasoning ?? false;

        // Add reasoning part if present (for round-tripping extended thinking)
        //
        // Note: OpenAI Responses reasoning items are not safe to replay unless we also
        // round-trip the *following* output item IDs (the API enforces item ordering).
        // Dexto does not persist those output item IDs today, so we omit reasoning
        // content from OpenAI prompts to avoid invalid_request errors on follow-up turns.
        if (includeReasoning && msg.reasoning) {
            // Cast to AssistantContent element type - providerOptions is Record<string, JSONObject>
            // which is compatible with our Record<string, unknown> storage
            const reasoningPart = {
                type: 'reasoning' as const,
                text: msg.reasoning,
                ...(msg.reasoningMetadata && { providerOptions: msg.reasoningMetadata }),
            };
            contentParts.push(reasoningPart as (typeof contentParts)[number]);
        }

        // Add text content
        if (Array.isArray(msg.content)) {
            const combined = msg.content
                .map((part) => (part.type === 'text' ? part.text : ''))
                .filter(Boolean)
                .join('\n');
            if (combined) {
                contentParts.push({ type: 'text', text: combined });
            }
        } else if (typeof msg.content === 'string') {
            contentParts.push({ type: 'text', text: msg.content });
        }

        // Add tool calls if present
        if (msg.toolCalls && msg.toolCalls.length > 0) {
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
                // Include providerOptions if present (e.g., Gemini 3 thought signatures)
                const toolCallPart: (typeof contentParts)[number] = {
                    type: 'tool-call',
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    input: parsed,
                };
                // Pass through providerOptions for round-tripping (thought signatures, etc.)
                if (toolCall.providerOptions) {
                    (toolCallPart as { providerOptions?: unknown }).providerOptions =
                        toolCall.providerOptions;
                }
                contentParts.push(toolCallPart);
            }

            const firstToolCall = msg.toolCalls[0]!;
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

        return {
            content: contentParts.length > 0 ? contentParts : [],
        };
    }

    // Helper to format Tool result messages
    private formatToolMessage(msg: ToolMessage): { content: ToolContent } {
        let toolResultPart: ToolResultPart;
        if (Array.isArray(msg.content)) {
            if (msg.content[0]?.type === 'image') {
                const imagePart = msg.content[0];
                const imageDataBase64 = getImageData(imagePart, this.logger);
                toolResultPart = {
                    type: 'tool-result',
                    toolCallId: msg.toolCallId,
                    toolName: msg.name,
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
                    toolCallId: msg.toolCallId,
                    toolName: msg.name,
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
                    toolCallId: msg.toolCallId,
                    toolName: msg.name,
                    output: {
                        type: 'text',
                        value: textContent,
                    },
                };
            }
        } else {
            toolResultPart = {
                type: 'tool-result',
                toolCallId: msg.toolCallId,
                toolName: msg.name,
                output: {
                    type: 'text',
                    value: String(msg.content || ''),
                },
            };
        }
        return { content: [toolResultPart] };
    }
}
