import type { WorkspaceFiles } from '@dexto/core/workspace';
import { FileSystemError } from './errors.js';

/**
 * Refuses text that is larger than the configured `maxFileSize`.
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

/**
 * Reads a workspace text file, refusing one larger than `maxFileSize`. When the handle can report
 * a size, that is checked first so an oversized file is never read. The size of the text is
 * checked as well, for handles that cannot report one and in case the file changed in between.
 */
export async function readTextWithinMaxFileSize(
    files: WorkspaceFiles,
    workspacePath: string,
    maxFileSize: number
): Promise<string> {
    if (files.readFileSize !== undefined) {
        const size = await files.readFileSize(workspacePath);
        if (size > maxFileSize) {
            throw FileSystemError.fileTooLarge(workspacePath, size, maxFileSize);
        }
    }
    const content = await files.readText(workspacePath);
    assertWithinMaxFileSize(workspacePath, content, maxFileSize);
    return content;
}
