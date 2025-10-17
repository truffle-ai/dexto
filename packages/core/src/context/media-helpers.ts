/**
 * Browser-safe media kind helpers.
 * These functions have no dependencies and can be safely imported in browser environments.
 */

/**
 * Derive file media kind from MIME type.
 * This is the canonical way to determine media kind - use this instead of storing redundant fields.
 */
export function getFileMediaKind(mimeType: string | undefined): 'audio' | 'video' | 'binary' {
    if (mimeType?.startsWith('audio/')) return 'audio';
    if (mimeType?.startsWith('video/')) return 'video';
    return 'binary';
}

/**
 * Derive resource kind from MIME type (includes images).
 * Use this to determine the kind of resource for display/rendering purposes.
 */
export function getResourceKind(
    mimeType: string | undefined
): 'image' | 'audio' | 'video' | 'binary' {
    if (mimeType?.startsWith('image/')) return 'image';
    if (mimeType?.startsWith('audio/')) return 'audio';
    if (mimeType?.startsWith('video/')) return 'video';
    return 'binary';
}
