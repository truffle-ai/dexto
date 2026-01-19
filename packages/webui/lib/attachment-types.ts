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
 * Attachment limits and constraints.
 */
export const ATTACHMENT_LIMITS = {
    /** Maximum size per file in bytes (25MB) */
    MAX_FILE_SIZE: 25 * 1024 * 1024,
    /** Maximum number of attachments per message */
    MAX_COUNT: 5,
    /** Maximum total size of all attachments in bytes (125MB) */
    MAX_TOTAL_SIZE: 125 * 1024 * 1024,
} as const;
