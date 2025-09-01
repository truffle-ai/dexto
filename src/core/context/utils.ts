import { InternalMessage, TextPart, ImagePart, FilePart } from './types.js';
import { ITokenizer } from '@core/llm/tokenizer/types.js';
import { logger } from '@core/logger/index.js';
import { validateModelFileSupport } from '@core/llm/registry.js';
import { LLMContext } from '@core/llm/types.js';
import { ContextError } from './errors.js';
import { safeStringify } from '@core/utils/safe-stringify.js';

// Tunable heuristics and shared constants
const DEFAULT_OVERHEAD_PER_MESSAGE = 4; // Approximation for message format overhead
const MIN_BASE64_HEURISTIC_LENGTH = 512; // Below this length, treat as regular text
const MAX_TOOL_TEXT_CHARS = 8000; // Truncate overly long tool text

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
                                if (isDataUri(part.image)) {
                                    // Extract base64 payload and compute byte length
                                    const base64Payload = extractBase64FromDataUri(part.image);
                                    const byteLength = base64LengthToBytes(base64Payload.length);
                                    total += Math.ceil(byteLength / 1024);
                                } else {
                                    // Treat as URL/text: estimate token cost based on string length
                                    total += estimateTextTokens(part.image);
                                }
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
                                if (isDataUri(part.data)) {
                                    // Extract base64 payload and compute byte length
                                    const base64Payload = extractBase64FromDataUri(part.data);
                                    const byteLength = base64LengthToBytes(base64Payload.length);
                                    total += Math.ceil(byteLength / 1024);
                                } else {
                                    // Treat as URL/text: estimate token cost based on string length
                                    total += estimateTextTokens(part.data);
                                }
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
        logger.error(
            `countMessagesTokens failed: ${error instanceof Error ? error.message : String(error)}`
        );
        // Re-throw to indicate failure
        throw ContextError.tokenCountFailed(error instanceof Error ? error.message : String(error));
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
    logger.warn(`Unexpected image data type in getImageData: ${typeof image}`);
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
    logger.warn(`Unexpected file data type in getFileData: ${typeof data}`);
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
        logger.warn(`Failed to filter messages by LLM capabilities: ${String(error)}`);
        return messages;
    }
}

/**
 * Detect if a string is likely a Base64 blob (not a typical sentence/text).
 * Uses a length threshold and character set heuristic.
 */
export function isLikelyBase64String(
    value: string,
    minLength: number = MIN_BASE64_HEURISTIC_LENGTH
): boolean {
    if (!value || value.length < minLength) return false;
    // Fast-path for data URIs which embed base64
    if (value.startsWith('data:') && value.includes(';base64,')) return true;
    // Heuristic: base64 characters only and length divisible by 4 (allow small remainder due to padding)
    const b64Regex = /^[A-Za-z0-9+/=\r\n]+$/;
    if (!b64Regex.test(value)) return false;
    // Low whitespace / punctuation typical for base64
    const nonWordRatio = (value.match(/[^A-Za-z0-9+/=]/g)?.length || 0) / value.length;
    return nonWordRatio < 0.01;
}

/**
 * Parse data URI and return { mediaType, base64 } or null if not a data URI.
 */
export function parseDataUri(value: string): { mediaType: string; base64: string } | null {
    if (!value.startsWith('data:')) return null;
    const commaIdx = value.indexOf(',');
    if (commaIdx === -1) return null;
    const meta = value.slice(5, commaIdx); // skip 'data:'
    if (!/;base64$/i.test(meta)) return null;
    const mediaType = meta.replace(/;base64$/i, '') || 'application/octet-stream';
    const base64 = value.slice(commaIdx + 1);
    return { mediaType, base64 };
}

/**
 * Recursively sanitize objects by replacing suspiciously-large base64 strings
 * with placeholders to avoid blowing up the context window.
 */
function sanitizeDeepObject(obj: unknown): unknown {
    if (obj == null) return obj;
    if (typeof obj === 'string') {
        if (isLikelyBase64String(obj)) {
            // Replace with short placeholder; do not keep raw data
            const approxBytes = Math.floor((obj.length * 3) / 4);
            logger.debug(
                `sanitizeDeepObject: replaced large base64 string (~${approxBytes} bytes) with placeholder`
            );
            return `[binary data omitted ~${approxBytes} bytes]`;
        }
        return obj;
    }
    if (Array.isArray(obj)) return obj.map((x) => sanitizeDeepObject(x));
    if (typeof obj === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            out[k] = sanitizeDeepObject(v);
        }
        return out;
    }
    return obj;
}

