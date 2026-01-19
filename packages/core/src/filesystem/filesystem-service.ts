/**
 * FileSystem Service
 *
 * Secure file system operations for Dexto internal tools
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
import { getDextoPath } from '../utils/path.js';
import {
    FileSystemConfig,
    FileContent,
    ReadFileOptions,
    GlobOptions,
    GlobResult,
    GrepOptions,
    SearchResult,
    SearchMatch,
    WriteFileOptions,
    WriteResult,
    EditFileOptions,
    EditResult,
    EditOperation,
    FileMetadata,
    BufferEncoding,
} from './types.js';
import { PathValidator, type DirectoryApprovalChecker } from './path-validator.js';
import { FileSystemError } from './errors.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';

const DEFAULT_ENCODING: BufferEncoding = 'utf-8';
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_RESULTS = 1000;
const DEFAULT_MAX_SEARCH_RESULTS = 100;

/**
 * FileSystemService - Handles all file system operations with security checks
 * TODO: Add tests for this class
 * TODO: instantiate only when internal file tools are enabled to avoid file dependencies which won't work in serverless
 */
export class FileSystemService {
    private config: FileSystemConfig;
    private pathValidator: PathValidator;
    private initialized: boolean = false;
    private logger: IDextoLogger;

    constructor(config: Partial<FileSystemConfig> = {}, logger: IDextoLogger) {
        // Set defaults
        this.config = {
            allowedPaths: config.allowedPaths || ['.'],
            blockedPaths: config.blockedPaths || ['.git', 'node_modules/.bin', '.env'],
            blockedExtensions: config.blockedExtensions || ['.exe', '.dll', '.so'],
            maxFileSize: config.maxFileSize || DEFAULT_MAX_FILE_SIZE,
            enableBackups: config.enableBackups ?? false,
            backupPath: config.backupPath, // Optional absolute override, defaults handled by getBackupDir()
            backupRetentionDays: config.backupRetentionDays || 7,
            workingDirectory: config.workingDirectory,
        };

        this.logger = logger.createChild(DextoLogComponent.FILESYSTEM);
        this.pathValidator = new PathValidator(this.config, this.logger);
    }

    /**
     * Get backup directory path (context-aware with optional override)
     * TODO: Migrate to explicit configuration via CLI enrichment layer (per-agent paths)
     */
    private getBackupDir(): string {
        // Use custom path if provided (absolute), otherwise use context-aware default
        return this.config.backupPath || getDextoPath('backups');
    }

    /**
     * Initialize the service
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            this.logger.debug('FileSystemService already initialized');
            return;
        }

        // Create backup directory if backups are enabled
        if (this.config.enableBackups) {
            try {
                const backupDir = this.getBackupDir();
                await fs.mkdir(backupDir, { recursive: true });
                this.logger.debug(`Backup directory created/verified: ${backupDir}`);
            } catch (error) {
                this.logger.warn(
                    `Failed to create backup directory: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        this.initialized = true;
        this.logger.info('FileSystemService initialized successfully');
    }

    /**
     * Check if a file path is within the configured allowed paths.
     * This is a public method for external consumers (like ToolManager) to check
     * if a path requires directory approval before file operations.
     *
     * @param filePath The file path to check (can be relative or absolute)
     * @returns true if the path is within allowed paths, false otherwise
     */
    isPathWithinAllowed(filePath: string): boolean {
        return this.pathValidator.isPathWithinAllowed(filePath);
    }

    /**
     * Get the list of configured allowed paths.
     * Useful for displaying to users when directory approval is needed.
     *
     * @returns Array of allowed path strings
     */
    getAllowedPaths(): string[] {
        return this.pathValidator.getAllowedPaths();
    }

    /**
     * Get the parent directory of a file path (resolved to absolute).
     * Useful for directory approval requests.
     *
     * @param filePath The file path
     * @returns The absolute parent directory path
     */
    getParentDirectory(filePath: string): string {
        return path.dirname(path.resolve(filePath));
    }

    /**
     * Set a callback to check if a path is in an approved directory.
     * This allows PathValidator to consult ApprovalManager without a direct dependency.
     *
     * @param checker Function that returns true if path is in an approved directory
     */
    setDirectoryApprovalChecker(checker: DirectoryApprovalChecker): void {
        this.pathValidator.setDirectoryApprovalChecker(checker);
    }

