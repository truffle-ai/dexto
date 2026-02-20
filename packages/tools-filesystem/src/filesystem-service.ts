/**
 * FileSystem Service
 *
 * Secure file system operations for Dexto internal tools
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
import safeRegex from 'safe-regex';
import { DextoRuntimeError, getDextoPath, Logger, DextoLogComponent } from '@dexto/core';
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
    DirectoryEntry,
    ListDirectoryOptions,
    ListDirectoryResult,
    CreateDirectoryOptions,
    CreateDirectoryResult,
    DeletePathOptions,
    DeletePathResult,
    RenamePathResult,
    BufferEncoding,
} from './types.js';
import { PathValidator } from './path-validator.js';
import { FileSystemError } from './errors.js';

const DEFAULT_ENCODING: BufferEncoding = 'utf-8';
const DEFAULT_MAX_RESULTS = 1000;
const DEFAULT_MAX_SEARCH_RESULTS = 100;
const DEFAULT_MAX_LIST_RESULTS = 5000;
const DEFAULT_LIST_CONCURRENCY = 16;

/**
 * FileSystemService - Handles all file system operations with security checks
 *
 * This service receives fully-validated configuration from the FileSystem Tools Factory.
 * All defaults have been applied by the factory's schema, so the service trusts the config
 * and uses it as-is without any fallback logic.
 *
 * TODO: instantiate only when internal file tools are enabled to avoid file dependencies which won't work in serverless
 */
export class FileSystemService {
    private config: FileSystemConfig;
    private pathValidator: PathValidator;
    private initialized: boolean = false;
    private initPromise: Promise<void> | null = null;
    private logger: Logger;
    private directoryApprovalChecker?: (filePath: string) => boolean;

