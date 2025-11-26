import type { TextPart, ImagePart, FilePart } from './schemas.js';

// Re-export all types from schemas (schema is source of truth)
export type {
    TextPart,
    ImageData,
    ImagePart,
    FileData,
    FilePart,
    ContentPart,
    TokenUsage,
    ToolCall,
    InternalMessage,
} from './schemas.js';

// Re-export schemas for consumers that need runtime validation
export {
    TextPartSchema,
    ImageDataSchema,
    ImagePartSchema,
    FileDataSchema,
    FilePartSchema,
    ContentPartSchema,
    TokenUsageSchema,
    ToolCallSchema,
    InternalMessageSchema,
} from './schemas.js';

// SanitizedToolResult is UI-specific, kept here for now
export interface SanitizedToolResult {
    /** Ordered content parts ready for rendering or provider formatting */
    content: Array<TextPart | ImagePart | FilePart>;
    /**
     * Resource references created during sanitization (e.g. blob store URIs).
     * Consumers can dereference these via ResourceManager APIs.
     */
    resources?: Array<{
        uri: string;
        kind: 'image' | 'audio' | 'video' | 'binary';
        mimeType: string;
        filename?: string;
    }>;
    meta: {
        toolName: string;
        toolCallId: string;
        success?: boolean;
    };
}