    /**
     * Read a file with validation and size limits
     */
    async readFile(filePath: string, options: ReadFileOptions = {}): Promise<FileContent> {
        if (!this.initialized) {
            throw FileSystemError.notInitialized();
        }

        // Validate path
        const validation = this.pathValidator.validatePath(filePath);
        if (!validation.isValid || !validation.normalizedPath) {
            throw FileSystemError.invalidPath(filePath, validation.error || 'Unknown error');
        }

        const normalizedPath = validation.normalizedPath;

        // Check if file exists
        try {
            const stats = await fs.stat(normalizedPath);

            if (!stats.isFile()) {
                throw FileSystemError.invalidPath(normalizedPath, 'Path is not a file');
            }

            // Check file size
            if (stats.size > this.config.maxFileSize) {
                throw FileSystemError.fileTooLarge(
                    normalizedPath,
                    stats.size,
                    this.config.maxFileSize
                );
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw FileSystemError.fileNotFound(normalizedPath);
            }
            if ((error as NodeJS.ErrnoException).code === 'EACCES') {
                throw FileSystemError.permissionDenied(normalizedPath, 'read');
            }
            throw FileSystemError.readFailed(
                normalizedPath,
                error instanceof Error ? error.message : String(error)
            );
        }

        // Read file
        try {
            const encoding = options.encoding || DEFAULT_ENCODING;
            const content = await fs.readFile(normalizedPath, encoding);
            const lines = content.split('\n');

            // Handle offset (1-based per types) and limit
            const limit = options.limit;
            const offset1 = options.offset; // 1-based if provided

            let selectedLines: string[];
            let truncated = false;

            if ((offset1 && offset1 > 0) || limit !== undefined) {
                const start = offset1 && offset1 > 0 ? Math.max(0, offset1 - 1) : 0;
                const end = limit !== undefined ? start + limit : lines.length;
                selectedLines = lines.slice(start, end);
                truncated = end < lines.length;
            } else {
                selectedLines = lines;
            }

            return {
                content: selectedLines.join('\n'),
                lines: selectedLines.length,
                encoding,
                truncated,
                size: Buffer.byteLength(content, encoding),
            };
        } catch (error) {
            throw FileSystemError.readFailed(
                normalizedPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Find files matching a glob pattern
     */
    async globFiles(pattern: string, options: GlobOptions = {}): Promise<GlobResult> {
        if (!this.initialized) {
            throw FileSystemError.notInitialized();
        }

        const cwd: string = options.cwd || this.config.workingDirectory || process.cwd();
        const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;

        try {
            // Execute glob search
            const files = await glob(pattern, {
                cwd,
                absolute: true,
                nodir: true, // Only files
                follow: false, // Don't follow symlinks
            });

            // Validate each path and collect metadata
            const validFiles: FileMetadata[] = [];

            for (const file of files) {
                // Validate path
                const validation = this.pathValidator.validatePath(file);
                if (!validation.isValid || !validation.normalizedPath) {
                    this.logger.debug(`Skipping invalid path: ${file}`);
                    continue;
                }

                // Get metadata if requested
                if (options.includeMetadata !== false) {
                    try {
                        const stats = await fs.stat(validation.normalizedPath);
                        validFiles.push({
                            path: validation.normalizedPath,
                            size: stats.size,
                            modified: stats.mtime,
                            isDirectory: stats.isDirectory(),
                        });
                    } catch (error) {
                        this.logger.debug(
                            `Failed to stat file ${file}: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                } else {
                    validFiles.push({
                        path: validation.normalizedPath,
                        size: 0,
                        modified: new Date(),
                        isDirectory: false,
                    });
                }

                // Check if we've reached the limit
                if (validFiles.length >= maxResults) {
                    break;
                }
            }

            const limited = validFiles.length >= maxResults;
            return {
                files: validFiles,
                truncated: limited,
                totalFound: validFiles.length,
            };
        } catch (error) {
            throw FileSystemError.globFailed(
                pattern,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Search for content in files (grep-like functionality)
     */
    async searchContent(pattern: string, options: GrepOptions = {}): Promise<SearchResult> {
        if (!this.initialized) {
            throw FileSystemError.notInitialized();
        }

        const searchPath: string = options.path || this.config.workingDirectory || process.cwd();
        const globPattern = options.glob || '**/*';
        const maxResults = options.maxResults || DEFAULT_MAX_SEARCH_RESULTS;
        const contextLines = options.contextLines || 0;

        try {
            // Create regex from pattern
            const flags = options.caseInsensitive ? 'i' : '';
            const regex = new RegExp(pattern, flags);

            // Find files to search
            const globResult = await this.globFiles(globPattern, {
                cwd: searchPath,
                maxResults: 10000, // Search more files, but limit results
            });

            const matches: SearchMatch[] = [];
            let filesSearched = 0;

            for (const fileInfo of globResult.files) {
                try {
                    // Read file
                    const fileContent = await this.readFile(fileInfo.path);
                    const lines = fileContent.content.split('\n');

                    filesSearched++;

                    // Search for pattern in each line
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i]!; // Safe: we're iterating within bounds
                        if (regex.test(line)) {
                            // Collect context lines if requested
                            let context: { before: string[]; after: string[] } | undefined;

                            if (contextLines > 0) {
                                const before: string[] = [];
                                const after: string[] = [];

                                for (let j = Math.max(0, i - contextLines); j < i; j++) {
                                    before.push(lines[j]!); // Safe: j is within bounds
                                }

                                for (
                                    let j = i + 1;
                                    j < Math.min(lines.length, i + contextLines + 1);
                                    j++
                                ) {
                                    after.push(lines[j]!); // Safe: j is within bounds
                                }

                                context = { before, after };
                            }

                            matches.push({
                                file: fileInfo.path,
                                lineNumber: i + 1, // 1-based line numbers
                                line,
                                ...(context !== undefined && { context }),
                            });

                            // Check if we've reached max results
                            if (matches.length >= maxResults) {
                                return {
                                    matches,
                                    totalMatches: matches.length,
                                    truncated: true,
                                    filesSearched,
                                };
                            }
                        }
                    }
                } catch (error) {
                    // Skip files that can't be read
                    this.logger.debug(
                        `Skipping file ${fileInfo.path}: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }

            return {
                matches,
                totalMatches: matches.length,
                truncated: false,
                filesSearched,
            };
        } catch (error) {
            if (error instanceof Error && error.message.includes('Invalid regular expression')) {
                throw FileSystemError.invalidPattern(pattern, 'Invalid regular expression syntax');
            }
            throw FileSystemError.searchFailed(
                pattern,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Write content to a file
     */
    async writeFile(
        filePath: string,
        content: string,
        options: WriteFileOptions = {}
    ): Promise<WriteResult> {
        if (!this.initialized) {
            throw FileSystemError.notInitialized();
        }

        // Validate path
        const validation = this.pathValidator.validatePath(filePath);
        if (!validation.isValid || !validation.normalizedPath) {
            throw FileSystemError.invalidPath(filePath, validation.error || 'Unknown error');
        }

        const normalizedPath = validation.normalizedPath;
        const encoding = options.encoding || DEFAULT_ENCODING;

        // Check if file exists for backup
        let backupPath: string | undefined;
        let fileExists = false;

        try {
            await fs.access(normalizedPath);
            fileExists = true;
        } catch {
            // File doesn't exist, which is fine
        }

        // Create backup if file exists and backups are enabled
        if (fileExists && (options.backup ?? this.config.enableBackups)) {
            backupPath = await this.createBackup(normalizedPath);
        }

        try {
            // Create parent directories if needed
            if (options.createDirs) {
                const dir = path.dirname(normalizedPath);
                await fs.mkdir(dir, { recursive: true });
            }

            // Write file
            await fs.writeFile(normalizedPath, content, encoding);

            const bytesWritten = Buffer.byteLength(content, encoding);

            this.logger.debug(`File written: ${normalizedPath} (${bytesWritten} bytes)`);

            return {
                success: true,
                path: normalizedPath,
                bytesWritten,
                backupPath,
            };
        } catch (error) {
            throw FileSystemError.writeFailed(
                normalizedPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Edit a file by replacing text
     */
    async editFile(
        filePath: string,
        operation: EditOperation,
        options: EditFileOptions = {}
    ): Promise<EditResult> {
        if (!this.initialized) {
            throw FileSystemError.notInitialized();
        }

        // Validate path
        const validation = this.pathValidator.validatePath(filePath);
        if (!validation.isValid || !validation.normalizedPath) {
            throw FileSystemError.invalidPath(filePath, validation.error || 'Unknown error');
        }

        const normalizedPath = validation.normalizedPath;

        // Read current file content
        const fileContent = await this.readFile(normalizedPath);
        let content = fileContent.content;

        // Count occurrences of old string
        const occurrences = (
            content.match(
                new RegExp(operation.oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
            ) || []
        ).length;

        if (occurrences === 0) {
            throw FileSystemError.stringNotFound(normalizedPath, operation.oldString);
        }

        if (!operation.replaceAll && occurrences > 1) {
            throw FileSystemError.stringNotUnique(normalizedPath, operation.oldString, occurrences);
        }

        // Create backup if enabled
        let backupPath: string | undefined;
        if (options.backup ?? this.config.enableBackups) {
            backupPath = await this.createBackup(normalizedPath);
        }

        try {
            // Perform replacement
            if (operation.replaceAll) {
                content = content.replace(
                    new RegExp(operation.oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                    operation.newString
                );
            } else {
                content = content.replace(operation.oldString, operation.newString);
            }

            // Write updated content
            await fs.writeFile(normalizedPath, content, options.encoding || DEFAULT_ENCODING);

            this.logger.debug(`File edited: ${normalizedPath} (${occurrences} replacements)`);

            return {
                success: true,
                path: normalizedPath,
                changesCount: occurrences,
                backupPath,
            };
        } catch (error) {
            throw FileSystemError.editFailed(
                normalizedPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Create a backup of a file
     */
    private async createBackup(filePath: string): Promise<string> {
        const backupDir = this.getBackupDir();

        // Generate backup filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const basename = path.basename(filePath);
        const backupFilename = `${basename}.${timestamp}.backup`;
        const backupPath = path.join(backupDir, backupFilename);

        try {
            await fs.mkdir(backupDir, { recursive: true });
            await fs.copyFile(filePath, backupPath);
            this.logger.debug(`Backup created: ${backupPath}`);

            // Clean up old backups after creating new one
            await this.cleanupOldBackups();

            return backupPath;
        } catch (error) {
            throw FileSystemError.backupFailed(
                filePath,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Clean up old backup files based on retention policy
     */
    async cleanupOldBackups(): Promise<number> {
        if (!this.config.enableBackups) {
            return 0;
        }

        let backupDir: string;
        try {
            backupDir = this.getBackupDir();
        } catch (error) {
            this.logger.warn(
                `Failed to resolve backup directory: ${error instanceof Error ? error.message : String(error)}`
            );
            return 0;
        }

        try {
            // Check if backup directory exists
            await fs.access(backupDir);
        } catch {
            // Directory doesn't exist, nothing to clean
            return 0;
        }

        const cutoffDate = new Date(
            Date.now() - this.config.backupRetentionDays * 24 * 60 * 60 * 1000
        );
        let deletedCount = 0;

        try {
            const files = await fs.readdir(backupDir);
            const backupFiles = files.filter((file) => file.endsWith('.backup'));

            for (const file of backupFiles) {
                const filePath = path.join(backupDir, file);
                try {
                    const stats = await fs.stat(filePath);
                    if (stats.mtime < cutoffDate) {
                        await fs.unlink(filePath);
                        deletedCount++;
                        this.logger.debug(`Cleaned up old backup: ${file}`);
                    }
                } catch (error) {
                    this.logger.warn(
                        `Failed to process backup file ${file}: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }

            if (deletedCount > 0) {
                this.logger.info(`Backup cleanup: removed ${deletedCount} old backup files`);
            }

            return deletedCount;
        } catch (error) {
            this.logger.warn(
                `Failed to cleanup backup directory: ${error instanceof Error ? error.message : String(error)}`
            );
            return 0;
        }
    }

    /**
     * Get service configuration
     */
    getConfig(): Readonly<FileSystemConfig> {
        return { ...this.config };
    }

    /**
     * Check if a path is allowed
     */
    isPathAllowed(filePath: string): boolean {
        const validation = this.pathValidator.validatePath(filePath);
        return validation.isValid;
    }
}
