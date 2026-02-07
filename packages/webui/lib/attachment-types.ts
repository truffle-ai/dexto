/**
 * Attachment types and constants for file/image uploads in the WebUI.
 * Used for copy-paste and drag-drop functionality.
 */

/**
 * Represents a single attachment (image or file) with metadata.
 */
export interface Attachment {
    /** Unique identifier for this attachment */
    id: string;
    /** Type of attachment */
    type: 'image' | 'file';
    /** Base64-encoded data */
    data: string;
    /** MIME type of the file/image */
    mimeType: string;
    /** Original filename (optional for images, required for files) */
    filename?: string;
    /** Size in bytes */
    size: number;
    /** Source of the attachment (how it was added) */
    source: 'button' | 'paste' | 'drop';
}

/**
 * Content part types for message content.
 * Used when building messages with text and/or attachments.
 */
export type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image'; image: string; mimeType?: string }
    | { type: 'file'; data: string; mimeType: string; filename?: string };

/**
 * Attachment limits and constraints.
 */
export const ATTACHMENT_LIMITS = {
    /** Maximum size per file in bytes (5MB) */
    MAX_FILE_SIZE: 5 * 1024 * 1024,
    /** Maximum number of attachments per message */
    MAX_COUNT: 5,
    /** Maximum total size of all attachments in bytes (25MB = 5MB × 5 files) */
    MAX_TOTAL_SIZE: 25 * 1024 * 1024,
} as const;

/**
 * Default safe file type categories allowed when LLM capabilities aren't loaded.
 * This provides a security baseline - all uploads are validated against this list
 * even if model-specific capabilities are unavailable.
 */
export const DEFAULT_SAFE_FILE_TYPES = ['image', 'pdf', 'audio'] as const;
