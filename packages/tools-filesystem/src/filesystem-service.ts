/**
 * FileSystem Service
 *
 * Secure file system operations for Dexto internal tools
 */

import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { glob } from 'glob';
import safeRegex from 'safe-regex';
import { DextoRuntimeError, getDextoPath, Logger, DextoLogComponent } from '@dexto/core';
import {
    FileSystemConfig,
    FileContent,
    MediaFileContent,
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
    FindPathsOptions,
    FindPathsResult,
    ListDirectoryOptions,
    ListDirectoryResult,
    PathMatch,
    CreateDirectoryOptions,
    CreateDirectoryResult,
    DeletePathOptions,
    DeletePathResult,
    RenamePathResult,
    BufferEncoding,
} from './types.js';
import { PathValidator } from './path-validator.js';
import { FileSystemError } from './errors.js';
import { detectMimeType, getMediaFileKind, isLikelyBinary, isTextMimeType } from './mime-utils.js';
import {
    isRipgrepAvailable,
    ripgrepFiles,
    ripgrepSearch,
    ripgrepWalkFiles,
} from './ripgrep-utils.js';

const DEFAULT_ENCODING: BufferEncoding = 'utf-8';
const DEFAULT_MAX_RESULTS = 1000;
const DEFAULT_MAX_SEARCH_RESULTS = 100;
const DEFAULT_MAX_LIST_RESULTS = 5000;
const DEFAULT_LIST_CONCURRENCY = 16;

function getErrnoCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }

    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
}

function normalizeStatSize(size: number | bigint): number {
    return typeof size === 'bigint' ? Number(size) : size;
}

function isFilesystemRuntimeError(error: unknown): error is DextoRuntimeError {
    return error instanceof DextoRuntimeError && error.scope === 'filesystem';
}

function countTextLines(content: string): number {
    if (content.length === 0) {
        return 0;
    }

    const lineBreaks = content.match(/\r\n|\n|\r/g);
    if (!lineBreaks) {
        return 1;
    }

    return /(?:\r\n|\n|\r)$/.test(content) ? lineBreaks.length : lineBreaks.length + 1;
}

