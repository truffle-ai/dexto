import { FileSystemError } from './errors.js';

/**
 * Refuses text read through a workspace handle that is larger than the configured
 * `maxFileSize`. The handle has no stat call, so the size is checked once the text is in hand.
 */
export function assertWithinMaxFileSize(
    workspacePath: string,
    content: string,
    maxFileSize: number
): void {
    const size = Buffer.byteLength(content, 'utf-8');
    if (size > maxFileSize) {
        throw FileSystemError.fileTooLarge(workspacePath, size, maxFileSize);
    }
}