    /**
     * Create a new FileSystemService with validated configuration.
     *
     * @param config - Fully-validated configuration from the factory schema.
     *                 All required fields have values, defaults already applied.
     * @param logger - Logger instance for this service
     */
    constructor(config: FileSystemConfig, logger: Logger) {
        // Config is already fully validated with defaults applied - just use it
        this.config = config;

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
     * Get the effective working directory for file operations.
     * Falls back to process.cwd() if not configured.
     */
    getWorkingDirectory(): string {
        return this.config.workingDirectory || process.cwd();
    }

    /**
     * Initialize the service.
     * Safe to call multiple times - subsequent calls return the same promise.
     */
    initialize(): Promise<void> {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.doInitialize();
        return this.initPromise;
    }

    /**
     * Internal initialization logic.
     */
    private async doInitialize(): Promise<void> {
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
     * Ensure the service is initialized before use.
     * Tools should call this at the start of their execute methods.
     * Safe to call multiple times - will await the same initialization promise.
     */
    async ensureInitialized(): Promise<void> {
        if (this.initialized) {
            return;
        }
        await this.initialize();
    }

    /**
     * Set a callback to check if a path is in an approved directory.
     * This allows PathValidator to consult ApprovalManager without a direct dependency.
     *
     * @param checker Function that returns true if path is in an approved directory
     */
    setDirectoryApprovalChecker(checker: (filePath: string) => boolean): void {
        this.directoryApprovalChecker = checker;
        this.pathValidator.setDirectoryApprovalChecker(checker);
    }

    /**
     * Update the working directory at runtime (e.g., when workspace changes).
     * Rebuilds the PathValidator so allowed/blocked path roots are recalculated.
     */
    setWorkingDirectory(workingDirectory: string): void {
        const normalized = workingDirectory?.trim();
        if (!normalized) return;
        if (this.config.workingDirectory === normalized) return;

        this.config = { ...this.config, workingDirectory: normalized };
        this.pathValidator = new PathValidator(this.config, this.logger);
        if (this.directoryApprovalChecker) {
            this.pathValidator.setDirectoryApprovalChecker(this.directoryApprovalChecker);
        }
        this.logger.info(`FileSystemService working directory set to ${normalized}`);
    }

    /**
     * Check if a file path is within the configured allowed paths (config only).
     * This is used by file tools to determine if directory approval is needed.
     *
     * @param filePath The file path to check (can be relative or absolute)
     * @returns true if the path is within config-allowed paths, false otherwise
     */
    async isPathWithinConfigAllowed(filePath: string): Promise<boolean> {
        return this.pathValidator.isPathWithinAllowed(filePath);
    }

    private async validateReadPath(
        filePath: string,
        mode: 'execute' | 'toolPreview'
    ): Promise<string> {
        const validation =
            mode === 'toolPreview'
                ? await this.pathValidator.validatePathForPreview(filePath)
                : await this.pathValidator.validatePath(filePath);
        if (!validation.isValid || !validation.normalizedPath) {
            throw FileSystemError.invalidPath(filePath, validation.error || 'Unknown error');
        }
        return validation.normalizedPath;
    }

    private async readNormalizedFile(
        normalizedPath: string,
        options: ReadFileOptions = {}
    ): Promise<FileContent> {
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
            if (error instanceof DextoRuntimeError && error.scope === 'filesystem') {
                throw error;
            }
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw FileSystemError.fileNotFound(normalizedPath);
            }
            if ((error as NodeJS.ErrnoException).code === 'EACCES') {
                throw FileSystemError.permissionDenied(normalizedPath, 'read');
            }
            if (error instanceof DextoRuntimeError) {
                throw error;
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

            const returnedContent = selectedLines.join('\n');
            return {
                content: returnedContent,
                lines: selectedLines.length,
                encoding,
                truncated,
                size: Buffer.byteLength(returnedContent, encoding),
            };
        } catch (error) {
            if (error instanceof DextoRuntimeError && error.scope === 'filesystem') {
                throw error;
            }
            throw FileSystemError.readFailed(
                normalizedPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Read a file with validation and size limits
     */
    async readFile(filePath: string, options: ReadFileOptions = {}): Promise<FileContent> {
        await this.ensureInitialized();

        const normalizedPath = await this.validateReadPath(filePath, 'execute');
        return await this.readNormalizedFile(normalizedPath, options);
    }

    /**
     * Preview-only file read that bypasses config-allowed roots.
     *
     * This is intended for UI previews (diffs, create previews) shown BEFORE a user
     * confirms directory access for the tool call. The returned content is UI-only
     * and should not be forwarded to the LLM.
     */
    async readFileForToolPreview(
        filePath: string,
        options: ReadFileOptions = {}
    ): Promise<FileContent> {
        await this.ensureInitialized();

        const normalizedPath = await this.validateReadPath(filePath, 'toolPreview');
        return await this.readNormalizedFile(normalizedPath, options);
    }

    /**
     * Find files matching a glob pattern
     */
    async globFiles(pattern: string, options: GlobOptions = {}): Promise<GlobResult> {
        await this.ensureInitialized();

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
                // Validate path (async for non-blocking symlink resolution)
                const validation = await this.pathValidator.validatePath(file);
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
     * List contents of a directory (non-recursive)
     */
    async listDirectory(
        dirPath: string,
        options: ListDirectoryOptions = {}
    ): Promise<ListDirectoryResult> {
        await this.ensureInitialized();

        const validation = await this.pathValidator.validatePath(dirPath);
        if (!validation.isValid || !validation.normalizedPath) {
            throw FileSystemError.invalidPath(dirPath, validation.error || 'Unknown error');
        }

        const normalizedPath = validation.normalizedPath;

        try {
            const stats = await fs.stat(normalizedPath);
            if (!stats.isDirectory()) {
                throw FileSystemError.invalidPath(normalizedPath, 'Path is not a directory');
            }
        } catch (error) {
            if (error instanceof DextoRuntimeError && error.scope === 'filesystem') {
                throw error;
            }
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw FileSystemError.directoryNotFound(normalizedPath);
            }
            if ((error as NodeJS.ErrnoException).code === 'EACCES') {
                throw FileSystemError.permissionDenied(normalizedPath, 'read');
            }
            throw FileSystemError.listFailed(
                normalizedPath,
                error instanceof Error ? error.message : String(error)
            );
        }

        const includeHidden = options.includeHidden ?? true;
        const includeMetadata = options.includeMetadata !== false;
        const maxEntries = options.maxEntries ?? DEFAULT_MAX_LIST_RESULTS;

        try {
            const dirEntries = await fs.readdir(normalizedPath, { withFileTypes: true });
            const candidates = dirEntries.filter(
                (entry) => includeHidden || !entry.name.startsWith('.')
            );

            const concurrency = DEFAULT_LIST_CONCURRENCY;
            const validatedEntries = await this.mapWithConcurrency(
                candidates,
                concurrency,
                async (entry) => {
                    const entryPath = path.join(normalizedPath, entry.name);
                    const entryValidation = await this.pathValidator.validatePath(entryPath);
                    if (!entryValidation.isValid || !entryValidation.normalizedPath) {
                        return null;
                    }

                    return {
                        entry,
                        normalizedPath: entryValidation.normalizedPath,
                    };
                }
            );

            type ValidEntry = {
                entry: (typeof candidates)[number];
                normalizedPath: string;
            };
            const validEntries = validatedEntries.filter(Boolean) as ValidEntry[];

            if (maxEntries <= 0) {
                return {
                    path: normalizedPath,
                    entries: [],
                    truncated: validEntries.length > 0,
                    totalEntries: validEntries.length,
                };
            }

            if (!includeMetadata) {
                const entries = validEntries.slice(0, maxEntries).map((entry) => ({
                    name: entry.entry.name,
                    path: entry.normalizedPath,
                    isDirectory: entry.entry.isDirectory(),
                    size: 0,
                    modified: new Date(),
                }));
                return {
                    path: normalizedPath,
                    entries,
                    truncated: validEntries.length > maxEntries,
                    totalEntries: validEntries.length,
                };
            }

            const metadataEntries = await this.mapWithConcurrency(
                validEntries,
                concurrency,
                async (entry) => {
                    try {
                        const stat = await fs.stat(entry.normalizedPath);
                        return {
                            name: entry.entry.name,
                            path: entry.normalizedPath,
                            isDirectory: entry.entry.isDirectory(),
                            size: stat.size,
                            modified: stat.mtime,
                        } satisfies DirectoryEntry;
                    } catch {
                        return null;
                    }
                }
            );

            const entries: DirectoryEntry[] = [];
            let successfulStats = 0;
            let cutoffIndex = -1;

            for (let index = 0; index < metadataEntries.length; index += 1) {
                const entry = metadataEntries[index];
                if (!entry) {
                    continue;
                }

                successfulStats += 1;
                if (entries.length < maxEntries) {
                    entries.push(entry);
                }

                if (successfulStats === maxEntries) {
                    cutoffIndex = index;
                }
            }

            const remainingSuccessful =
                cutoffIndex >= 0
                    ? metadataEntries.slice(cutoffIndex + 1).filter((entry) => entry !== null)
                          .length
                    : 0;
            const totalEntries =
                successfulStats < maxEntries ? successfulStats : maxEntries + remainingSuccessful;

            return {
                path: normalizedPath,
                entries,
                truncated: totalEntries > maxEntries,
                totalEntries,
            };
        } catch (error) {
            throw FileSystemError.listFailed(
                normalizedPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    private async mapWithConcurrency<T, R>(
        items: T[],
        limit: number,
        mapper: (item: T, index: number) => Promise<R>
    ): Promise<R[]> {
        if (items.length === 0) {
            return [];
        }

        const results = new Array<R>(items.length);
        let nextIndex = 0;
        const workerCount = Math.min(Math.max(1, limit), items.length);

        const workers = Array.from({ length: workerCount }, async () => {
            while (true) {
                const current = nextIndex++;
                if (current >= items.length) {
                    return;
                }
                const item = items[current];
                if (item === undefined) {
                    continue;
                }
                results[current] = await mapper(item, current);
            }
        });

        await Promise.all(workers);
        return results;
    }

    /**
     * Create a directory
     */
    async createDirectory(
        dirPath: string,
        options: CreateDirectoryOptions = {}
    ): Promise<CreateDirectoryResult> {
        await this.ensureInitialized();

        const validation = await this.pathValidator.validatePath(dirPath);
        if (!validation.isValid || !validation.normalizedPath) {
            throw FileSystemError.invalidPath(dirPath, validation.error || 'Unknown error');
        }

        const normalizedPath = validation.normalizedPath;
        const recursive = options.recursive ?? false;

        try {
            const firstCreated = await fs.mkdir(normalizedPath, { recursive });
            const created = recursive ? typeof firstCreated === 'string' : true;
            return { path: normalizedPath, created };
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'EEXIST') {
                try {
                    const stat = await fs.stat(normalizedPath);
                    if (stat.isDirectory()) {
                        return { path: normalizedPath, created: false };
                    }
                } catch {
                    // fallthrough to error
                }
            }
            if (code === 'EACCES' || code === 'EPERM') {
                throw FileSystemError.permissionDenied(normalizedPath, 'create directory');
            }
            throw FileSystemError.createDirFailed(
                normalizedPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Delete a file or directory
     */
    async deletePath(
        targetPath: string,
        options: DeletePathOptions = {}
    ): Promise<DeletePathResult> {
        await this.ensureInitialized();

        const validation = await this.pathValidator.validatePath(targetPath);
        if (!validation.isValid || !validation.normalizedPath) {
            throw FileSystemError.invalidPath(targetPath, validation.error || 'Unknown error');
        }

        const normalizedPath = validation.normalizedPath;

        try {
            await fs.rm(normalizedPath, { recursive: options.recursive ?? false, force: false });
            return { path: normalizedPath, deleted: true };
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                throw FileSystemError.fileNotFound(normalizedPath);
            }
            if (code === 'EACCES' || code === 'EPERM') {
                throw FileSystemError.permissionDenied(normalizedPath, 'delete');
            }
            throw FileSystemError.deleteFailed(
                normalizedPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Rename or move a file or directory
     */
    async renamePath(fromPath: string, toPath: string): Promise<RenamePathResult> {
        await this.ensureInitialized();

        const fromValidation = await this.pathValidator.validatePath(fromPath);
        if (!fromValidation.isValid || !fromValidation.normalizedPath) {
            throw FileSystemError.invalidPath(fromPath, fromValidation.error || 'Unknown error');
        }

        const toValidation = await this.pathValidator.validatePath(toPath);
        if (!toValidation.isValid || !toValidation.normalizedPath) {
            throw FileSystemError.invalidPath(toPath, toValidation.error || 'Unknown error');
        }

        const normalizedFrom = fromValidation.normalizedPath;
        const normalizedTo = toValidation.normalizedPath;

        if (normalizedFrom === normalizedTo) {
            return { from: normalizedFrom, to: normalizedTo };
        }

        try {
            await fs.access(normalizedTo);
            throw FileSystemError.renameFailed(
                normalizedFrom,
                `Target already exists: ${normalizedTo}`
            );
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (!code) {
                throw error;
            }
            if (code === 'ENOENT') {
                // Destination doesn't exist
            } else if (code === 'EACCES' || code === 'EPERM') {
                throw FileSystemError.permissionDenied(normalizedTo, 'rename');
            } else {
                throw FileSystemError.renameFailed(
                    normalizedFrom,
                    error instanceof Error ? error.message : String(error)
                );
            }
        }

        try {
            await fs.rename(normalizedFrom, normalizedTo);
            return { from: normalizedFrom, to: normalizedTo };
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                throw FileSystemError.fileNotFound(normalizedFrom);
            }
            if (code === 'EACCES' || code === 'EPERM') {
                throw FileSystemError.permissionDenied(normalizedFrom, 'rename');
            }
            throw FileSystemError.renameFailed(
                normalizedFrom,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Search for content in files (grep-like functionality)
     */
    async searchContent(pattern: string, options: GrepOptions = {}): Promise<SearchResult> {
        await this.ensureInitialized();

        const basePath: string = options.path || this.config.workingDirectory || process.cwd();
        let searchPath: string;
        let globPattern: string;

        const baseValidation = await this.pathValidator.validatePath(basePath);
        if (!baseValidation.isValid || !baseValidation.normalizedPath) {
            throw FileSystemError.invalidPath(basePath, baseValidation.error || 'Unknown error');
        }
        const resolvedPath = baseValidation.normalizedPath;

        // Check if the provided path is a file or directory
        try {
            const stats = await fs.stat(resolvedPath);

            if (stats.isFile()) {
                // If path is a file, extract directory and use filename in glob pattern
                searchPath = path.dirname(resolvedPath);
                const fileName = path.basename(resolvedPath);
                // Escape special glob characters in filename
                const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                globPattern = options.glob || escapedFileName;
            } else {
                // If path is a directory, use it as-is
                searchPath = resolvedPath;
                globPattern = options.glob || '**/*';
            }
        } catch {
            // If stat fails, assume it's a directory (for backwards compatibility)
            searchPath = resolvedPath;
            globPattern = options.glob || '**/*';
        }

        const maxResults = options.maxResults || DEFAULT_MAX_SEARCH_RESULTS;
        const contextLines = options.contextLines || 0;

        try {
            // Validate regex pattern for ReDoS safety before creating RegExp
            // See: https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
            if (!safeRegex(pattern)) {
                throw FileSystemError.invalidPattern(
                    pattern,
                    'Pattern may cause catastrophic backtracking (ReDoS). Please simplify the regex.'
                );
            }

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
        await this.ensureInitialized();

        // Validate path (async for non-blocking symlink resolution)
        const validation = await this.pathValidator.validatePath(filePath);
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
        await this.ensureInitialized();

        // Validate path (async for non-blocking symlink resolution)
        const validation = await this.pathValidator.validatePath(filePath);
        if (!validation.isValid || !validation.normalizedPath) {
            throw FileSystemError.invalidPath(filePath, validation.error || 'Unknown error');
        }

        const normalizedPath = validation.normalizedPath;

        // Read current file content
        const fileContent = await this.readFile(normalizedPath);
        const originalContent = fileContent.content;

        // Count occurrences of old string
        const occurrences = (
            originalContent.match(
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
            let newContent: string;
            if (operation.replaceAll) {
                newContent = originalContent.replace(
                    new RegExp(operation.oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                    operation.newString
                );
            } else {
                newContent = originalContent.replace(operation.oldString, operation.newString);
            }

            // Write updated content
            await fs.writeFile(normalizedPath, newContent, options.encoding || DEFAULT_ENCODING);

            this.logger.debug(`File edited: ${normalizedPath} (${occurrences} replacements)`);

            return {
                success: true,
                path: normalizedPath,
                changesCount: occurrences,
                backupPath,
                originalContent,
                newContent,
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
     * Check if a path is allowed (async for non-blocking symlink resolution)
     */
    async isPathAllowed(filePath: string): Promise<boolean> {
        const validation = await this.pathValidator.validatePath(filePath);
        return validation.isValid;
    }
}