/**
 * Convert an arbitrary tool result into safe InternalMessage content.
 * - Converts data URIs and base64 blobs to media/file parts
 * - Removes huge binary blobs inside objects
 * - Truncates extremely long raw text
 */
export function sanitizeToolResultToContent(result: unknown): InternalMessage['content'] {
    try {
        // Case 1: string outputs
        if (typeof result === 'string') {
            // Data URI
            const dataUri = parseDataUri(result);
            if (dataUri) {
                const mediaType = dataUri.mediaType;
                logger.debug(
                    `sanitizeToolResultToContent: detected data URI (${mediaType}), converting to media part`
                );
                if (mediaType.startsWith('image/')) {
                    return [{ type: 'image', image: dataUri.base64, mimeType: mediaType }];
                }
                // Use a generic file part for non-image media types
                return [{ type: 'file', data: dataUri.base64, mimeType: mediaType }];
            }
            // Raw base64-like blob
            if (isLikelyBase64String(result)) {
                logger.debug(
                    'sanitizeToolResultToContent: detected base64-like string, converting to file part'
                );
                return [
                    {
                        type: 'file',
                        data: result,
                        mimeType: 'application/octet-stream',
                        filename: 'tool-output.bin',
                    },
                ];
            }
            // Long text: truncate with ellipsis to keep context sane
            if (result.length > MAX_TOOL_TEXT_CHARS) {
                const head = result.slice(0, 4000);
                const tail = result.slice(-1000);
                logger.debug(
                    `sanitizeToolResultToContent: truncating long text tool output (len=${result.length})`
                );
                return `${head}\n... [${result.length - 5000} chars omitted] ...\n${tail}`;
            }
            return result;
        }

        // Case 2: array of parts or mixed
        if (Array.isArray(result)) {
            // Ensure only supported part types (text|image|file) appear in the array
            const parts: Array<TextPart | ImagePart | FilePart> = [];
            for (const item of result as unknown[]) {
                if (item == null) continue;
                // Strings: decide if base64/file or plain text
                if (typeof item === 'string') {
                    const dataUri = parseDataUri(item);
                    if (dataUri) {
                        const mt = dataUri.mediaType;
                        if (mt.startsWith('image/'))
                            parts.push({ type: 'image', image: dataUri.base64, mimeType: mt });
                        else parts.push({ type: 'file', data: dataUri.base64, mimeType: mt });
                        continue;
                    }
                    if (isLikelyBase64String(item)) {
                        parts.push({
                            type: 'file',
                            data: item,
                            mimeType: 'application/octet-stream',
                            filename: 'tool-output.bin',
                        });
                        continue;
                    }
                    parts.push({ type: 'text', text: item });
                    continue;
                }
                // Objects: try coercions, else stringify as text
                if (typeof item === 'object') {
                    const obj = item as Record<string, any>;
                    // Explicitly-typed text part
                    if (obj.type === 'text' && typeof obj.text === 'string') {
                        parts.push({ type: 'text', text: obj.text });
                        continue;
                    }
                    // Image-like
                    if ((obj.type === 'image' && obj.image !== undefined) || 'image' in obj) {
                        parts.push({
                            type: 'image',
                            image: getImageData({ image: obj.image }),
                            mimeType: obj.mimeType || 'image/jpeg',
                        });
                        continue;
                    }
                    // File-like
                    if (obj.type === 'file' && obj.data !== undefined) {
                        parts.push({
                            type: 'file',
                            data: getFileData({ data: obj.data }),
                            mimeType: obj.mimeType || 'application/octet-stream',
                            filename: obj.filename,
                        });
                        continue;
                    }
                    if ('data' in obj && (typeof obj.mimeType === 'string' || obj.filename)) {
                        parts.push({
                            type: 'file',
                            data: getFileData({ data: obj.data }),
                            mimeType: obj.mimeType || 'application/octet-stream',
                            filename: obj.filename,
                        });
                        continue;
                    }
                    // Unknown object -> stringify a sanitized copy as text
                    const cleaned = sanitizeDeepObject(obj);
                    parts.push({ type: 'text', text: safeStringify(cleaned) });
                    continue;
                }
                // Other primitives -> coerce to text
                parts.push({ type: 'text', text: String(item) });
            }
            return parts as InternalMessage['content'];
        }

        // Case 3: object — attempt to infer media, otherwise stringify safely
        if (result && typeof result === 'object') {
            // Common shapes: { image, mimeType? } or { data, mimeType }
            const anyObj = result as Record<string, any>;
            if ('image' in anyObj) {
                return [
                    {
                        type: 'image',
                        image: getImageData({ image: anyObj.image }),
                        mimeType: anyObj.mimeType || 'image/jpeg',
                    },
                ];
            }
            if ('data' in anyObj && anyObj.mimeType) {
                return [
                    {
                        type: 'file',
                        data: getFileData({ data: anyObj.data }),
                        mimeType: anyObj.mimeType,
                        filename: anyObj.filename,
                    },
                ];
            }
            // Generic object: remove huge base64 fields and stringify
            const cleaned = sanitizeDeepObject(anyObj);
            return safeStringify(cleaned);
        }

        // Fallback
        return safeStringify(result ?? '');
    } catch (err) {
        logger.warn(`sanitizeToolResultToContent failed, falling back to string: ${String(err)}`);
        try {
            return safeStringify(result ?? '');
        } catch {
            return String(result ?? '');
        }
    }
}

