/**
 * Utility functions for handling attachments (images and files).
 */

import type { Attachment, ContentPart } from './attachment-types.js';

/**
 * Generate a unique ID for an attachment.
 * Uses timestamp + random suffix for uniqueness.
 */
export function generateAttachmentId(): string {
    return `attachment_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Estimate the size of base64-encoded data in bytes.
 * Base64 encoding adds ~33% overhead, so we reverse that calculation.
 *
 * @param base64 - Base64-encoded string (may include data URI prefix)
 * @returns Estimated size in bytes
 */
export function estimateBase64Size(base64: string): number {
    // Remove data URI prefix if present (e.g., "data:image/png;base64,")
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;

    // Remove padding characters
    const withoutPadding = base64Data.replace(/=/g, '');

    // Each base64 character represents 6 bits, so total bits = length * 6
    // Convert to bytes: (length * 6) / 8 = length * 0.75
    return Math.ceil(withoutPadding.length * 0.75);
}

/**
 * Get the file type category based on MIME type.
 *
 * @param mimeType - MIME type string
 * @returns Category: 'image', 'audio', 'pdf', or 'other'
 */
export function getFileTypeCategory(mimeType: string): 'image' | 'audio' | 'pdf' | 'other' {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType === 'application/pdf') return 'pdf';
    return 'other';
}

/**
 * Format file size in bytes to human-readable string.
 *
 * @param bytes - Size in bytes
 * @returns Formatted string (e.g., "1.5 MB", "342 KB")
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = bytes / Math.pow(k, i);

    // Show 1 decimal place for KB and above, none for bytes
    const decimals = i === 0 ? 0 : 1;

    return `${size.toFixed(decimals)} ${units[i]}`;
}

/**
 * Basic validation for a file before processing.
 * Checks file size and basic properties.
 *
 * @param file - File to validate
 * @param maxSize - Maximum allowed size in bytes
 * @returns Validation result with error message if invalid
 */
export function validateAttachment(
    file: File,
    maxSize: number
): { valid: true } | { valid: false; reason: string } {
    if (!file) {
        return { valid: false, reason: 'No file provided' };
    }

    if (file.size === 0) {
        return { valid: false, reason: 'File is empty' };
    }

    if (file.size > maxSize) {
        return {
            valid: false,
            reason: `File size (${formatFileSize(file.size)}) exceeds limit (${formatFileSize(maxSize)})`,
        };
    }

    return { valid: true };
}

/**
 * Build content parts array from text and attachments.
 * Converts attachments into the appropriate content part format for API requests.
 *
 * @param text - Optional text content
 * @param attachments - Optional array of attachments (images/files)
 * @returns Array of content parts ready for API submission
 */
export function buildContentParts(text?: string, attachments?: Attachment[]): ContentPart[] {
    const contentParts: ContentPart[] = [];

    if (text) {
        contentParts.push({ type: 'text', text });
    }

    if (attachments) {
        for (const attachment of attachments) {
            if (attachment.type === 'image') {
                contentParts.push({
                    type: 'image',
                    image: attachment.data,
                    mimeType: attachment.mimeType,
                });
            } else {
                contentParts.push({
                    type: 'file',
                    data: attachment.data,
                    mimeType: attachment.mimeType,
                    filename: attachment.filename,
                });
            }
        }
    }

    return contentParts;
}

/**
 * Resolve the message content to send/store.
 * Collapses a single text-only part back to a plain string; keeps the full
 * ContentPart array for multimodal messages.
 *
 * @param text - Optional text content
 * @param attachments - Optional array of attachments
 * @returns Plain string for text-only messages, ContentPart[] for multimodal
 */
export function resolveMessageContent(
    text?: string,
    attachments?: Attachment[]
): string | ContentPart[] {
    const parts = buildContentParts(text, attachments);
    return parts.length === 1 && parts[0]?.type === 'text' ? (text ?? '') : parts;
}
