import type { ModelMessage, AssistantContent, ToolResultPart } from 'ai';
import type { LLMContext } from '@dexto/llm';
import type {
    InternalMessage,
    AssistantMessage,
    ToolMessage,
    FilePart,
} from '../../context/types.js';
import {
    getImageData,
    getFileData,
    filterMessagesByLLMCapabilities,
    parseDataUri,
} from '../../context/utils.js';
import type { Logger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';

type RemoteToolMedia =
    | { type: 'image'; image: URL; mediaType: string }
    | { type: 'file'; data: URL; mediaType: string; filename?: string };

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

function normalizeToolMediaData(data: string): string | null {
    const dataUri = parseDataUri(data);
    if (dataUri) return dataUri.base64;

    if (/^https?:\/\//i.test(data) || data.startsWith('blob:') || data.startsWith('@blob:')) {
        return null;
    }

    return data;
}

function isTextLikeMimeType(mimeType: string): boolean {
    const normalized = mimeType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
    if (normalized.startsWith('text/')) return true;
    if (normalized.endsWith('+json') || normalized.endsWith('+xml')) return true;

    return [
        'application/json',
        'application/ld+json',
        'application/xml',
        'application/yaml',
        'application/x-yaml',
        'application/toml',
        'application/x-toml',
        'application/javascript',
        'application/typescript',
        'application/x-sh',
        'application/sql',
    ].includes(normalized);
}

function isRemoteFileData(data: FilePart['data']): boolean {
    return (
        data instanceof URL ||
        (typeof data === 'string' &&
            (/^https?:\/\//i.test(data) || data.startsWith('blob:') || data.startsWith('@blob:')))
    );
}

function decodeLikelyBase64Text(value: string): string | null {
    const normalized = value.replace(/\s/g, '');
    if (
        normalized.length === 0 ||
        normalized.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
    ) {
        return null;
    }

    const decoded = Buffer.from(normalized, 'base64');
    const canonical = decoded.toString('base64').replace(/=+$/, '');
    if (canonical !== normalized.replace(/=+$/, '')) return null;

    const text = decoded.toString('utf8');
    const hasInvalidControlCharacter = [...text].some((char) => {
        const code = char.charCodeAt(0);
        return code < 32 && code !== 9 && code !== 10 && code !== 13;
    });
    if (text.includes('\uFFFD') || hasInvalidControlCharacter) {
        return null;
    }

    return text;
}

function decodeBase64Text(value: string): string {
    return Buffer.from(value.replace(/\s/g, ''), 'base64').toString('utf8');
}

function decodeTextFileData(data: FilePart['data']): string | null {
    if (data instanceof URL) return null;

    if (typeof data === 'string') {
        const dataUri = parseDataUri(data);
        if (dataUri) return decodeBase64Text(dataUri.base64);
        if (isRemoteFileData(data)) return null;

        // Bare strings can be valid plain text and valid base64 at the same time; explicit data
        // URIs avoid that ambiguity. For bare strings, decode only when the bytes look like text.
        return decodeLikelyBase64Text(data) ?? data;
    }

    return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString('utf8');
}

function filePartToText(part: FilePart): { type: 'text'; text: string } | null {
    if (!isTextLikeMimeType(part.mimeType) || isRemoteFileData(part.data)) return null;

    const text = decodeTextFileData(part.data);
    if (text === null) return null;

    const filename = part.filename ?? 'attachment';
    return {
        type: 'text',
        text: `Attached file "${filename}" (${part.mimeType}):\n\n${text}`,
    };
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
        let pendingRemoteToolMedia: RemoteToolMedia[] = [];

        const closePendingToolTurn = () => {
            for (const [toolCallId, toolName] of pendingToolCalls) {
                formatted.push({
                    role: 'tool',
                    content: [
                        {
                            type: 'tool-result',
                            toolCallId,
                            toolName,
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
            pendingToolCalls.clear();

            if (pendingRemoteToolMedia.length > 0) {
                formatted.push({ role: 'user', content: pendingRemoteToolMedia });
                pendingRemoteToolMedia = [];
            }
        };

        for (const msg of filteredHistory) {
            if (msg.role !== 'tool' && pendingToolCalls.size > 0) {
                closePendingToolTurn();
            }

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
                                      .filter(
                                          (part) =>
                                              part.type !== 'ui-resource' &&
                                              part.type !== 'resource'
                                      )
                                      .map((part) => {
                                          if (part.type === 'file') {
                                              const textPart = filePartToText(part);
                                              if (textPart) return textPart;

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
                        const toolResult = this.formatToolMessage(msg);
                        formatted.push(toolResult.message);
                        pendingRemoteToolMedia.push(...toolResult.remoteMedia);
                        // Remove from pending since we found its result
                        pendingToolCalls.delete(msg.toolCallId);
                        if (pendingToolCalls.size === 0 && pendingRemoteToolMedia.length > 0) {
                            formatted.push({ role: 'user', content: pendingRemoteToolMedia });
                            pendingRemoteToolMedia = [];
                        }
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

        closePendingToolTurn();

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
    private formatToolMessage(msg: ToolMessage): {
        message: ModelMessage;
        remoteMedia: RemoteToolMedia[];
    } {
        let toolResultPart: ToolResultPart;
        const remoteMedia: RemoteToolMedia[] = [];
        if (Array.isArray(msg.content)) {
            const content = msg.content
                .map((part) => {
                    if (part.type === 'text') {
                        return { type: 'text' as const, text: part.text };
                    }
                    if (part.type === 'image') {
                        const data = getImageData(part, this.logger);
                        if (/^https?:\/\//i.test(data)) {
                            remoteMedia.push({
                                type: 'image',
                                image: new URL(data),
                                mediaType: part.mimeType || 'image/jpeg',
                            });
                        }
                        const mediaData = normalizeToolMediaData(data);
                        if (!mediaData) {
                            return { type: 'text' as const, text: `Attached image: ${data}` };
                        }
                        return {
                            type: 'media' as const,
                            data: mediaData,
                            mediaType: part.mimeType || 'image/jpeg',
                        };
                    }
                    if (part.type === 'file') {
                        const data = getFileData(part, this.logger);
                        if (/^https?:\/\//i.test(data)) {
                            remoteMedia.push({
                                type: 'file',
                                data: new URL(data),
                                mediaType: part.mimeType,
                                ...(part.filename === undefined ? {} : { filename: part.filename }),
                            });
                        }
                        const mediaData = normalizeToolMediaData(data);
                        if (!mediaData) {
                            return { type: 'text' as const, text: `Attached file: ${data}` };
                        }
                        return {
                            type: 'media' as const,
                            data: mediaData,
                            mediaType: part.mimeType,
                        };
                    }
                    if (part.type === 'resource') {
                        return { type: 'text' as const, text: `${part.name}: ${part.uri}` };
                    }
                    return null;
                })
                .filter((part) => part !== null);

            if (content.some((part) => part.type === 'media')) {
                toolResultPart = {
                    type: 'tool-result',
                    toolCallId: msg.toolCallId,
                    toolName: msg.name,
                    output: {
                        type: 'content',
                        value: content,
                    },
                };
            } else {
                toolResultPart = {
                    type: 'tool-result',
                    toolCallId: msg.toolCallId,
                    toolName: msg.name,
                    output: {
                        type: 'text',
                        value:
                            content
                                .filter((part) => part.type === 'text')
                                .map((part) => part.text)
                                .join('\n') || '[empty result]',
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
        return {
            message: { role: 'tool', content: [toolResultPart] },
            remoteMedia,
        };
    }
}
