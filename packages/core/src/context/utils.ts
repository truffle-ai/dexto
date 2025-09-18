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

async function resolveBlobReferenceToParts(
    resourceUri: string,
    resourceManager: import('../resources/index.js').ResourceManager
): Promise<Array<TextPart | ImagePart | FilePart>> {
    try {
        const result = await resourceManager.read(resourceUri);
        const parts: Array<TextPart | ImagePart | FilePart> = [];

        for (const item of result.contents ?? []) {
            if (!item || typeof item !== 'object') {
                continue;
            }

            if (typeof (item as { text?: unknown }).text === 'string') {
                parts.push({ type: 'text', text: item.text as string });
                continue;
            }

            const base64Data =
                typeof item.blob === 'string'
                    ? item.blob
                    : typeof item.data === 'string'
                      ? item.data
                      : undefined;
            const mimeType = typeof item.mimeType === 'string' ? item.mimeType : undefined;
            if (!base64Data || !mimeType) {
                continue;
            }

            const resolvedMime = mimeType ?? 'application/octet-stream';

            if (resolvedMime.startsWith('image/')) {
                const dataUri = `data:${resolvedMime};base64,${base64Data}`;
                const imagePart: ImagePart = {
                    type: 'image',
                    image: dataUri,
                    mimeType: resolvedMime,
                };
                parts.push(imagePart);
                continue;
            }

            const filePart: FilePart = {
                type: 'file',
                data: resolvedMime.startsWith('audio/')
                    ? `data:${resolvedMime};base64,${base64Data}`
                    : base64Data,
                mimeType: resolvedMime,
            };
            if (typeof item.filename === 'string' && item.filename.length > 0) {
                filePart.filename = item.filename;
            } else if (typeof result._meta?.originalName === 'string') {
                filePart.filename = result._meta.originalName;
            }
            parts.push(filePart);
        }

        if (parts.length === 0) {
            const fallbackName =
                (typeof result._meta?.originalName === 'string' && result._meta.originalName) ||
                resourceUri;
            parts.push({ type: 'text', text: `[Attachment: ${fallbackName}]` });
        }

        return parts;
    } catch (error) {
        logger.warn(`Failed to resolve blob reference ${resourceUri}: ${String(error)}`);
        return [{ type: 'text', text: `[Attachment unavailable: ${resourceUri}]` }];
    }
}

function cloneMessagePart(part: TextPart | ImagePart | FilePart): TextPart | ImagePart | FilePart {
    if (part.type === 'text') {
        return { type: 'text', text: part.text };
    }
    if (part.type === 'image') {
        return part.mimeType !== undefined
            ? { type: 'image', image: part.image, mimeType: part.mimeType }
            : { type: 'image', image: part.image };
    }
    const cloned: FilePart = {
        type: 'file',
        data: part.data,
        mimeType: part.mimeType,
    };
    if (part.filename) {
        cloned.filename = part.filename;
    }
    return cloned;
}

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
 * Extracts image data with blob resolution support.
 * If the image is a blob reference, resolves it from the resource manager.
 * @param imagePart The image part containing image data or blob reference
 * @param resourceManager Optional resource manager for resolving blob references
 * @returns Promise<Base64-encoded string or URL string>
 */
export async function getImageDataWithBlobSupport(
    imagePart: {
        image: string | Uint8Array | Buffer | ArrayBuffer | URL;
    },
    resourceManager?: import('../resources/index.js').ResourceManager
): Promise<string> {
    const { image } = imagePart;

    // Check if it's a blob reference
    if (typeof image === 'string' && image.startsWith('@blob:') && resourceManager) {
        try {
            const uri = image.substring(1); // Remove @ prefix
            const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;
            const result = await resourceManager.read(resourceUri);

            if (result.contents[0]?.blob && typeof result.contents[0].blob === 'string') {
                return result.contents[0].blob;
            }
            logger.warn(`Blob reference ${image} did not contain blob data`);
        } catch (error) {
            logger.warn(`Failed to resolve blob reference ${image}: ${String(error)}`);
        }
    }

    // Fallback to original behavior
    return getImageData(imagePart);
}

/**
 * Extracts file data with blob resolution support.
 * If the data is a blob reference, resolves it from the resource manager.
 * @param filePart The file part containing file data or blob reference
 * @param resourceManager Optional resource manager for resolving blob references
 * @returns Promise<Base64-encoded string or URL string>
 */
