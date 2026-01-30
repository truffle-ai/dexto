/**
 * Web UI-specific type definitions.
 * API response types are inferred from Hono client - do not duplicate them here.
 */

// =============================================================================
// Content Part Types
// =============================================================================
// TODO: Derive these from Hono client response types once API schemas are
// properly typed. These are the JSON-serialized shapes used throughout the UI
// for message content parts (from API responses, session history, etc.).
// Core types allow Buffer | URL | ArrayBuffer but UI only uses strings.

// Re-export UIResourcePart from core (already string-only, no Buffer/URL)
export type { UIResourcePart } from '@dexto/core';

/** Text content part */
export interface TextPart {
    type: 'text';
    text: string;
}

/** Image content part (base64-encoded or blob URI) */
export interface ImagePart {
    type: 'image';
    image: string;
    mimeType?: string;
}

/** File content part (base64-encoded or blob URI) */
export interface FilePart {
    type: 'file';
    data: string;
    mimeType: string;
    filename?: string;
}

/** Audio content part (base64-encoded) */
export interface AudioPart {
    type: 'audio';
    data: string;
    mimeType: string;
    filename?: string;
}

/** File data for user attachments (same shape as FilePart without type) */
export interface FileData {
    data: string;
    mimeType: string;
    filename?: string;
}

/** Type guard for text parts */
export function isTextPart(part: unknown): part is TextPart {
    return (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type: unknown }).type === 'text'
    );
}

/** Type guard for image parts */
export function isImagePart(part: unknown): part is ImagePart {
    return (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type: unknown }).type === 'image'
    );
}

/** Type guard for file parts */
export function isFilePart(part: unknown): part is FilePart {
    return (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type: unknown }).type === 'file'
    );
}

/** Type guard for audio parts */
export function isAudioPart(part: unknown): part is AudioPart {
    return (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type: unknown }).type === 'audio'
    );
}

/** Type guard for UI resource parts */
export function isUIResourcePart(part: unknown): part is import('@dexto/core').UIResourcePart {
    return (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type: unknown }).type === 'ui-resource'
    );
}
