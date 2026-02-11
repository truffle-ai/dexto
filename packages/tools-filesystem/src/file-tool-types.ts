/**
 * File Tool Types
 *
 * Types shared between file tools and factories.
 */

import type { ToolExecutionContext } from '@dexto/core';
import type { FileSystemService } from './filesystem-service.js';

/**
 * Getter for a lazily-initialized {@link FileSystemService}.
 * Tool factories construct tools before runtime services are available, so tools
 * resolve the service on-demand using {@link ToolExecutionContext}.
 */
export type FileSystemServiceGetter = (
    context?: ToolExecutionContext
) => FileSystemService | Promise<FileSystemService>;

export type FileSystemServiceOrGetter = FileSystemService | FileSystemServiceGetter;
