/**
 * FileSystem Tools Provider
 *
 * Provides file operation tools by wrapping FileSystemService.
 * When registered, the provider initializes FileSystemService and creates tools
 * for file operations (read, write, edit, glob, grep).
 */

import { z } from 'zod';

/**
 * Default configuration constants for FileSystem tools.
 * These are the SINGLE SOURCE OF TRUTH for all default values.
 */
const DEFAULT_ALLOWED_PATHS = ['.'];
const DEFAULT_BLOCKED_PATHS = ['.git', 'node_modules/.bin', '.env'];
const DEFAULT_BLOCKED_EXTENSIONS = ['.exe', '.dll', '.so'];
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_ENABLE_BACKUPS = false;
const DEFAULT_BACKUP_RETENTION_DAYS = 7;

/**
 * Available filesystem tool names for enabledTools configuration.
 */
const FILESYSTEM_TOOL_NAMES = [
    'read_file',
    'write_file',
    'edit_file',
    'glob_files',
    'grep_content',
] as const;

/**
 * Configuration schema for FileSystem tools provider.
 *
 * This is the SINGLE SOURCE OF TRUTH for all configuration:
 * - Validation rules
 * - Default values (using constants above)
 * - Documentation
 * - Type definitions
 *
 * Services receive fully-validated config from this schema and use it as-is,
 * with no additional defaults or fallbacks needed.
 */
export const FileSystemToolsConfigSchema = z
    .object({
        type: z.literal('filesystem-tools'),
        allowedPaths: z
            .array(z.string())
            .default(DEFAULT_ALLOWED_PATHS)
            .describe('List of allowed base paths for file operations'),
        blockedPaths: z
            .array(z.string())
            .default(DEFAULT_BLOCKED_PATHS)
            .describe('List of blocked paths to exclude from operations'),
        blockedExtensions: z
            .array(z.string())
            .default(DEFAULT_BLOCKED_EXTENSIONS)
            .describe('List of blocked file extensions'),
        maxFileSize: z
            .number()
            .int()
            .positive()
            .default(DEFAULT_MAX_FILE_SIZE)
            .describe(
                `Maximum file size in bytes (default: ${DEFAULT_MAX_FILE_SIZE / 1024 / 1024}MB)`
            ),
        workingDirectory: z
            .string()
            .optional()
            .describe('Working directory for file operations (defaults to process.cwd())'),
        enableBackups: z
            .boolean()
            .default(DEFAULT_ENABLE_BACKUPS)
            .describe('Enable automatic backups of modified files'),
        backupPath: z
            .string()
            .optional()
            .describe('Absolute path for storing file backups (if enableBackups is true)'),
        backupRetentionDays: z
            .number()
            .int()
            .positive()
            .default(DEFAULT_BACKUP_RETENTION_DAYS)
            .describe(
                `Number of days to retain backup files (default: ${DEFAULT_BACKUP_RETENTION_DAYS})`
            ),
        enabledTools: z
            .array(z.enum(FILESYSTEM_TOOL_NAMES))
            .optional()
            .describe(
                `Subset of tools to enable. If not specified, all tools are enabled. Available: ${FILESYSTEM_TOOL_NAMES.join(', ')}`
            ),
    })
    .strict();

export type FileSystemToolsConfig = z.output<typeof FileSystemToolsConfigSchema>;
