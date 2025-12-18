/**
 * FileSystem Tools Provider
 *
 * Provides file operation tools by wrapping FileSystemService.
 * When registered, the provider initializes FileSystemService and creates tools
 * for file operations (read, write, edit, glob, grep).
 */

import { z } from 'zod';
import type { CustomToolProvider, ToolCreationContext } from '@dexto/core';
import type { InternalTool } from '@dexto/core';
import { FileSystemService } from './filesystem-service.js';
import { createReadFileTool } from './read-file-tool.js';
import { createWriteFileTool } from './write-file-tool.js';
import { createEditFileTool } from './edit-file-tool.js';
import { createGlobFilesTool } from './glob-files-tool.js';
import { createGrepContentTool } from './grep-content-tool.js';

/**
 * Configuration schema for FileSystem tools provider
 */
const FileSystemToolsConfigSchema = z
    .object({
        type: z.literal('filesystem-tools'),
        allowedPaths: z
            .array(z.string())
            .optional()
            .default(['.'])
            .describe('List of allowed base paths for file operations'),
        blockedPaths: z
            .array(z.string())
            .optional()
            .default(['.git', 'node_modules/.bin', '.env'])
            .describe('List of blocked paths to exclude from operations'),
        blockedExtensions: z
            .array(z.string())
            .optional()
            .default(['.exe', '.dll', '.so'])
            .describe('List of blocked file extensions'),
        maxFileSize: z
            .number()
            .int()
            .positive()
            .optional()
            .default(10 * 1024 * 1024) // 10MB
            .describe('Maximum file size in bytes (default: 10MB)'),
        workingDirectory: z
            .string()
            .optional()
            .describe('Working directory for file operations (defaults to process.cwd())'),
        enableBackups: z
            .boolean()
            .optional()
            .default(false)
            .describe('Enable automatic backups of modified files'),
        backupPath: z
            .string()
            .optional()
            .describe('Absolute path for storing file backups (if enableBackups is true)'),
        backupRetentionDays: z
            .number()
            .int()
            .positive()
            .optional()
            .default(7)
            .describe('Number of days to retain backup files (default: 7)'),
    })
    .strict();

type FileSystemToolsConfig = z.output<typeof FileSystemToolsConfigSchema>;

/**
 * FileSystem tools provider.
 *
 * Wraps FileSystemService and provides file operation tools:
 * - read_file: Read file contents with pagination
 * - write_file: Write or overwrite file contents
 * - edit_file: Edit files using search/replace operations
 * - glob_files: Find files matching glob patterns
 * - grep_content: Search file contents using regex
 *
 * When registered via customToolRegistry, FileSystemService is automatically
 * initialized and file operation tools become available to the agent.
 */
export const fileSystemToolsProvider: CustomToolProvider<
    'filesystem-tools',
    FileSystemToolsConfig
> = {
    type: 'filesystem-tools',
    configSchema: FileSystemToolsConfigSchema,

    create: (config: FileSystemToolsConfig, context: ToolCreationContext): InternalTool[] => {
        const { logger } = context;

        logger.debug('Creating FileSystemService for filesystem tools');

        // Create FileSystemService with validated config
        const fileSystemService = new FileSystemService(
            {
                allowedPaths: config.allowedPaths,
                blockedPaths: config.blockedPaths,
                blockedExtensions: config.blockedExtensions,
                maxFileSize: config.maxFileSize,
                workingDirectory: config.workingDirectory || process.cwd(),
                enableBackups: config.enableBackups,
                backupPath: config.backupPath,
                backupRetentionDays: config.backupRetentionDays,
            },
            logger
        );

        // Initialize service (synchronous in current implementation)
        fileSystemService.initialize().catch((error) => {
            logger.error(`Failed to initialize FileSystemService: ${error.message}`);
            throw error;
        });

        logger.info('FileSystemService initialized - file operation tools available');

        // Create and return all file operation tools
        return [
            createReadFileTool(fileSystemService),
            createWriteFileTool(fileSystemService),
            createEditFileTool(fileSystemService),
            createGlobFilesTool(fileSystemService),
            createGrepContentTool(fileSystemService),
        ];
    },

    metadata: {
        displayName: 'FileSystem Tools',
        description: 'File system operations (read, write, edit, glob, grep)',
        category: 'filesystem',
    },
};
