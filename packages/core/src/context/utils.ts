import {
    InternalMessage,
    TextPart,
    ImagePart,
    FilePart,
    UIResourcePart,
    ContentPart,
    SanitizedToolResult,
    isToolMessage,
} from './types.js';
import { isValidDisplayData, type ToolDisplayData } from '../tools/display-types.js';
import type { IDextoLogger } from '@core/logger/v2/types.js';
import { validateModelFileSupport } from '@core/llm/registry.js';
import { LLMContext } from '@core/llm/types.js';
import { safeStringify } from '@core/utils/safe-stringify.js';
import { getFileMediaKind, getResourceKind } from './media-helpers.js';

// Tunable heuristics and shared constants
const MIN_BASE64_HEURISTIC_LENGTH = 512; // Below this length, treat as regular text
const MAX_TOOL_TEXT_CHARS = 8000; // Truncate overly long tool text

type ToolBlobNamingOptions = {
    toolName?: string;
    toolCallId?: string;
};

const MIN_TOOL_INLINE_MEDIA_BYTES = 1024;

type InlineMediaKind = 'image' | 'file';

type InlineMediaHint = {
    index: number;
    kind: InlineMediaKind;
    mimeType: string;
    approxBytes: number;
    data: string | Buffer;
    filename?: string | undefined;
};

export interface NormalizedToolResult {
    parts: Array<TextPart | ImagePart | FilePart>;
    uiResources: UIResourcePart[];
    inlineMedia: InlineMediaHint[];
}

interface PersistToolMediaOptions {
    blobStore?: import('../storage/blob/types.js').BlobStore;
    toolName?: string;
    toolCallId?: string;
}

interface PersistToolMediaResult {
    parts: Array<TextPart | ImagePart | FilePart>;
    uiResources: UIResourcePart[];
    resources?: SanitizedToolResult['resources'];
}

function slugifyForFilename(value: string, maxLength = 48): string | null {
    if (!value) return null;
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!slug) return null;
    return slug.length > maxLength ? slug.slice(0, maxLength) : slug;
}

function inferExtensionFromMime(mimeType: string | undefined, fallback: string): string {
    if (!mimeType) return fallback;
    const subtype = mimeType.split('/')[1]?.split(';')[0]?.split('+')[0];
    if (!subtype) return fallback;
    const clean = subtype.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return clean || fallback;
}

function sanitizeExistingFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function generateUniqueSuffix(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function clonePart(part: TextPart | ImagePart | FilePart): TextPart | ImagePart | FilePart {
    if (part.type === 'text') {
        return { type: 'text', text: part.text };
    }

    if (part.type === 'image') {
        const cloned: ImagePart = {
            type: 'image',
            image: part.image,
        };
        if (part.mimeType) {
            cloned.mimeType = part.mimeType;
        }
        return cloned;
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

function coerceContentToParts(
    content: ContentPart[] | null
): Array<TextPart | ImagePart | FilePart> {
    if (content == null) {
        return [];
    }

    const normalized: Array<TextPart | ImagePart | FilePart> = [];
    for (const item of content) {
        // Filter out UIResourcePart - only keep ContentPart types
        if (item.type === 'ui-resource') {
            continue;
        }
        if (item.type === 'text') {
            normalized.push({ type: 'text', text: item.text });
        } else if (item.type === 'image') {
            const cloned: ImagePart = {
                type: 'image',
                image: item.image,
            };
            if (item.mimeType) {
                cloned.mimeType = item.mimeType;
            }
            normalized.push(cloned);
        } else if (item.type === 'file') {
            const cloned: FilePart = {
                type: 'file',
                data: item.data,
                mimeType: item.mimeType ?? 'application/octet-stream',
            };
            if (item.filename) {
                cloned.filename = item.filename;
            }
            normalized.push(cloned);
        }
    }
    return normalized;
}

function detectInlineMedia(
    part: TextPart | ImagePart | FilePart,
    index: number
): InlineMediaHint | null {
    if (part.type === 'text') {
        return null;
    }

    if (part.type === 'image') {
        const value = part.image;
        const mimeType = part.mimeType ?? 'image/jpeg';
        if (typeof value === 'string') {
            if (value.startsWith('@blob:')) return null;
            if (
                value.startsWith('http://') ||
                value.startsWith('https://') ||
                value.startsWith('blob:')
            ) {
                return null;
            }
            if (isLikelyBase64String(value, 128)) {
                return {
                    index,
                    kind: 'image',
                    mimeType,
                    approxBytes: base64LengthToBytes(value.length),
                    data: value,
                };
            }
        } else if (value instanceof Buffer) {
            return {
                index,
                kind: 'image',
                mimeType,
                approxBytes: value.length,
                data: value,
            };
        } else if (value instanceof Uint8Array) {
            const buffer = Buffer.from(value);
            return {
                index,
                kind: 'image',
                mimeType,
                approxBytes: buffer.length,
                data: buffer,
            };
        } else if (value instanceof ArrayBuffer) {
            const buffer = Buffer.from(new Uint8Array(value));
            return {
                index,
                kind: 'image',
                mimeType,
                approxBytes: buffer.length,
                data: buffer,
            };
        }
        return null;
    }

    const data = part.data;
    const mimeType = part.mimeType ?? 'application/octet-stream';
    const filename = part.filename;

    if (typeof data === 'string') {
        if (data.startsWith('@blob:')) return null;
        if (data.startsWith('http://') || data.startsWith('https://') || data.startsWith('blob:')) {
            return null;
        }
        if (data.startsWith('data:')) {
            const parsed = parseDataUri(data);
            if (parsed) {
                return {
                    index,
                    kind: 'file',
                    mimeType: parsed.mediaType,
                    approxBytes: base64LengthToBytes(parsed.base64.length),
                    data: parsed.base64,
                    filename,
                };
            }
        }
        if (isLikelyBase64String(data, 128)) {
            return {
                index,
                kind: 'file',
                mimeType,
                approxBytes: base64LengthToBytes(data.length),
                data,
                filename,
            };
        }
    } else if (data instanceof Buffer) {
        return {
            index,
            kind: 'file',
            mimeType,
            approxBytes: data.length,
            data,
            filename,
        };
    } else if (data instanceof Uint8Array) {
        const buffer = Buffer.from(data);
        return {
            index,
            kind: 'file',
            mimeType,
            approxBytes: buffer.length,
            data: buffer,
            filename,
        };
    } else if (data instanceof ArrayBuffer) {
        const buffer = Buffer.from(new Uint8Array(data));
        return {
            index,
            kind: 'file',
            mimeType,
            approxBytes: buffer.length,
            data: buffer,
            filename,
        };
    }

    return null;
}

function buildToolBlobName(
    kind: 'output' | 'image' | 'file',
    mimeType: string | undefined,
    options: ToolBlobNamingOptions | undefined,
    preferredName?: string
): string {
    if (preferredName) {
        return sanitizeExistingFilename(preferredName);
    }

    const toolSegment = slugifyForFilename(options?.toolName ?? '', 40);
    const callSegment = slugifyForFilename(options?.toolCallId ?? '', 16);
    const parts = ['tool'];
    if (toolSegment) parts.push(toolSegment);
    if (callSegment) parts.push(callSegment);
    parts.push(kind);
    const ext = inferExtensionFromMime(
        mimeType,
        kind === 'image' ? 'jpg' : kind === 'file' ? 'bin' : 'bin'
    );
    const unique = generateUniqueSuffix();
    return `${parts.join('-')}-${unique}.${ext}`;
}

async function resolveBlobReferenceToParts(
    resourceUri: string,
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: IDextoLogger,
    allowedMediaTypes?: string[]
): Promise<Array<TextPart | ImagePart | FilePart>> {
    try {
        const result = await resourceManager.read(resourceUri);

        // Check if this blob type is allowed (if filtering is enabled)
        if (allowedMediaTypes) {
            const mimeType = result.contents[0]?.mimeType;
            const metadata = result._meta as { size?: number; originalName?: string } | undefined;

            if (mimeType && !matchesAnyMimePattern(mimeType, allowedMediaTypes)) {
                // Generate placeholder for filtered media
                const placeholderMetadata: {
                    mimeType: string;
                    size: number;
                    originalName?: string;
                } = {
                    mimeType,
                    size: metadata?.size ?? 0,
                };
                if (metadata?.originalName) {
                    placeholderMetadata.originalName = metadata.originalName;
                }
                const placeholder = generateMediaPlaceholder(placeholderMetadata);
                return [{ type: 'text', text: placeholder }];
            }
        }

        const parts: Array<TextPart | ImagePart | FilePart> = [];

        for (const item of result.contents ?? []) {
            if (!item || typeof item !== 'object') {
                continue;
            }

            if (typeof (item as { text?: unknown }).text === 'string') {
                parts.push({ type: 'text', text: (item as { text: string }).text });
                continue;
            }

            const base64Data =
                'blob' in item && typeof item.blob === 'string'
                    ? item.blob
                    : 'data' in item && typeof (item as any).data === 'string'
                      ? (item as any).data
                      : undefined;
            const mimeType = typeof item.mimeType === 'string' ? item.mimeType : undefined;
            if (!base64Data || !mimeType) {
                continue;
            }

            const resolvedMime = mimeType ?? 'application/octet-stream';

            if (resolvedMime.startsWith('image/')) {
                // Return raw base64, NOT data URI format
                // LLM APIs (Anthropic, OpenAI, etc.) expect raw base64, not data:... URIs
                const imagePart: ImagePart = {
                    type: 'image',
                    image: base64Data,
                    mimeType: resolvedMime,
                };
                parts.push(imagePart);
                continue;
            }

            // Return raw base64 for all file types - mimeType is provided separately
            // LLM APIs expect raw base64, not data:... URIs
            const filePart: FilePart = {
                type: 'file',
                data: base64Data,
                mimeType: resolvedMime,
            };
            const itemWithFilename = item as any;
            if (
                typeof itemWithFilename.filename === 'string' &&
                itemWithFilename.filename.length > 0
            ) {
                filePart.filename = itemWithFilename.filename;
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
        // logger is not available in this utility function
        logger.warn(`Failed to resolve blob reference ${resourceUri}: ${String(error)}`);
        return [{ type: 'text', text: `[Attachment unavailable: ${resourceUri}]` }];
    }
}

// ============= TOKEN ESTIMATION =============
// These functions provide rough token estimates using heuristics.
// Used for context management, compaction decisions, and UI display.
// Actual token counts come from the LLM API response.

/**
 * Estimate tokens for a text string.
 * Uses the common heuristic of ~4 characters per token.
 */
export function estimateStringTokens(text: string): number {
    if (!text) return 0;
    return Math.round(text.length / 4);
}

/**
 * Estimate tokens for an image.
 * Images use a fixed token budget regardless of dimensions.
 * Based on typical LLM pricing (~1000 tokens per image).
 */
export function estimateImageTokens(): number {
    return 1000;
}

/**
 * Estimate tokens for a file based on its content.
 * If content is available, estimates based on text length.
 * Falls back to a default estimate if no content provided.
 */
export function estimateFileTokens(content?: string): number {
    if (content) {
        return estimateStringTokens(content);
    }
    // Fallback for when content is not available
    return 1000;
}

/**
 * Estimate tokens for a content part (text, image, or file).
 */
export function estimateContentPartTokens(part: ContentPart): number {
    if (part.type === 'text') {
        return estimateStringTokens(part.text);
    }
    if (part.type === 'image') {
        return estimateImageTokens();
    }
    if (part.type === 'file') {
        // File parts use a simple fallback since:
        // 1. After first LLM call, we use actual token counts for the bulk of estimation
        // 2. This only affects the "new messages" delta and /context display
        // 3. File attachments in tool results are relatively rare
        return 1000;
    }
    return 0;
}

/**
 * Estimate tokens for an array of messages.
 * Used for telemetry/logging only - actual token counts come from the LLM API.
 */
export function estimateMessagesTokens(messages: readonly InternalMessage[]): number {
    let total = 0;
    for (const msg of messages) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content) {
            total += estimateContentPartTokens(part);
        }
    }
    return total;
}

/**
 * Tool definition interface for token estimation.
 * Matches the structure used by both ToolManager and getContextTokenEstimate.
 */
export interface ToolDefinition {
    name?: string;
    description?: string;
    parameters?: unknown;
}

/**
 * Estimate tokens for tool definitions.
 * Returns both total and per-tool breakdown for UI display.
 */
export function estimateToolsTokens(tools: Record<string, ToolDefinition>): {
    total: number;
    perTool: Array<{ name: string; tokens: number }>;
} {
    const perTool: Array<{ name: string; tokens: number }> = [];
    let total = 0;
    for (const [key, tool] of Object.entries(tools)) {
        const toolName = tool.name || key;
        const toolDescription = tool.description || '';
        const toolSchema = JSON.stringify(tool.parameters || {});
        const tokens = estimateStringTokens(toolName + toolDescription + toolSchema);
        perTool.push({ name: toolName, tokens });
        total += tokens;
    }
    return { total, perTool };
}

/**
 * Result of context token estimation with breakdown.
 */
export interface ContextTokenEstimate {
    /** Total estimated tokens */
    total: number;
    /** Breakdown by category */
    breakdown: {
        systemPrompt: number;
        messages: number;
        tools: {
            total: number;
            perTool: Array<{ name: string; tokens: number }>;
        };
    };
}

/**
 * Estimate total context tokens for LLM calls.
 * This is the single source of truth for context token estimation,
 * used by both /context overlay and compaction pre-check.
 *
 * IMPORTANT: The `preparedHistory` parameter must be the result of
 * `ContextManager.prepareHistory()` or `getFormattedMessagesForLLM()`.
 * This ensures messages are properly filtered (compacted messages removed)
 * and pruned tool outputs are replaced with placeholders.
 *
 * @param systemPrompt The system prompt string
 * @param preparedHistory Message history AFTER filterCompacted and pruning
 * @param tools Optional tool definitions - if not provided, tools are not counted
 * @returns Token estimate with total and breakdown
 */
export function estimateContextTokens(
    systemPrompt: string,
    preparedHistory: readonly InternalMessage[],
    tools?: Record<string, ToolDefinition>
): ContextTokenEstimate {
    const systemPromptTokens = estimateStringTokens(systemPrompt);
    const messagesTokens = estimateMessagesTokens(preparedHistory);
    const toolsEstimate = tools ? estimateToolsTokens(tools) : { total: 0, perTool: [] };

    return {
        total: systemPromptTokens + toolsEstimate.total + messagesTokens,
        breakdown: {
            systemPrompt: systemPromptTokens,
            messages: messagesTokens,
            tools: toolsEstimate,
        },
    };
}

/**
 * Extracts image data (base64 or URL) from an ImagePart or raw buffer.
 * @param imagePart The image part containing image data
 * @returns Base64-encoded string or URL string
 */
export function getImageData(
    imagePart: {
        image: string | Uint8Array | Buffer | ArrayBuffer | URL;
    },
    logger: IDextoLogger
): string {
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
 * @param logger Optional logger instance
 * @returns Base64-encoded string or URL string
 */
export function getFileData(
    filePart: {
        data: string | Uint8Array | Buffer | ArrayBuffer | URL;
    },
    logger: IDextoLogger
): string {
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
 * @param resourceManager Resource manager for resolving blob references
 * @param logger Optional logger instance
 * @returns Promise<Base64-encoded string or URL string>
 */
export async function getImageDataWithBlobSupport(
    imagePart: {
        image: string | Uint8Array | Buffer | ArrayBuffer | URL;
    },
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: IDextoLogger
): Promise<string> {
    const { image } = imagePart;

    // Check if it's a blob reference
    if (typeof image === 'string' && image.startsWith('@blob:')) {
        try {
            const uri = image.substring(1); // Remove @ prefix
            const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;
            const result = await resourceManager.read(resourceUri);

            const firstContent = result.contents[0];
            if (
                firstContent &&
                'blob' in firstContent &&
                firstContent.blob &&
                typeof firstContent.blob === 'string'
            ) {
                return firstContent.blob;
            }
            logger.warn(`Blob reference ${image} did not contain blob data`);
        } catch (error) {
            logger.warn(`Failed to resolve blob reference ${image}: ${String(error)}`);
        }
    }

    // Fallback to original behavior
    return getImageData(imagePart, logger);
}

/**
 * Extracts file data with blob resolution support.
 * If the data is a blob reference, resolves it from the resource manager.
 * @param filePart The file part containing file data or blob reference
 * @param resourceManager Resource manager for resolving blob references
 * @returns Promise<Base64-encoded string or URL string>
 */
export async function getFileDataWithBlobSupport(
    filePart: {
        data: string | Uint8Array | Buffer | ArrayBuffer | URL;
    },
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: IDextoLogger
): Promise<string> {
    const { data } = filePart;

    // Check if it's a blob reference
    if (typeof data === 'string' && data.startsWith('@blob:')) {
        try {
            const uri = data.substring(1); // Remove @ prefix
            const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;
            const result = await resourceManager.read(resourceUri);

            const firstContent = result.contents[0];
            if (
                firstContent &&
                'blob' in firstContent &&
                firstContent.blob &&
                typeof firstContent.blob === 'string'
            ) {
                return firstContent.blob;
            }
            logger.warn(`Blob reference ${data} did not contain blob data`);
        } catch (error) {
            logger.warn(`Failed to resolve blob reference ${data}: ${String(error)}`);
        }
    }

    // Fallback to original behavior
    return getFileData(filePart, logger);
}

/**
 * Helper: Expand blob references within a single text string.
 * Returns array of parts (text segments + resolved blobs).
 */
async function expandBlobsInText(
    text: string,
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: IDextoLogger,
    allowedMediaTypes?: string[]
): Promise<Array<TextPart | ImagePart | FilePart>> {
    if (!text.includes('@blob:')) {
        return [{ type: 'text', text }];
    }

    const blobRefPattern = /@blob:[a-f0-9]+/g;
    const matches = [...text.matchAll(blobRefPattern)];

    if (matches.length === 0) {
        return [{ type: 'text', text }];
    }

    const resolvedCache = new Map<string, Array<TextPart | ImagePart | FilePart>>();
    const parts: Array<TextPart | ImagePart | FilePart> = [];
    let lastIndex = 0;

    for (const match of matches) {
        const matchIndex = match.index ?? 0;
        const token = match[0];
        if (matchIndex > lastIndex) {
            const segment = text.slice(lastIndex, matchIndex);
            if (segment.length > 0) {
                parts.push({ type: 'text', text: segment });
            }
        }

        const uri = token.substring(1); // Remove leading @
        const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;

        let resolvedParts = resolvedCache.get(resourceUri);
        if (!resolvedParts) {
            resolvedParts = await resolveBlobReferenceToParts(
                resourceUri,
                resourceManager,
                logger,
                allowedMediaTypes
            );
            resolvedCache.set(resourceUri, resolvedParts);
        }

        if (resolvedParts.length > 0) {
            parts.push(...resolvedParts.map((p) => ({ ...p })));
        } else {
            parts.push({ type: 'text', text: token });
        }

        lastIndex = matchIndex + token.length;
    }

    if (lastIndex < text.length) {
        const trailing = text.slice(lastIndex);
        if (trailing.length > 0) {
            parts.push({ type: 'text', text: trailing });
        }
    }

    return parts.filter((p) => p.type !== 'text' || p.text.length > 0);
}

/**
 * Resolves blob references in message content to actual data.
 * Expands @blob:id references to their actual base64 content for LLM consumption.
 * Can optionally filter by MIME type patterns - unsupported types are replaced with descriptive placeholders.
 *
 * @param content The message content that may contain blob references
 * @param resourceManager Resource manager for resolving blob references
 * @param allowedMediaTypes Optional array of MIME patterns (e.g., ["image/*", "application/pdf"]).
 *                          If provided, only matching blobs are expanded; others become placeholders.
 *                          If omitted, all blobs are expanded (legacy behavior).
 * @returns Promise<Resolved content with blob references expanded or replaced with placeholders>
 */
// Overload: null returns empty array
export async function expandBlobReferences(
    content: null,
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: IDextoLogger,
    allowedMediaTypes?: string[]
): Promise<ContentPart[]>;
// Overload: ContentPart[] returns ContentPart[]
export async function expandBlobReferences(
    content: ContentPart[],
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: IDextoLogger,
    allowedMediaTypes?: string[]
): Promise<ContentPart[]>;
// Overload: ContentPart[] | null (for InternalMessage['content'])
export async function expandBlobReferences(
    content: ContentPart[] | null,
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: IDextoLogger,
    allowedMediaTypes?: string[]
): Promise<ContentPart[]>;
// Implementation
export async function expandBlobReferences(
    content: ContentPart[] | null,
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: IDextoLogger,
    allowedMediaTypes?: string[]
): Promise<ContentPart[]> {
    // Handle null/undefined content
    if (content == null || !Array.isArray(content)) {
        return [];
    }

    const expandedParts: Array<TextPart | ImagePart | FilePart | UIResourcePart> = [];

    for (const part of content) {
        // UIResourcePart doesn't have blob references - pass through unchanged
        if (part.type === 'ui-resource') {
            expandedParts.push(part);
            continue;
        }

        if (
            part.type === 'image' &&
            typeof part.image === 'string' &&
            part.image.startsWith('@blob:')
        ) {
            const uri = part.image.substring(1);
            const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;
            const resolved = await resolveBlobReferenceToParts(
                resourceUri,
                resourceManager,
                logger,
                allowedMediaTypes
            );
            if (resolved.length > 0) {
                expandedParts.push(...resolved.map((p) => ({ ...p })));
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
            const resolved = await resolveBlobReferenceToParts(
                resourceUri,
                resourceManager,
                logger,
                allowedMediaTypes
            );
            if (resolved.length > 0) {
                expandedParts.push(...resolved.map((p) => ({ ...p })));
            } else {
                try {
                    const resolvedData = await getFileDataWithBlobSupport(
                        part,
                        resourceManager,
                        logger
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
            // Expand blob references in text part using helper
            const expanded = await expandBlobsInText(
                part.text,
                resourceManager,
                logger,
                allowedMediaTypes
            );
            expandedParts.push(...expanded);
            continue;
        }

        expandedParts.push(part);
    }

    return expandedParts;
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
    config: LLMContext,
    logger: IDextoLogger
): InternalMessage[] {
    try {
        let totalImagesFiltered = 0;
        let totalFilesFiltered = 0;

        const filteredMessages = messages.map((message) => {
            // Only filter user messages with array content (multimodal)
            if (message.role !== 'user' || !Array.isArray(message.content)) {
                return message;
            }

            let imagesInMessage = 0;
            let filesInMessage = 0;

            const filteredContent = message.content.filter((part) => {
                // Keep text parts
                if (part.type === 'text') {
                    return true;
                }

                // Filter image parts based on LLM capabilities
                if (part.type === 'image') {
                    const mimeType = part.mimeType ?? 'image/jpeg';
                    const validation = validateModelFileSupport(
                        config.provider,
                        config.model,
                        mimeType
                    );
                    // Only filter if model explicitly doesn't support this file type
                    // Keep content if validation errored or is unknown
                    if (validation.isSupported) {
                        return true;
                    }
                    if (validation.error?.includes('does not support')) {
                        imagesInMessage++;
                        return false;
                    }
                    // Unknown file type or validation error - keep the content and warn
                    logger.warn(
                        `Could not validate image support for ${config.model}: ${validation.error}`
                    );
                    return true;
                }

                // Filter file parts based on LLM capabilities
                if (part.type === 'file' && part.mimeType) {
                    const validation = validateModelFileSupport(
                        config.provider,
                        config.model,
                        part.mimeType
                    );
                    // Only filter if model explicitly doesn't support this file type
                    // Keep content if validation errored or is unknown
                    if (validation.isSupported) {
                        return true;
                    }
                    if (validation.error?.includes('does not support')) {
                        filesInMessage++;
                        return false;
                    }
                    // Unknown file type or validation error - keep the content and warn
                    logger.warn(
                        `Could not validate file support for ${config.model}: ${validation.error}`
                    );
                    return true;
                }

                return true; // Keep unknown part types
            });

            totalImagesFiltered += imagesInMessage;
            totalFilesFiltered += filesInMessage;

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

        // Log summary of filtered content
        if (totalImagesFiltered > 0) {
            logger.info(
                `Filtered ${totalImagesFiltered} image${totalImagesFiltered > 1 ? 's' : ''} for ${config.model} since it doesn't support images`
            );
        }
        if (totalFilesFiltered > 0) {
            logger.info(
                `Filtered ${totalFilesFiltered} file${totalFilesFiltered > 1 ? 's' : ''} for ${config.model} since it doesn't support that file type`
            );
        }

        return filteredMessages;
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

// Re-export browser-safe helpers for convenience (already imported above)
export { getFileMediaKind, getResourceKind };

/**
 * Check if a MIME type matches a pattern with wildcard support.
 * Supports exact matches and wildcard patterns:
 * - "image/png" matches "image/png" exactly
 * - "image/star" (where star is asterisk) matches "image/png", "image/jpeg", etc.
 * - Single asterisk or "asterisk/asterisk" matches everything
 *
 * @param mimeType The MIME type to check (e.g., "image/png")
 * @param pattern The pattern to match against (e.g., "image/asterisk")
 * @returns true if the MIME type matches the pattern
 */
export function matchesMimePattern(mimeType: string | undefined, pattern: string): boolean {
    if (!mimeType) return false;

    // Normalize to lowercase for case-insensitive comparison
    const normalizedMime = mimeType.toLowerCase().trim();
    const normalizedPattern = pattern.toLowerCase().trim();

    // Match everything
    if (normalizedPattern === '*' || normalizedPattern === '*/*') {
        return true;
    }

    // Exact match
    if (normalizedMime === normalizedPattern) {
        return true;
    }

    // Wildcard pattern (e.g., "image/*")
    if (normalizedPattern.endsWith('/*')) {
        const patternType = normalizedPattern.slice(0, -2); // Remove "/*"
        const mimeType = normalizedMime.split('/')[0]; // Get type part
        return mimeType === patternType;
    }

    return false;
}

/**
 * Check if a MIME type matches any pattern in an array of patterns.
 *
 * @param mimeType The MIME type to check
 * @param patterns Array of MIME patterns to match against
 * @returns true if the MIME type matches any pattern
 */
export function matchesAnyMimePattern(mimeType: string | undefined, patterns: string[]): boolean {
    return patterns.some((pattern) => matchesMimePattern(mimeType, pattern));
}

/**
 * Convert supported file types to MIME type patterns.
 * Used to translate LLM registry file types to MIME patterns for filtering.
 *
 * @param fileTypes Array of supported file types from LLM registry (e.g., ['image', 'pdf', 'audio'])
 * @returns Array of MIME type patterns (e.g., ['image/*', 'application/pdf', 'audio/*'])
 */
export function fileTypesToMimePatterns(fileTypes: string[], logger: IDextoLogger): string[] {
    const patterns: string[] = [];
    for (const fileType of fileTypes) {
        switch (fileType) {
            case 'image':
                patterns.push('image/*');
                break;
            case 'pdf':
                patterns.push('application/pdf');
                break;
            case 'audio':
                patterns.push('audio/*');
                break;
            case 'video':
                patterns.push('video/*');
                break;
            default:
                // Unknown file type - skip it
                logger.warn(`Unknown file type in registry: ${fileType}`);
        }
    }
    return patterns;
}

/**
 * Generate a descriptive placeholder for filtered media.
 * Returns a clean, LLM-readable reference like: [Video: demo.mp4 (5.2 MB)]
 *
 * @param metadata Blob metadata containing MIME type, size, and original name
 * @returns Formatted placeholder string
 */
function generateMediaPlaceholder(metadata: {
    mimeType: string;
    size: number;
    originalName?: string;
}): string {
    // Determine media type label
    let typeLabel = 'File';
    if (metadata.mimeType.startsWith('video/')) typeLabel = 'Video';
    else if (metadata.mimeType.startsWith('audio/')) typeLabel = 'Audio';
    else if (metadata.mimeType.startsWith('image/')) typeLabel = 'Image';
    else if (metadata.mimeType === 'application/pdf') typeLabel = 'PDF';

    // Format size in human-readable format
    const formatSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const size = formatSize(metadata.size);
    const name = metadata.originalName || 'unknown';

    return `[${typeLabel}: ${name} (${size})]`;
}

/**
 * Recursively sanitize objects by replacing suspiciously-large base64 strings
 * with placeholders to avoid blowing up the context window.
 */
function sanitizeDeepObject(obj: unknown, logger: IDextoLogger): unknown {
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
    if (Array.isArray(obj)) return obj.map((x) => sanitizeDeepObject(x, logger));
    if (typeof obj === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            out[k] = sanitizeDeepObject(v, logger);
        }
        return out;
    }
    return obj;
}

export async function normalizeToolResult(
    result: unknown,
    logger: IDextoLogger
): Promise<NormalizedToolResult> {
    const content = await sanitizeToolResultToContentWithBlobs(
        result,
        logger,
        undefined,
        undefined
    );

    // Separate UI resources from other parts since they need special handling
    const uiResources: UIResourcePart[] = [];
    const otherContent: InternalMessage['content'] = [];

    if (Array.isArray(content)) {
        for (const item of content) {
            if (item && typeof item === 'object' && 'type' in item && item.type === 'ui-resource') {
                uiResources.push(item as UIResourcePart);
            } else {
                otherContent.push(item);
            }
        }
    } else {
        // If content is not an array (string or other), pass through as-is
        (otherContent as unknown[]).push(content);
    }

    if (uiResources.length > 0) {
        logger.debug(
            `normalizeToolResult: extracted ${uiResources.length} UI resource(s): ${uiResources.map((r) => r.uri).join(', ')}`
        );
    }

    const parts = coerceContentToParts(otherContent as InternalMessage['content']);
    const inlineMedia: InlineMediaHint[] = [];

    parts.forEach((part, index) => {
        const hint = detectInlineMedia(part, index);
        if (hint) {
            inlineMedia.push(hint);
        }
    });

    return {
        parts,
        uiResources,
        inlineMedia,
    };
}

function shouldPersistInlineMedia(hint: InlineMediaHint): boolean {
    const kind = getFileMediaKind(hint.mimeType);
    if (kind === 'audio' || kind === 'video') {
        return true;
    }
    return hint.approxBytes >= MIN_TOOL_INLINE_MEDIA_BYTES;
}

export async function persistToolMedia(
    normalized: NormalizedToolResult,
    options: PersistToolMediaOptions,
    logger: IDextoLogger
): Promise<PersistToolMediaResult> {
    const parts = normalized.parts.map((part) => clonePart(part));
    const blobStore = options.blobStore;
    const namingOptions: ToolBlobNamingOptions | undefined =
        options.toolName || options.toolCallId
            ? {
                  ...(options.toolName ? { toolName: options.toolName } : {}),
                  ...(options.toolCallId ? { toolCallId: options.toolCallId } : {}),
              }
            : undefined;

    // Track stored blobs for annotation
    const storedBlobs: Array<{ uri: string; kind: string; mimeType: string; filename?: string }> =
        [];

    if (blobStore) {
        for (const hint of normalized.inlineMedia) {
            if (!shouldPersistInlineMedia(hint)) {
                continue;
            }

            try {
                const originalName =
                    hint.filename ??
                    buildToolBlobName(
                        hint.kind === 'image' ? 'image' : 'file',
                        hint.mimeType,
                        namingOptions
                    );

                const blobRef = await blobStore.store(hint.data, {
                    mimeType: hint.mimeType,
                    originalName,
                    source: 'tool',
                });

                const resourceUri = blobRef.uri;

                if (hint.kind === 'image') {
                    parts[hint.index] = createBlobImagePart(resourceUri, blobRef.metadata.mimeType);
                } else {
                    const resolvedMimeType = blobRef.metadata.mimeType || hint.mimeType;
                    const filename = blobRef.metadata.originalName ?? hint.filename;
                    parts[hint.index] = createBlobFilePart(resourceUri, resolvedMimeType, filename);
                }

                // Track for annotation
                storedBlobs.push({
                    uri: resourceUri,
                    kind: hint.kind,
                    mimeType: blobRef.metadata.mimeType,
                    ...(blobRef.metadata.originalName && {
                        filename: blobRef.metadata.originalName,
                    }),
                });
            } catch (error) {
                logger.warn(
                    `Failed to persist tool media: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    // Add text annotations for stored blobs so the agent knows the references
    // IMPORTANT: Use "resource_ref:" prefix (not "@blob:") to avoid expansion by expandBlobsInText()
    // The @blob: pattern triggers base64 expansion which would duplicate the image data
    if (storedBlobs.length > 0) {
        const annotations = storedBlobs
            .map((blob) => {
                const label = blob.filename || blob.kind;
                // Use resource_ref: prefix - agent should use this with get_shareable_url tool
                // Format: resource_ref:blob:abc123 (can be used as "@blob:abc123" or "blob:abc123" in tool calls)
                return `[Stored resource_ref:${blob.uri} (${label}, ${blob.mimeType})]`;
            })
            .join('\n');

        // Add annotation as a text part at the end
        parts.push({ type: 'text', text: annotations });
        logger.debug(`Added blob reference annotations for ${storedBlobs.length} resource(s)`);
    }

    const resources = extractResourceDescriptors(parts);

    return {
        parts,
        uiResources: normalized.uiResources,
        ...(resources ? { resources } : {}),
    };
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
    logger: IDextoLogger,
    blobStore?: import('../storage/blob/types.js').BlobStore,
    namingOptions?: ToolBlobNamingOptions
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
                const shouldStoreAsBlob = blobStore && approxSize > 1024; // Store blobs > 1KB

                if (shouldStoreAsBlob) {
                    try {
                        logger.debug(
                            `Storing data URI as blob (${approxSize} bytes, ${mediaType})`
                        );
                        const blobRef = await blobStore.store(result, {
                            mimeType: mediaType,
                            source: 'tool',
                            originalName: buildToolBlobName('output', mediaType, namingOptions),
                        });
                        logger.debug(`Stored blob: ${blobRef.uri} (${approxSize} bytes)`);

                        if (mediaType.startsWith('image/')) {
                            return [createBlobImagePart(blobRef.uri, mediaType)];
                        }
                        return [createBlobFilePart(blobRef.uri, mediaType, undefined)];
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
                return [
                    {
                        type: 'file',
                        data: dataUri.base64,
                        mimeType: mediaType,
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
                return [
                    {
                        type: 'text',
                        text: `${head}\n... [${result.length - 5000} chars omitted] ...\n${tail}`,
                    },
                ];
            }
            return [{ type: 'text', text: result }];
        }

        // Case 2: array of parts or mixed
        if (Array.isArray(result)) {
            const parts: Array<TextPart | ImagePart | FilePart | UIResourcePart> = [];
            for (const item of result as unknown[]) {
                if (item == null) continue;

                // Process each item recursively
                const processedItem = await sanitizeToolResultToContentWithBlobs(
                    item,
                    logger,
                    blobStore,
                    namingOptions
                );

                if (Array.isArray(processedItem)) {
                    parts.push(
                        ...(processedItem as Array<
                            TextPart | ImagePart | FilePart | UIResourcePart
                        >)
                    );
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
                    if (item && typeof item === 'object') {
                        // Handle MCP-UI resource type (ui:// URIs for interactive content)
                        if (item.type === 'resource' && item.resource) {
                            const resource = item.resource;
                            const resourceUri = resource.uri as string | undefined;

                            // Check if this is a UI resource (uri starts with ui://)
                            if (resourceUri && resourceUri.startsWith('ui://')) {
                                logger.debug(
                                    `Detected MCP-UI resource: ${resourceUri} (${resource.mimeType})`
                                );
                                // Extract metadata - @mcp-ui/server puts metadata in _meta field
                                const resourceMeta = resource._meta || {};
                                const title = resourceMeta.title || resource.title;
                                const preferredSize =
                                    resourceMeta.preferredSize || resource.preferredSize;

                                const uiPart: UIResourcePart = {
                                    type: 'ui-resource',
                                    uri: resourceUri,
                                    mimeType: resource.mimeType || 'text/html',
                                    content: resource.text,
                                    blob: resource.blob,
                                    metadata: {
                                        title,
                                        preferredSize,
                                    },
                                };
                                // Clean up undefined metadata fields
                                if (!uiPart.metadata?.title && !uiPart.metadata?.preferredSize) {
                                    delete uiPart.metadata;
                                }
                                processedContent.push(uiPart);
                                continue;
                            }
                        }

                        // Handle MCP resource type (embedded resources)
                        if (item.type === 'resource' && item.resource) {
                            const resource = item.resource;
                            if (resource.text && resource.mimeType) {
                                const fileData = resource.text;
                                const mimeType = resource.mimeType;

                                // Check if we should store as blob
                                const approxSize =
                                    typeof fileData === 'string'
                                        ? Math.floor((fileData.length * 3) / 4)
                                        : 0;
                                const shouldStoreAsBlob = blobStore && approxSize > 1024;

                                if (shouldStoreAsBlob) {
                                    try {
                                        logger.debug(
                                            `Storing MCP resource as blob (${approxSize} bytes, ${mimeType})`
                                        );
                                        const blobRef = await blobStore.store(fileData, {
                                            mimeType,
                                            source: 'tool',
                                            originalName: buildToolBlobName(
                                                mimeType.startsWith('image/') ? 'image' : 'file',
                                                mimeType,
                                                namingOptions,
                                                resource.title
                                            ),
                                        });
                                        logger.debug(
                                            `Stored MCP resource blob: ${blobRef.uri} (${approxSize} bytes)`
                                        );
                                        if (mimeType.startsWith('image/')) {
                                            processedContent.push(
                                                createBlobImagePart(blobRef.uri, mimeType)
                                            );
                                        } else {
                                            processedContent.push(
                                                createBlobFilePart(
                                                    blobRef.uri,
                                                    mimeType,
                                                    resource.title
                                                )
                                            );
                                        }
                                        continue;
                                    } catch (error) {
                                        logger.warn(
                                            `Failed to store MCP resource blob, falling back to inline: ${String(error)}`
                                        );
                                    }
                                }

                                // Fall back to original structure based on MIME type
                                if (mimeType.startsWith('image/')) {
                                    processedContent.push({
                                        type: 'image',
                                        image: fileData,
                                        mimeType,
                                    });
                                } else if (mimeType.startsWith('video/')) {
                                    processedContent.push({
                                        type: 'file',
                                        data: fileData,
                                        mimeType,
                                        filename: resource.title,
                                    });
                                } else {
                                    processedContent.push({
                                        type: 'file',
                                        data: fileData,
                                        mimeType,
                                        filename: resource.title,
                                    });
                                }
                                continue;
                            }
                        }

                        // Handle legacy data field (for backwards compatibility)
                        if ('data' in item && item.mimeType) {
                            const fileData = getFileData({ data: item.data }, logger);
                            const mimeType = item.mimeType;

                            // Check if we should store as blob
                            const approxSize =
                                typeof fileData === 'string'
                                    ? Math.floor((fileData.length * 3) / 4)
                                    : 0;
                            const shouldStoreAsBlob = blobStore && approxSize > 1024;

                            if (shouldStoreAsBlob) {
                                try {
                                    logger.debug(
                                        `Storing MCP content item as blob (${approxSize} bytes, ${mimeType})`
                                    );
                                    const blobRef = await blobStore.store(fileData, {
                                        mimeType,
                                        source: 'tool',
                                        originalName: buildToolBlobName(
                                            item.type === 'image' ? 'image' : 'file',
                                            mimeType,
                                            namingOptions,
                                            item.filename
                                        ),
                                    });
                                    logger.debug(
                                        `Stored MCP blob: ${blobRef.uri} (${approxSize} bytes)`
                                    );
                                    if (item.type === 'image') {
                                        processedContent.push(
                                            createBlobImagePart(blobRef.uri, mimeType)
                                        );
                                    } else {
                                        processedContent.push(
                                            createBlobFilePart(blobRef.uri, mimeType, item.filename)
                                        );
                                    }
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
                            continue;
                        }
                    }

                    // Non-media content, keep as-is
                    processedContent.push(item);
                }

                return processedContent;
            }

            // Common shapes: { image, mimeType? } or { data, mimeType }
            if ('image' in anyObj) {
                const imageData = getImageData({ image: anyObj.image }, logger);
                const mimeType = anyObj.mimeType || 'image/jpeg';

                // Check if we should store as blob
                const approxSize =
                    typeof imageData === 'string' ? Math.floor((imageData.length * 3) / 4) : 0;
                const shouldStoreAsBlob = blobStore && approxSize > 1024;

                if (shouldStoreAsBlob) {
                    try {
                        const blobRef = await blobStore.store(imageData, {
                            mimeType,
                            source: 'tool',
                            originalName: buildToolBlobName('image', mimeType, namingOptions),
                        });
                        logger.debug(
                            `Stored tool image as blob: ${blobRef.uri} (${approxSize} bytes)`
                        );
                        return [createBlobImagePart(blobRef.uri, mimeType)];
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
                const fileData = getFileData({ data: anyObj.data }, logger);
                const mimeType = anyObj.mimeType;

                // Check if we should store as blob
                const approxSize =
                    typeof fileData === 'string' ? Math.floor((fileData.length * 3) / 4) : 0;
                const shouldStoreAsBlob = blobStore && approxSize > 1024;

                if (shouldStoreAsBlob) {
                    try {
                        const blobRef = await blobStore.store(fileData, {
                            mimeType,
                            source: 'tool',
                            originalName: buildToolBlobName(
                                'file',
                                mimeType,
                                namingOptions,
                                anyObj.filename
                            ),
                        });
                        logger.debug(
                            `Stored tool file as blob: ${blobRef.uri} (${approxSize} bytes)`
                        );
                        return [createBlobFilePart(blobRef.uri, mimeType, anyObj.filename)];
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
            const cleaned = sanitizeDeepObject(anyObj, logger);
            return [{ type: 'text', text: safeStringify(cleaned) }];
        }

        // Fallback
        return [{ type: 'text', text: safeStringify(result ?? '') }];
    } catch (err) {
        logger.warn(
            `sanitizeToolResultToContentWithBlobs failed, falling back to string: ${String(err)}`
        );
        try {
            return [{ type: 'text', text: safeStringify(result ?? '') }];
        } catch {
            return [{ type: 'text', text: String(result ?? '') }];
        }
    }
}

// Deprecated: Use getResourceKind instead. Kept for internal backwards compatibility during migration.
function inferResourceKind(mimeType: string | undefined): 'image' | 'audio' | 'video' | 'binary' {
    return getResourceKind(mimeType);
}

function createBlobImagePart(uri: string, mimeType?: string): ImagePart {
    return {
        type: 'image',
        image: `@${uri}`,
        ...(mimeType ? { mimeType } : {}),
    };
}

function createBlobFilePart(uri: string, mimeType: string, filename?: string): FilePart {
    return {
        type: 'file',
        data: `@${uri}`,
        mimeType,
        ...(filename ? { filename } : {}),
    };
}

function extractResourceDescriptors(
    parts: Array<TextPart | ImagePart | FilePart>
): SanitizedToolResult['resources'] {
    const resources: NonNullable<SanitizedToolResult['resources']> = [];

    for (const part of parts) {
        if (
            part.type === 'image' &&
            typeof part.image === 'string' &&
            part.image.startsWith('@blob:')
        ) {
            resources.push({
                uri: part.image.substring(1),
                kind: 'image',
                mimeType: part.mimeType ?? 'image/jpeg',
            });
        }

        if (
            part.type === 'file' &&
            typeof part.data === 'string' &&
            part.data.startsWith('@blob:')
        ) {
            resources.push({
                uri: part.data.substring(1),
                kind: inferResourceKind(part.mimeType),
                mimeType: part.mimeType,
                ...(part.filename ? { filename: part.filename } : {}),
            });
        }
    }

    return resources.length > 0 ? resources : undefined;
}

export async function sanitizeToolResult(
    result: unknown,
    options: {
        blobStore?: import('../storage/blob/types.js').BlobStore;
        toolName: string;
        toolCallId: string;
        success: boolean;
    },
    logger: IDextoLogger
): Promise<SanitizedToolResult> {
    // Extract _display from tool result before normalization (if present)
    // Strip it from the payload to avoid duplicating large display data in LLM content
    let display: ToolDisplayData | undefined;
    let resultForNormalization = result;

    if (result && typeof result === 'object' && '_display' in result) {
        const { _display: rawDisplay, ...rest } = result as Record<string, unknown>;
        if (isValidDisplayData(rawDisplay)) {
            display = rawDisplay;
            logger.debug(
                `sanitizeToolResult: extracted display data (type=${display.type}) for ${options.toolName}`
            );
        }
        // Always strip _display from payload sent to LLM, even if invalid
        resultForNormalization = rest;
    }

    const normalized = await normalizeToolResult(resultForNormalization, logger);
    const persisted = await persistToolMedia(
        normalized,
        {
            ...(options.blobStore ? { blobStore: options.blobStore } : {}),
            toolName: options.toolName,
            toolCallId: options.toolCallId,
        },
        logger
    );

    const fallbackContent: TextPart[] = [{ type: 'text', text: '' }];
    // Combine regular parts with UI resources
    const allContent: Array<TextPart | ImagePart | FilePart | UIResourcePart> = [
        ...persisted.parts,
        ...persisted.uiResources,
    ];
    const content = allContent.length > 0 ? allContent : fallbackContent;

    if (persisted.uiResources.length > 0) {
        logger.debug(
            `sanitizeToolResult: including ${persisted.uiResources.length} UI resource(s) in final content for ${options.toolName}`
        );
    }

    return {
        content,
        ...(persisted.resources ? { resources: persisted.resources } : {}),
        meta: {
            toolName: options.toolName,
            toolCallId: options.toolCallId,
            success: options.success,
            ...(display ? { display } : {}),
        },
    };
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

/**
 * Filter history to exclude messages before the most recent summary.
 * This implements read-time compression for inline compaction.
 *
 * Used by:
 * - TurnExecutor for inline compaction during agentic turns (overflow handling)
 * - DextoAgent.getContextStats() for accurate token/message counts
 *
 * When a summary message exists (with metadata.isSummary === true or
 * metadata.isSessionSummary === true), this function returns only the
 * summary message and everything after it. This effectively hides old
 * messages from the LLM while preserving them in storage.
 *
 * @param history The full conversation history
 * @returns Filtered history starting from the most recent summary (or full history if no summary)
 */
export function filterCompacted(history: readonly InternalMessage[]): InternalMessage[] {
    // Find the most recent summary message (search backwards for efficiency)
    // Check for both old isSummary marker and new isSessionSummary marker
    let summaryIndex = -1;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg?.metadata?.isSummary === true || msg?.metadata?.isSessionSummary === true) {
            summaryIndex = i;
            break;
        }
    }

    // If no summary found, return full history (slice returns mutable copy)
    if (summaryIndex === -1) {
        return history.slice();
    }

    // Get the summary message (we know it exists since we found the index)
    const summaryMessage = history[summaryIndex]!;

    // Get the count of messages that were summarized (stored in metadata)
    // The preserved messages are between the summarized portion and the summary
    // Clamp to valid range: 0 <= originalMessageCount <= summaryIndex
    // For legacy summaries without metadata, default to summaryIndex (no preserved messages)
    const rawCount = summaryMessage.metadata?.originalMessageCount;
    const originalMessageCount =
        typeof rawCount === 'number' && rawCount >= 0 && rawCount <= summaryIndex
            ? rawCount
            : summaryIndex;

    // Layout after compaction:
    // [summarized..., preserved..., summary, afterSummary...]
    //  ^-- indices 0 to (originalMessageCount-1)
    //              ^-- indices originalMessageCount to (summaryIndex-1)
    //                          ^-- index summaryIndex
    //                                   ^-- indices (summaryIndex+1) onwards

    // Get preserved messages (messages between summarized portion and summary)
    const preservedMessages = history.slice(originalMessageCount, summaryIndex);

    // Get any messages added after the summary (rare but possible)
    const messagesAfterSummary = history.slice(summaryIndex + 1);

    // Return: summary + preserved + afterSummary
    return [summaryMessage, ...preservedMessages, ...messagesAfterSummary];
}

/**
 * Format tool output for display, respecting compactedAt marker.
 * If a tool message has been compacted (pruned), return a placeholder.
 *
 * @param message The tool message to format
 * @returns The content string or placeholder if compacted
 */
export function formatToolOutputForDisplay(message: InternalMessage): string {
    if (isToolMessage(message) && message.compactedAt) {
        return '[Old tool result content cleared]';
    }

    if (typeof message.content === 'string') {
        return message.content;
    }

    if (Array.isArray(message.content)) {
        // Extract text parts
        return message.content
            .filter((part): part is TextPart => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
    }

    return '[no content]';
}