/**
 * Produce a short textual summary for tool content, to be used with providers
 * that only accept text for tool messages (e.g., OpenAI/Anthropic tool role).
 */
export function summarizeToolContentForText(content: InternalMessage['content']): string {
    if (!Array.isArray(content)) return String(content || '');
    const parts: string[] = [];
    for (const p of content) {
        if (p.type === 'text') {
            parts.push(p.text);
        } else if (p.type === 'image') {
            // Try estimating size
            let bytes = 0;
            if (typeof p.image === 'string') bytes = Math.floor((p.image.length * 3) / 4);
            else if (p.image instanceof ArrayBuffer) bytes = p.image.byteLength;
            else if (p.image instanceof Uint8Array) bytes = p.image.length;
            else if (p.image instanceof Buffer) bytes = p.image.length;
            parts.push(`[image ${p.mimeType || 'image'} ~${Math.ceil(bytes / 1024)}KB]`);
        } else if (p.type === 'file') {
            let bytes = 0;
            if (typeof p.data === 'string') bytes = Math.floor((p.data.length * 3) / 4);
            else if (p.data instanceof ArrayBuffer) bytes = p.data.byteLength;
            else if (p.data instanceof Uint8Array) bytes = p.data.length;
            else if (p.data instanceof Buffer) bytes = p.data.length;
            const label = p.filename ? `${p.filename}` : `${p.mimeType || 'file'}`;
            parts.push(`[file ${label} ~${Math.ceil(bytes / 1024)}KB]`);
        }
    }
    const summary = parts.join('\n');
    // Avoid passing enormous text anyway
    return summary.slice(0, 4000);
}

// Helper: estimate base64 byte length from string length
function base64LengthToBytes(charLength: number): number {
    // 4 base64 chars -> 3 bytes; ignore padding for approximation
    return Math.floor((charLength * 3) / 4);
}

/**
 * Detects if a string is a data URI (base64 encoded).
 * @param str The string to check
 * @returns True if the string is a valid data URI with base64 encoding
 */
function isDataUri(str: string): boolean {
    return str.startsWith('data:') && str.includes(';base64,');
}

/**
 * Extracts the base64 payload from a data URI.
 * @param dataUri The data URI string
 * @returns The base64 payload after the comma, or empty string if malformed
 */
function extractBase64FromDataUri(dataUri: string): string {
    const commaIndex = dataUri.indexOf(',');
    return commaIndex !== -1 ? dataUri.substring(commaIndex + 1) : '';
}

/**
 * Estimates token count for text strings using a character-per-token heuristic.
 * @param text The text string to estimate
 * @returns Estimated token count (conservative estimate: ~4 chars per token)
 */
function estimateTextTokens(text: string): number {
    // Rough heuristic: ~4 characters per token for typical text
    // This is a conservative estimate that can be adjusted based on actual usage
    return Math.ceil(text.length / 4);
}

/**
 * Convert arbitrary tool content to safe text for providers that only accept textual tool messages.
 * - If content is an array of parts, summarize it.
 * - If content is a string that looks like base64/data URI, replace with a short placeholder.
 * - Otherwise pass text through.
 */
export function toTextForToolMessage(content: InternalMessage['content']): string {
    if (Array.isArray(content)) {
        return summarizeToolContentForText(content);
    }
    if (typeof content === 'string') {
        return isLikelyBase64String(content) ? '[binary data omitted]' : content;
    }
    return String(content ?? '');
}
