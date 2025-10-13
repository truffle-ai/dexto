import { SystemPromptContributor, DynamicContributorContext } from './types.js';
import { readFile, stat } from 'fs/promises';
import { resolve, extname } from 'path';
import { logger } from '../logger/index.js';
import { SystemPromptError } from './errors.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import type { MemoryManager } from '../memory/index.js';

export class StaticContributor implements SystemPromptContributor {
    constructor(
        public id: string,
        public priority: number,
        private content: string
    ) {}

    async getContent(_context: DynamicContributorContext): Promise<string> {
        return this.content;
    }
}

export class DynamicContributor implements SystemPromptContributor {
    constructor(
        public id: string,
        public priority: number,
        private promptGenerator: (context: DynamicContributorContext) => Promise<string>
    ) {}

    async getContent(context: DynamicContributorContext): Promise<string> {
        return this.promptGenerator(context);
    }
}

export interface FileContributorOptions {
    includeFilenames?: boolean | undefined;
    separator?: string | undefined;
    errorHandling?: 'skip' | 'error' | undefined;
    maxFileSize?: number | undefined;
    includeMetadata?: boolean | undefined;
    cache?: boolean | undefined;
}

export class FileContributor implements SystemPromptContributor {
    // Basic in-memory cache to avoid reading files on every prompt build
    private cache: Map<string, string> = new Map();

    constructor(
        public id: string,
        public priority: number,
        private files: string[],
        private options: FileContributorOptions = {},
        private configDir: string = process.cwd()
    ) {
        logger.debug(
            `[FileContributor] Created "${id}" with configDir: ${configDir} and files: ${JSON.stringify(files)}`
        );
    }

    async getContent(_context: DynamicContributorContext): Promise<string> {
        const {
            includeFilenames = true,
            separator = '\n\n---\n\n',
            errorHandling = 'skip',
            maxFileSize = 100000,
            includeMetadata = false,
            cache = true,
        } = this.options;

        // If caching is enabled, check if we have cached content
        if (cache) {
            const cacheKey = JSON.stringify({ files: this.files, options: this.options });
            const cached = this.cache.get(cacheKey);
            if (cached) {
                logger.debug(`[FileContributor] Using cached content for "${this.id}"`);
                return cached;
            }
        }

        const fileParts: string[] = [];

        for (const filePath of this.files) {
            try {
                // Resolve relative paths from config directory
                const resolvedPath = resolve(this.configDir, filePath);
                logger.debug(
                    `[FileContributor] Resolving path: ${filePath} with configDir: ${this.configDir} → ${resolvedPath}`
                );

                // Check if file is .md or .txt
                const ext = extname(resolvedPath).toLowerCase();
                if (ext !== '.md' && ext !== '.txt') {
                    if (errorHandling === 'error') {
                        throw SystemPromptError.invalidFileType(filePath, ['.md', '.txt']);
                    }
                    continue;
                }

                // Check file size
                const stats = await stat(resolvedPath);
                if (stats.size > maxFileSize) {
                    if (errorHandling === 'error') {
                        throw SystemPromptError.fileTooLarge(filePath, stats.size, maxFileSize);
                    }
                    continue;
                }

                // Read file content (always utf-8)
                const content = await readFile(resolvedPath, { encoding: 'utf-8' });

                // Build file part
                let filePart = '';

                if (includeFilenames) {
                    filePart += `## ${filePath}\n\n`;
                }

                if (includeMetadata) {
                    filePart += `*File size: ${stats.size} bytes, Modified: ${stats.mtime.toISOString()}*\n\n`;
                }

                filePart += content;

                fileParts.push(filePart);
            } catch (error: unknown) {
                if (errorHandling === 'error') {
                    // Preserve previously constructed structured errors
                    if (error instanceof DextoRuntimeError) {
                        throw error;
                    }
                    const reason = error instanceof Error ? error.message : String(error);
                    throw SystemPromptError.fileReadFailed(filePath, reason);
                }
                // 'skip' mode - do nothing, continue to next file
            }
        }

        if (fileParts.length === 0) {
            return '<fileContext>No files could be loaded</fileContext>';
        }

        const combinedContent = fileParts.join(separator);
        const result = `<fileContext>\n${combinedContent}\n</fileContext>`;

        // Cache the result if caching is enabled
        if (cache) {
            const cacheKey = JSON.stringify({ files: this.files, options: this.options });
            this.cache.set(cacheKey, result);
            logger.debug(`[FileContributor] Cached content for "${this.id}"`);
        }

        return result;
    }
}

export interface MemoryContributorOptions {
    /** Whether to include timestamps in memory display */
    includeTimestamps?: boolean | undefined;
    /** Whether to include tags in memory display */
    includeTags?: boolean | undefined;
    /** Maximum number of memories to include */
    limit?: number | undefined;
    /** Only include pinned memories (for hybrid approach) */
    pinnedOnly?: boolean | undefined;
}

/**
 * MemoryContributor loads user memories from the database and formats them
 * for inclusion in the system prompt.
 *
 * This enables memories to be automatically available in every conversation.
 */
export class MemoryContributor implements SystemPromptContributor {
    constructor(
        public id: string,
        public priority: number,
        private memoryManager: MemoryManager,
        private options: MemoryContributorOptions = {}
    ) {
        logger.debug(
            `[MemoryContributor] Created "${id}" with options: ${JSON.stringify(options)}`
        );
    }

    async getContent(_context: DynamicContributorContext): Promise<string> {
        const {
            includeTimestamps = false,
            includeTags = true,
            limit,
            pinnedOnly = false,
        } = this.options;

        try {
            // Fetch memories from the database
            const memories = await this.memoryManager.list({
                ...(limit !== undefined && { limit }),
                ...(pinnedOnly && { pinned: true }),
            });

            if (memories.length === 0) {
                return '';
            }

            // Format memories for system prompt
            const formattedMemories = memories.map((memory) => {
                let formatted = `- ${memory.content}`;

                if (includeTags && memory.tags && memory.tags.length > 0) {
                    formatted += ` [Tags: ${memory.tags.join(', ')}]`;
                }

                if (includeTimestamps) {
                    const date = new Date(memory.updatedAt).toLocaleDateString();
                    formatted += ` (Updated: ${date})`;
                }

                return formatted;
            });

            const header = '## User Memories';
            const memoryList = formattedMemories.join('\n');
            const result = `${header}\n${memoryList}`;

            logger.debug(
                `[MemoryContributor] Loaded ${memories.length} memories into system prompt`
            );
            return result;
        } catch (error) {
            logger.error(
                `[MemoryContributor] Failed to load memories: ${error instanceof Error ? error.message : String(error)}`
            );
            // Return empty string on error to not break system prompt generation
            return '';
        }
    }
}