export async function getFileDataWithBlobSupport(
    filePart: {
        data: string | Uint8Array | Buffer | ArrayBuffer | URL;
    },
    resourceManager?: import('../resources/index.js').ResourceManager
): Promise<string> {
    const { data } = filePart;

    // Check if it's a blob reference
    if (typeof data === 'string' && data.startsWith('@blob:') && resourceManager) {
        try {
            const uri = data.substring(1); // Remove @ prefix
            const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;
            const result = await resourceManager.read(resourceUri);

            if (result.contents[0]?.blob && typeof result.contents[0].blob === 'string') {
                return result.contents[0].blob;
            }
            logger.warn(`Blob reference ${data} did not contain blob data`);
        } catch (error) {
            logger.warn(`Failed to resolve blob reference ${data}: ${String(error)}`);
        }
    }

    // Fallback to original behavior
    return getFileData(filePart);
}

/**
 * Resolves blob references in message content to actual data.
 * Expands @blob:id references to their actual base64 content for LLM consumption.
 * @param content The message content that may contain blob references
 * @param resourceManager Resource manager for resolving blob references
 * @returns Promise<Resolved content with blob references expanded>
 */
export async function expandBlobReferences(
    content: InternalMessage['content'],
    resourceManager: import('../resources/index.js').ResourceManager
): Promise<InternalMessage['content']> {
    // Handle string content with blob references
    if (typeof content === 'string') {
        // Check for blob references like @blob:abc123
        const blobRefPattern = /@blob:[a-f0-9]+/g;
        const matches = [...content.matchAll(blobRefPattern)];

        if (matches.length === 0) {
            return content;
        }

        const resolvedCache = new Map<string, Array<TextPart | ImagePart | FilePart>>();
        const parts: Array<TextPart | ImagePart | FilePart> = [];
        let lastIndex = 0;

        for (const match of matches) {
            const matchIndex = match.index ?? 0;
            const token = match[0];
            if (matchIndex > lastIndex) {
                const segment = content.slice(lastIndex, matchIndex);
                if (segment.length > 0) {
                    parts.push({ type: 'text', text: segment });
                }
            }

            const uri = token.substring(1); // Remove leading @
            const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;

            let resolvedParts = resolvedCache.get(resourceUri);
            if (!resolvedParts) {
                resolvedParts = await resolveBlobReferenceToParts(resourceUri, resourceManager);
                resolvedCache.set(resourceUri, resolvedParts);
            }

            if (resolvedParts.length > 0) {
                parts.push(...resolvedParts.map(cloneMessagePart));
            } else {
                parts.push({ type: 'text', text: token });
            }

            lastIndex = matchIndex + token.length;
        }

        if (lastIndex < content.length) {
            const trailing = content.slice(lastIndex);
            if (trailing.length > 0) {
                parts.push({ type: 'text', text: trailing });
            }
        }

        const normalized = parts.filter((part) => part.type !== 'text' || part.text.length > 0);

        if (normalized.length === 1 && normalized[0]?.type === 'text') {
            return normalized[0].text;
        }

        return normalized;
    }

    // Handle array of parts
    if (Array.isArray(content)) {
        const expandedParts: Array<TextPart | ImagePart | FilePart> = [];

        for (const part of content) {
            if (
                part.type === 'image' &&
                typeof part.image === 'string' &&
                part.image.startsWith('@blob:')
            ) {
                const uri = part.image.substring(1);
                const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;
                const resolved = await resolveBlobReferenceToParts(resourceUri, resourceManager);
                if (resolved.length > 0) {
                    expandedParts.push(...resolved.map(cloneMessagePart));
                } else {
                    expandedParts.push(part);
                }
                continue;
            }

            if (
                part.type === 'file' &&
                typeof part.data === 'string' &&
                part.data.startsWith('@blob:')
            ) {
                const uri = part.data.substring(1);
                const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;
                const resolved = await resolveBlobReferenceToParts(resourceUri, resourceManager);
                if (resolved.length > 0) {
                    expandedParts.push(...resolved.map(cloneMessagePart));
                } else {
                    try {
                        const resolvedData = await getFileDataWithBlobSupport(
                            part,
                            resourceManager
                        );
                        expandedParts.push({ ...part, data: resolvedData });
                    } catch (error) {
                        logger.warn(`Failed to resolve file blob reference: ${String(error)}`);
                        expandedParts.push(part);
                    }
                }
                continue;
            }

            if (part.type === 'text' && part.text.includes('@blob:')) {
                const expanded = await expandBlobReferences(part.text, resourceManager);
                if (typeof expanded === 'string') {
                    expandedParts.push({ ...part, text: expanded });
                } else if (Array.isArray(expanded)) {
                    expandedParts.push(...expanded.map(cloneMessagePart));
                } else {
                    expandedParts.push(part);
                }
                continue;
            }

            expandedParts.push(part);
        }

        return expandedParts;
    }

    return content;
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
 * Convert an arbitrary tool result into safe InternalMessage content with optional blob storage.
 * - Automatically stores large media in blob store and returns resource references
 * - Converts data URIs and base64 blobs to media/file parts or blob references
 * - Removes huge binary blobs inside objects
 * - Truncates extremely long raw text
 */
export async function sanitizeToolResultToContentWithBlobs(
    result: unknown,
    blobService?: import('../blob/index.js').BlobService
): Promise<InternalMessage['content']> {
    try {
        // Case 1: string outputs
        if (typeof result === 'string') {
            // Data URI
            const dataUri = parseDataUri(result);
            if (dataUri) {
                const mediaType = dataUri.mediaType;
                logger.debug(
                    `sanitizeToolResultToContentWithBlobs: detected data URI (${mediaType})`
                );

                // Check if we should store as blob based on size
                const approxSize = Math.floor((dataUri.base64.length * 3) / 4);
                const shouldStoreAsBlob = blobService && approxSize > 1024; // Store blobs > 1KB

                if (shouldStoreAsBlob) {
                    try {
                        logger.debug(
                            `Storing data URI as blob (${approxSize} bytes, ${mediaType})`
                        );
                        const blobRef = await blobService.store(result, {
                            mimeType: mediaType,
                            source: 'tool',
                            originalName: `tool-output.${mediaType.split('/')[1] || 'bin'}`,
                        });
                        logger.debug(`Stored blob: ${blobRef.uri} (${approxSize} bytes)`);

                        // Return a text reference that can be resolved later
                        return `@${blobRef.uri}`;
                    } catch (error) {
                        logger.warn(
                            `Failed to store blob, falling back to inline: ${String(error)}`
                        );
                        // Fall through to original behavior
                    }
                }

                // Original behavior: return as structured part
                if (mediaType.startsWith('image/')) {
                    return [{ type: 'image', image: dataUri.base64, mimeType: mediaType }];
                }
                return [{ type: 'file', data: dataUri.base64, mimeType: mediaType }];
            }

            // Raw base64-like blob
            if (isLikelyBase64String(result)) {
                logger.debug('sanitizeToolResultToContentWithBlobs: detected base64-like string');

                // Check if we should store as blob
                const approxSize = Math.floor((result.length * 3) / 4);
                const shouldStoreAsBlob = blobService && approxSize > 1024;

                if (shouldStoreAsBlob) {
                    try {
                        const blobRef = await blobService.store(result, {
                            mimeType: 'application/octet-stream',
                            source: 'tool',
                            originalName: 'tool-output.bin',
                        });
                        logger.debug(
                            `Stored tool result as blob: ${blobRef.uri} (${approxSize} bytes)`
                        );
                        return `@${blobRef.uri}`;
                    } catch (error) {
                        logger.warn(
                            `Failed to store blob, falling back to inline: ${String(error)}`
                        );
                    }
                }

                // Original behavior: return as file part
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
                    `sanitizeToolResultToContentWithBlobs: truncating long text tool output (len=${result.length})`
                );
                return `${head}\n... [${result.length - 5000} chars omitted] ...\n${tail}`;
            }
            return result;
        }

        // Case 2: array of parts or mixed
        if (Array.isArray(result)) {
            const parts: Array<TextPart | ImagePart | FilePart> = [];
            for (const item of result as unknown[]) {
                if (item == null) continue;

                // Process each item recursively
                const processedItem = await sanitizeToolResultToContentWithBlobs(item, blobService);

                if (typeof processedItem === 'string') {
                    parts.push({ type: 'text', text: processedItem });
                } else if (Array.isArray(processedItem)) {
                    parts.push(...(processedItem as Array<TextPart | ImagePart | FilePart>));
                }
            }
            return parts as InternalMessage['content'];
        }

        // Case 3: object — attempt to infer media, otherwise stringify safely
        if (result && typeof result === 'object') {
            const anyObj = result as Record<string, any>;

            // Handle MCP tool results with nested content array
            if ('content' in anyObj && Array.isArray(anyObj.content)) {
                logger.debug(
                    `Processing MCP tool result with ${anyObj.content.length} content items`
                );
                const processedContent = [];

                for (const item of anyObj.content) {
                    if (item && typeof item === 'object' && 'data' in item && item.mimeType) {
                        const fileData = getFileData({ data: item.data });
                        const mimeType = item.mimeType;

                        // Check if we should store as blob
                        const approxSize =
                            typeof fileData === 'string'
                                ? Math.floor((fileData.length * 3) / 4)
                                : 0;
                        const shouldStoreAsBlob = blobService && approxSize > 1024;

                        if (shouldStoreAsBlob) {
                            try {
                                logger.debug(
                                    `Storing MCP content item as blob (${approxSize} bytes, ${mimeType})`
                                );
                                const blobRef = await blobService.store(fileData, {
                                    mimeType,
                                    source: 'tool',
                                    originalName:
                                        item.filename ||
                                        `tool-${item.type || 'file'}.${mimeType.split('/')[1] || 'bin'}`,
                                });
                                logger.debug(
                                    `Stored MCP blob: ${blobRef.uri} (${approxSize} bytes)`
                                );
                                processedContent.push(`@${blobRef.uri}`);
                                continue;
                            } catch (error) {
                                logger.warn(
                                    `Failed to store MCP blob, falling back to inline: ${String(error)}`
                                );
                            }
                        }

                        // Fall back to original structure
                        if (item.type === 'image') {
                            processedContent.push({
                                type: 'image',
                                image: fileData,
                                mimeType,
                            });
                        } else {
                            processedContent.push({
                                type: 'file',
                                data: fileData,
                                mimeType,
                                filename: item.filename,
                            });
                        }
                    } else {
                        // Non-media content, keep as-is
                        processedContent.push(item);
                    }
                }

                return processedContent;
            }

            // Common shapes: { image, mimeType? } or { data, mimeType }
            if ('image' in anyObj) {
                const imageData = getImageData({ image: anyObj.image });
                const mimeType = anyObj.mimeType || 'image/jpeg';

                // Check if we should store as blob
                const approxSize =
                    typeof imageData === 'string' ? Math.floor((imageData.length * 3) / 4) : 0;
                const shouldStoreAsBlob = blobService && approxSize > 1024;

                if (shouldStoreAsBlob) {
                    try {
                        const blobRef = await blobService.store(imageData, {
                            mimeType,
                            source: 'tool',
                            originalName: `tool-image.${mimeType.split('/')[1] || 'jpg'}`,
                        });
                        logger.debug(
                            `Stored tool image as blob: ${blobRef.uri} (${approxSize} bytes)`
                        );
                        return `@${blobRef.uri}`;
                    } catch (error) {
                        logger.warn(
                            `Failed to store image blob, falling back to inline: ${String(error)}`
                        );
                    }
                }

                return [
                    {
                        type: 'image',
                        image: imageData,
                        mimeType,
                    },
                ];
            }

            if ('data' in anyObj && anyObj.mimeType) {
                const fileData = getFileData({ data: anyObj.data });
                const mimeType = anyObj.mimeType;

                // Check if we should store as blob
                const approxSize =
                    typeof fileData === 'string' ? Math.floor((fileData.length * 3) / 4) : 0;
                const shouldStoreAsBlob = blobService && approxSize > 1024;

                if (shouldStoreAsBlob) {
                    try {
                        const blobRef = await blobService.store(fileData, {
                            mimeType,
                            source: 'tool',
                            originalName:
                                anyObj.filename || `tool-file.${mimeType.split('/')[1] || 'bin'}`,
                        });
                        logger.debug(
                            `Stored tool file as blob: ${blobRef.uri} (${approxSize} bytes)`
                        );
                        return `@${blobRef.uri}`;
                    } catch (error) {
                        logger.warn(
                            `Failed to store file blob, falling back to inline: ${String(error)}`
                        );
                    }
                }

                return [
                    {
                        type: 'file',
                        data: fileData,
                        mimeType,
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
        logger.warn(
            `sanitizeToolResultToContentWithBlobs failed, falling back to string: ${String(err)}`
        );
        try {
            return safeStringify(result ?? '');
        } catch {
            return String(result ?? '');
        }
    }
}

/**
 * Convert an arbitrary tool result into safe InternalMessage content.
 * - Converts data URIs and base64 blobs to media/file parts
 * - Removes huge binary blobs inside objects
 * - Truncates extremely long raw text
 *
 * @deprecated Use sanitizeToolResultToContentWithBlobs for automatic blob storage
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
