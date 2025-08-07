import { InternalMessage } from './types.js';
import { ITokenizer } from '@core/llm/tokenizer/types.js';
import { logger } from '@core/logger/index.js';
import { validateModelFileSupport } from '@core/llm/registry.js';
import { LLMContext } from '@core/llm/types.js';

// Approximation for message format overhead
const DEFAULT_OVERHEAD_PER_MESSAGE = 4;

/**
 * Counts the total tokens in an array of InternalMessages using a provided tokenizer.
 * Includes an estimated overhead per message.
 *
 * NOTE: This function counts tokens on the raw InternalMessage history and has limitations:
 * 1. It does not account for provider-specific formatting (uses raw content).
 * 2. It ignores the token cost of images and files in multimodal messages (counts text only).
 * 3. The overhead is a fixed approximation.
 * For more accurate counting reflecting the final provider payload, use ContextManager.countTotalTokens().
 *
 * @param history The array of messages to count.
 * @param tokenizer The tokenizer instance to use for counting.
 * @param overheadPerMessage Optional overhead tokens per message. Defaults to 4.
 * @returns The total token count.
 * @throws Error if token counting fails within the tokenizer.
 */
export function countMessagesTokens(
    history: InternalMessage[],
    tokenizer: ITokenizer,
    overheadPerMessage: number = DEFAULT_OVERHEAD_PER_MESSAGE
): number {
    let total = 0;
    logger.debug(`Counting tokens for ${history.length} messages`);
    try {
        for (const message of history) {
            if (message.content) {
                if (typeof message.content === 'string') {
                    // Count string content directly
                    total += tokenizer.countTokens(message.content);
                } else if (Array.isArray(message.content)) {
                    // For multimodal array content, count text and approximate image/file parts
                    message.content.forEach((part) => {
                        if (part.type === 'text' && typeof part.text === 'string') {
                            total += tokenizer.countTokens(part.text);
                        } else if (part.type === 'image') {
                            // Approximate tokens for images: estimate ~1 token per 1KB or based on Base64 length
                            if (typeof part.image === 'string') {
                                // Base64 string length -> bytes -> tokens (~4 bytes per token)
                                const byteLength = Math.floor((part.image.length * 3) / 4);
                                total += Math.ceil(byteLength / 1024);
                            } else if (
                                part.image instanceof Uint8Array ||
                                part.image instanceof Buffer ||
                                part.image instanceof ArrayBuffer
                            ) {
                                const bytes =
                                    part.image instanceof ArrayBuffer
                                        ? part.image.byteLength
                                        : (part.image as Uint8Array).length;
                                total += Math.ceil(bytes / 1024);
                            }
                        } else if (part.type === 'file') {
                            // Approximate tokens for files: estimate ~1 token per 1KB or based on Base64 length
                            if (typeof part.data === 'string') {
                                // Base64 string length -> bytes -> tokens (~4 bytes per token)
                                const byteLength = Math.floor((part.data.length * 3) / 4);
                                total += Math.ceil(byteLength / 1024);
                            } else if (
                                part.data instanceof Uint8Array ||
                                part.data instanceof Buffer ||
                                part.data instanceof ArrayBuffer
                            ) {
                                const bytes =
                                    part.data instanceof ArrayBuffer
                                        ? part.data.byteLength
                                        : (part.data as Uint8Array).length;
                                total += Math.ceil(bytes / 1024);
                            }
                        }
                    });
                }
                // else: Handle other potential content types if necessary in the future
            }
            // Count tool calls
            if (message.toolCalls) {
                for (const call of message.toolCalls) {
                    if (call.function?.name) {
                        total += tokenizer.countTokens(call.function.name);
                    }
                    if (call.function?.arguments) {
                        total += tokenizer.countTokens(call.function.arguments);
                    }
                }
            }
            // Add overhead for the message itself
            total += overheadPerMessage;
        }
    } catch (error) {
        console.error('countMessagesTokens: Error counting tokens:', error);
        // Re-throw to indicate failure
        throw new Error(
            `Failed to count tokens: ${error instanceof Error ? error.message : String(error)}`
        );
    }
    return total;
}

/**
 * Extracts image data (base64 or URL) from an ImagePart or raw buffer.
 * @param imagePart The image part containing image data
 * @returns Base64-encoded string or URL string
 */
export function getImageData(imagePart: {
    image: string | Uint8Array | Buffer | ArrayBuffer | URL;
}): string {
    const { image } = imagePart;
    if (typeof image === 'string') {
        return image;
    } else if (image instanceof Buffer) {
        return image.toString('base64');
    } else if (image instanceof Uint8Array) {
        return Buffer.from(image).toString('base64');
    } else if (image instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(image)).toString('base64');
    } else if (image instanceof URL) {
        return image.toString();
    }
    console.warn('Unexpected image data type in getImageData:', typeof image);
    return '';
}

/**
 * Extracts file data (base64 or URL) from a FilePart or raw buffer.
 * @param filePart The file part containing file data
 * @returns Base64-encoded string or URL string
 */
export function getFileData(filePart: {
    data: string | Uint8Array | Buffer | ArrayBuffer | URL;
}): string {
    const { data } = filePart;
    if (typeof data === 'string') {
        return data;
    } else if (data instanceof Buffer) {
        return data.toString('base64');
    } else if (data instanceof Uint8Array) {
        return Buffer.from(data).toString('base64');
    } else if (data instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(data)).toString('base64');
    } else if (data instanceof URL) {
        return data.toString();
    }
    console.warn('Unexpected file data type in getFileData:', typeof data);
    return '';
}

/**
 * Filters message content based on LLM capabilities.
 * Removes unsupported file attachments while preserving supported content.
 * Uses model-specific validation when available, falls back to provider-level.
 * @param messages Array of internal messages to filter
 * @param config The LLM configuration (provider and optional model)
 * @returns Filtered messages with unsupported content removed
 */
export function filterMessagesByLLMCapabilities(
    messages: InternalMessage[],
    config: LLMContext
): InternalMessage[] {
    // Validate that both provider and model are provided
    if (!config.provider || !config.model) {
        throw new Error('Both provider and model are required for message filtering');
    }

    try {
        return messages.map((message) => {
            // Only filter user messages with array content (multimodal)
            if (message.role !== 'user' || !Array.isArray(message.content)) {
                return message;
            }

            const filteredContent = message.content.filter((part) => {
                // Keep text and image parts
                if (part.type === 'text' || part.type === 'image') {
                    return true;
                }

                // Filter file parts based on LLM capabilities
                if (part.type === 'file' && part.mimeType) {
                    const validation = validateModelFileSupport(
                        config.provider,
                        config.model,
                        part.mimeType
                    );
                    return validation.isSupported;
                }

                return true; // Keep unknown part types
            });

            // If all content was filtered out, add a placeholder text
            if (filteredContent.length === 0) {
                filteredContent.push({
                    type: 'text',
                    text: `[File attachment removed - not supported by ${config.model}]`,
                });
            }

            return {
                ...message,
                content: filteredContent,
            };
        });
    } catch (error) {
        // If filtering fails, return original messages to avoid breaking the flow
        console.warn('Failed to filter messages by LLM capabilities:', error);
        return messages;
    }
}