function extractCompleteLineSegment(content: string): { segment: string; rest: string } | null {
    for (let index = 0; index < content.length; index += 1) {
        const char = content[index];
        if (char === '\n') {
            return {
                segment: content.slice(0, index + 1),
                rest: content.slice(index + 1),
            };
        }
        if (char !== '\r') {
            continue;
        }

        if (index + 1 >= content.length) {
            return null;
        }

        const delimiterLength = content[index + 1] === '\n' ? 2 : 1;
        return {
            segment: content.slice(0, index + delimiterLength),
            rest: content.slice(index + delimiterLength),
        };
    }

    return null;
}

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

    private async ensureReadableFile(
        normalizedPath: string
    ): Promise<Awaited<ReturnType<typeof fs.stat>>> {
        try {
            const stats = await fs.stat(normalizedPath);
            const fileSize = normalizeStatSize(stats.size);

            if (!stats.isFile()) {
                throw FileSystemError.invalidPath(normalizedPath, 'Path is not a file');
            }

            if (fileSize > this.config.maxFileSize) {
                throw FileSystemError.fileTooLarge(
                    normalizedPath,
                    fileSize,
                    this.config.maxFileSize
                );
            }

            return stats;
        } catch (error) {
            if (isFilesystemRuntimeError(error)) {
                throw error;
            }
            if (getErrnoCode(error) === 'ENOENT') {
                throw FileSystemError.fileNotFound(normalizedPath);
            }
            if (getErrnoCode(error) === 'EACCES') {
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
    }

    private async readNormalizedFile(
        normalizedPath: string,
        options: ReadFileOptions = {}
    ): Promise<FileContent> {
        const stats = await this.ensureReadableFile(normalizedPath);

        try {
            const encoding = options.encoding || DEFAULT_ENCODING;
            const probeSize = Math.min(normalizeStatSize(stats.size), 8192);
            const handle = await fs.open(normalizedPath, 'r');
            const probe = Buffer.alloc(probeSize);
            let bytesRead = 0;
            try {
                ({ bytesRead } = await handle.read(probe, 0, probeSize, 0));
            } finally {
                await handle.close();
            }

            const sample = probe.subarray(0, bytesRead);
            const mimeType = detectMimeType(normalizedPath, sample);
            const binaryLike = isLikelyBinary(sample);
            const canReadAsText =
                !binaryLike && (isTextMimeType(mimeType) || mimeType === 'image/svg+xml');

            if (!canReadAsText) {
                throw FileSystemError.readFailed(
                    normalizedPath,
                    `File is binary (${mimeType}). Use read_media_file instead.`
                );
            }

            const limit = options.limit;
            const startLine = options.offset && options.offset > 0 ? options.offset : 1;
            if (startLine === 1 && limit === undefined) {
                const fullContent = await fs.readFile(normalizedPath, encoding);
                return {
                    content: fullContent,
                    lines: countTextLines(fullContent),
                    encoding,
                    mimeType,
                    truncated: false,
                    size: Buffer.byteLength(fullContent, encoding),
                    startLine,
                    nextOffset: undefined,
                };
            }

            const stream = createReadStream(normalizedPath, {
                encoding,
            });
            const selectedParts: string[] = [];
            let pendingContent = '';
            let lineNumber = 0;
            let selectedLineCount = 0;
            let truncated = false;
            let shouldStop = false;

            const processLineSegment = (segment: string): void => {
                lineNumber += 1;

                if (lineNumber < startLine) {
                    return;
                }

                if (limit !== undefined && selectedLineCount >= limit) {
                    truncated = true;
                    shouldStop = true;
                    return;
                }

                selectedParts.push(segment);
                selectedLineCount += 1;
            };

            try {
                for await (const chunk of stream) {
                    pendingContent += chunk;

                    while (true) {
                        const extracted = extractCompleteLineSegment(pendingContent);
                        if (!extracted) {
                            break;
                        }

                        pendingContent = extracted.rest;
                        processLineSegment(extracted.segment);
                        if (shouldStop) {
                            break;
                        }
                    }

                    if (shouldStop) {
                        break;
                    }
                }
            } finally {
                stream.destroy();
            }

            if (!shouldStop && pendingContent.length > 0) {
                processLineSegment(pendingContent);
            }

            const returnedContent = selectedParts.join('');
            return {
                content: returnedContent,
                lines: selectedLineCount,
                encoding,
                mimeType,
                truncated,
                size: Buffer.byteLength(returnedContent, encoding),
                startLine,
                nextOffset: truncated ? startLine + selectedLineCount : undefined,
            };
        } catch (error) {
            if (isFilesystemRuntimeError(error)) {
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
     * Read a media or binary file and return base64-encoded data with MIME metadata.
     */
    async readMediaFile(filePath: string): Promise<MediaFileContent> {
        await this.ensureInitialized();

        const normalizedPath = await this.validateReadPath(filePath, 'execute');

        try {
            const stats = await fs.stat(normalizedPath);
            const fileSize = normalizeStatSize(stats.size);

            if (!stats.isFile()) {
                throw FileSystemError.invalidPath(normalizedPath, 'Path is not a file');
            }

            if (fileSize > this.config.maxFileSize) {
                throw FileSystemError.fileTooLarge(
                    normalizedPath,
                    fileSize,
                    this.config.maxFileSize
                );
            }

            const rawContent = await fs.readFile(normalizedPath);
            const mimeType = detectMimeType(normalizedPath, rawContent);

            if (isTextMimeType(mimeType) && !isLikelyBinary(rawContent)) {
                throw FileSystemError.readFailed(
                    normalizedPath,
                    `File is text (${mimeType}). Use read_file instead.`
                );
            }

            return {
                data: rawContent.toString('base64'),
                mimeType,
                filename: path.basename(normalizedPath),
                kind: getMediaFileKind(mimeType),
                size: fileSize,
            };
        } catch (error) {
            if (isFilesystemRuntimeError(error)) {
                throw error;
            }
            if (getErrnoCode(error) === 'ENOENT') {
                throw FileSystemError.fileNotFound(normalizedPath);
            }
            if (getErrnoCode(error) === 'EACCES') {
                throw FileSystemError.permissionDenied(normalizedPath, 'read');
            }
            throw FileSystemError.readFailed(
                normalizedPath,
                error instanceof Error ? error.message : String(error)
            );
        }
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
        const includeMetadata = options.includeMetadata === true;

        try {
            const ripgrepResult = await ripgrepFiles({
                cwd,
                globs: [pattern],
                maxResults,
            });
            if (ripgrepResult) {
                const files = await this.collectValidatedFileMetadata(
                    ripgrepResult.paths,
                    includeMetadata
                );
                return {
                    files,
                    truncated: ripgrepResult.truncated,
                    totalFound: files.length,
                };
            }

            const files = await glob(pattern, {
                cwd,
                absolute: true,
                nodir: true,
                follow: false,
            });

            const limitedFiles = files.slice(0, maxResults);
            const validFiles = await this.collectValidatedFileMetadata(
                limitedFiles,
                includeMetadata
            );
            return {
                files: validFiles,
                truncated: files.length > maxResults,
                totalFound: validFiles.length,
            };
        } catch (error) {
            throw FileSystemError.globFailed(
                pattern,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    private async collectValidatedFileMetadata(
        filePaths: string[],
        includeMetadata: boolean
    ): Promise<FileMetadata[]> {
        const entries = await this.mapWithConcurrency(
            filePaths,
            DEFAULT_LIST_CONCURRENCY,
            async (filePath) => {
                const validation = await this.pathValidator.validatePath(filePath);
                if (!validation.isValid || !validation.normalizedPath) {
                    this.logger.debug(`Skipping invalid path: ${filePath}`);
                    return null;
                }

                if (!includeMetadata) {
                    return {
                        path: validation.normalizedPath,
                        size: 0,
                        modified: new Date(0),
                        isDirectory: false,
                    } satisfies FileMetadata;
                }

                try {
                    const stats = await fs.stat(validation.normalizedPath);
                    if (!stats.isFile()) {
                        return null;
                    }

                    return {
                        path: validation.normalizedPath,
                        size: normalizeStatSize(stats.size),
                        modified: stats.mtime,
                        isDirectory: false,
                    } satisfies FileMetadata;
                } catch (error) {
                    this.logger.debug(
                        `Failed to stat file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
                    );
                    return null;
                }
            }
        );

        return entries.filter(Boolean) as FileMetadata[];
    }

    private subsequenceScore(query: string, candidate: string): number | null {
        let score = 0;
        let queryIndex = 0;
        let lastMatch = -1;

        for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex += 1) {
            if (candidate[candidateIndex] !== query[queryIndex]) {
                continue;
            }

            score += lastMatch >= 0 ? Math.max(1, 12 - (candidateIndex - lastMatch)) : 12;
            lastMatch = candidateIndex;
            queryIndex += 1;

            if (queryIndex === query.length) {
                return score - candidate.length;
            }
        }

        return null;
    }

    private scorePathQuery(query: string, candidatePath: string): number | null {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
            return null;
        }

        const normalizedPath = candidatePath.toLowerCase();
        const baseName = path.basename(candidatePath).toLowerCase();
        const baseNameStem = path.parse(baseName).name.toLowerCase();
        const compactQuery = normalizedQuery.replace(/[\s._/-]+/g, '');
        const compactPath = normalizedPath.replace(/[\s._/-]+/g, '');
        const compactBaseName = baseNameStem.replace(/[\s._/-]+/g, '');

        if (baseName === normalizedQuery) {
            return 1200 - candidatePath.length;
        }
        if (normalizedPath === normalizedQuery) {
            return 1100 - candidatePath.length;
        }
        if (baseName.startsWith(normalizedQuery)) {
            return 1000 - baseName.length;
        }
        if (compactQuery && compactBaseName === compactQuery) {
            return 980 - baseNameStem.length;
        }
        if (compactQuery && compactBaseName.startsWith(compactQuery)) {
            return 940 - compactBaseName.length;
        }

        const baseIndex = baseName.indexOf(normalizedQuery);
        if (baseIndex >= 0) {
            return 900 - baseIndex * 10 - baseName.length;
        }
        const compactBaseIndex = compactBaseName.indexOf(compactQuery);
        if (compactQuery && compactBaseIndex >= 0) {
            return 860 - compactBaseIndex * 10 - compactBaseName.length;
        }

        const pathIndex = normalizedPath.indexOf(normalizedQuery);
        if (pathIndex >= 0) {
            return 800 - pathIndex * 2 - normalizedPath.length;
        }
        const compactPathIndex = compactPath.indexOf(compactQuery);
        if (compactQuery && compactPathIndex >= 0) {
            return 760 - compactPathIndex * 2 - compactPath.length;
        }

        const baseScore = this.subsequenceScore(compactQuery || normalizedQuery, compactBaseName);
        if (baseScore !== null) {
            return 700 + baseScore;
        }

        const pathScore = this.subsequenceScore(compactQuery || normalizedQuery, compactPath);
        if (pathScore !== null) {
            return 500 + pathScore;
        }

        return null;
    }

    async findPaths(query: string, options: FindPathsOptions = {}): Promise<FindPathsResult> {
        await this.ensureInitialized();

        const basePath: string = options.path || this.config.workingDirectory || process.cwd();
        const validation = await this.pathValidator.validatePath(basePath);
        if (!validation.isValid || !validation.normalizedPath) {
            throw FileSystemError.invalidPath(basePath, validation.error || 'Unknown error');
        }

        const searchPath = validation.normalizedPath;
        const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
        const pathType = options.pathType ?? 'all';

        const ripgrepAvailable = await isRipgrepAvailable();
        const seenCandidates = new Set<string>();
        const scoredMatches: PathMatch[] = [];
        let totalMatches = 0;

        const sortMatches = (left: PathMatch, right: PathMatch): number => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }
            if (left.path.length !== right.path.length) {
                return left.path.length - right.path.length;
            }
            return left.path.localeCompare(right.path);
        };

        const considerCandidate = (
            candidatePath: string,
            candidateType: 'file' | 'directory'
        ): void => {
            if (pathType !== 'all' && candidateType !== pathType) {
                return;
            }

            const relativePath =
                path.relative(searchPath, candidatePath) || path.basename(candidatePath);
            const score = this.scorePathQuery(query, relativePath);
            if (score === null) {
                return;
            }

            totalMatches += 1;
            scoredMatches.push({
                path: candidatePath,
                pathType: candidateType,
                score,
            });
            scoredMatches.sort(sortMatches);
            if (scoredMatches.length > maxResults) {
                scoredMatches.pop();
            }
        };

        const registerCandidate = async (
            candidatePath: string,
            candidateType: 'file' | 'directory'
        ): Promise<void> => {
            if (!this.pathValidator.isPathAllowedQuick(candidatePath)) {
                return;
            }

            const validationResult = await this.pathValidator.validatePath(candidatePath);
            if (!validationResult.isValid || !validationResult.normalizedPath) {
                return;
            }

            const key = `${candidateType}:${validationResult.normalizedPath}`;
            if (seenCandidates.has(key)) {
                return;
            }
            seenCandidates.add(key);

            considerCandidate(validationResult.normalizedPath, candidateType);
        };

        await registerCandidate(searchPath, 'directory');
        const pendingDirectories = [searchPath];

        while (pendingDirectories.length > 0) {
            const currentDirectory = pendingDirectories.pop();
            if (!currentDirectory) {
                continue;
            }

            let entries;
            try {
                entries = await fs.readdir(currentDirectory, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries) {
                const entryPath = path.join(currentDirectory, entry.name);
                if (!this.pathValidator.isPathAllowedQuick(entryPath)) {
                    continue;
                }

                if (entry.isDirectory()) {
                    await registerCandidate(entryPath, 'directory');
                    pendingDirectories.push(entryPath);
                    continue;
                }

                if (ripgrepAvailable || !entry.isFile()) {
                    continue;
                }

                await registerCandidate(entryPath, 'file');
            }
        }

        if (ripgrepAvailable) {
            await ripgrepWalkFiles({
                cwd: searchPath,
                onPath: async (filePath) => {
                    await registerCandidate(filePath, 'file');
                    return true;
                },
            });
        }

        return {
            matches: scoredMatches,
            totalMatches,
            truncated: totalMatches > maxResults,
            searchPath,
        };
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
            if (isFilesystemRuntimeError(error)) {
                throw error;
            }
            if (getErrnoCode(error) === 'ENOENT') {
                throw FileSystemError.directoryNotFound(normalizedPath);
            }
            if (getErrnoCode(error) === 'EACCES') {
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
                            size: normalizeStatSize(stat.size),
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
            const code = getErrnoCode(error);
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
            const code = getErrnoCode(error);
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
            const code = getErrnoCode(error);
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
            const code = getErrnoCode(error);
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
        let globPattern: string | undefined;
        let targetPath: string | undefined;

        const baseValidation = await this.pathValidator.validatePath(basePath);
        if (!baseValidation.isValid || !baseValidation.normalizedPath) {
            throw FileSystemError.invalidPath(basePath, baseValidation.error || 'Unknown error');
        }
        const resolvedPath = baseValidation.normalizedPath;

        // Check if the provided path is a file or directory
        try {
            const stats = await fs.stat(resolvedPath);

            if (stats.isFile()) {
                searchPath = path.dirname(resolvedPath);
                targetPath = path.basename(resolvedPath);
                globPattern = targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            } else {
                searchPath = resolvedPath;
                globPattern = options.glob || '**/*';
            }
        } catch {
            searchPath = resolvedPath;
            globPattern = options.glob || '**/*';
        }

        const maxResults = options.maxResults || DEFAULT_MAX_SEARCH_RESULTS;
        const contextLines = options.contextLines || 0;
        const literal = options.literal !== false;
        const regexPattern = literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern;

        try {
            if (!literal && !safeRegex(regexPattern)) {
                throw FileSystemError.invalidPattern(
                    pattern,
                    'Pattern may cause catastrophic backtracking (ReDoS). Please simplify the regex.'
                );
            }

            const ripgrepOptions: Parameters<typeof ripgrepSearch>[0] = {
                cwd: searchPath,
                pattern,
                literal,
                maxResults,
            };
            if (typeof options.caseInsensitive === 'boolean') {
                ripgrepOptions.caseInsensitive = options.caseInsensitive;
            }
            if (targetPath) {
                ripgrepOptions.targetPath = targetPath;
            } else if (options.glob) {
                ripgrepOptions.globs = [options.glob];
            }

            const ripgrepResult = await ripgrepSearch(ripgrepOptions);
            if (ripgrepResult) {
                const matches = await this.mapWithConcurrency(
                    ripgrepResult.matches,
                    Math.min(DEFAULT_LIST_CONCURRENCY, Math.max(1, ripgrepResult.matches.length)),
                    async (match) => {
                        const validation = await this.pathValidator.validatePath(match.file);
                        if (!validation.isValid || !validation.normalizedPath) {
                            return null;
                        }

                        let context: { before: string[]; after: string[] } | undefined;
                        if (contextLines > 0) {
                            try {
                                context = await this.readContextWindow(
                                    validation.normalizedPath,
                                    match.lineNumber,
                                    contextLines
                                );
                            } catch {
                                return null;
                            }
                        }

                        return {
                            file: validation.normalizedPath,
                            lineNumber: match.lineNumber,
                            line: match.line,
                            ...(context ? { context } : {}),
                        } satisfies SearchMatch;
                    }
                );

                const filteredMatches = matches.filter(Boolean) as SearchMatch[];
                return {
                    matches: filteredMatches,
                    totalMatches: filteredMatches.length,
                    truncated: ripgrepResult.truncated,
                    filesSearched: ripgrepResult.filesSearched,
                };
            }

            const flags = options.caseInsensitive ? 'i' : '';
            const regex = new RegExp(regexPattern, flags);

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

    private async readContextWindow(
        normalizedPath: string,
        lineNumber: number,
        contextLines: number
    ): Promise<{ before: string[]; after: string[] }> {
        const before: string[] = [];
        const after: string[] = [];

        const startLine = Math.max(1, lineNumber - contextLines);
        const endLine = lineNumber + contextLines;

        const stream = createReadStream(normalizedPath, {
            encoding: DEFAULT_ENCODING,
        });
        const rl = createInterface({
            input: stream,
            crlfDelay: Infinity,
        });

        let currentLine = 0;
        try {
            for await (const line of rl) {
                currentLine += 1;
                if (currentLine < startLine) {
                    continue;
                }
                if (currentLine > endLine) {
                    break;
                }
                if (currentLine < lineNumber) {
                    before.push(line);
                } else if (currentLine > lineNumber) {
                    after.push(line);
                }
            }
        } finally {
            rl.close();
            stream.destroy();
        }

        return { before, after };
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
