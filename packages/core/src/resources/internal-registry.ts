import { ResourceMetadata } from './types.js';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../logger/index.js';
import { ResourceError } from './errors.js';
import type { BlobService } from '../blob/index.js';

export interface FileSystemResourceConfig {
    type: 'filesystem';
    paths: string[];
    maxDepth?: number;
    maxFiles?: number;
    includeHidden?: boolean;
    includeExtensions?: string[];
}

export interface BlobResourceConfig {
    type: 'blob';
    maxBlobSize?: number;
    maxTotalSize?: number;
    cleanupAfterDays?: number;
    storePath?: string | undefined;
}

export type InternalResourceConfig = FileSystemResourceConfig | BlobResourceConfig;

export type InternalResourceServices = {
    blobService?: import('../blob/index.js').BlobService;
};

export interface InternalResourceHandler {
    getType(): string;
    initialize(config: InternalResourceConfig, services: InternalResourceServices): Promise<void>;
    listResources(): Promise<ResourceMetadata[]>;
    readResource(uri: string): Promise<ReadResourceResult>;
    canHandle(uri: string): boolean;
    refresh?(): Promise<void>;
}

export class FileSystemResourceHandler implements InternalResourceHandler {
    private config?: FileSystemResourceConfig;
    private resourcesCache: Map<string, ResourceMetadata> = new Map();
    private visitedPaths: Set<string> = new Set();
    private fileCount: number = 0;
    private canonicalRoots: string[] = [];

    private static readonly DEFAULT_MAX_DEPTH = 3;
    private static readonly DEFAULT_MAX_FILES = 1000;
    private static readonly DEFAULT_INCLUDE_EXTENSIONS = [
        '.txt',
        '.md',
        '.js',
        '.ts',
        '.json',
        '.html',
        '.css',
        '.py',
        '.yaml',
        '.yml',
        '.xml',
        '.jsx',
        '.tsx',
        '.vue',
        '.php',
        '.rb',
        '.go',
        '.rs',
        '.java',
        '.kt',
        '.swift',
        '.sql',
        '.sh',
        '.bash',
        '.zsh',
    ];

    getType(): string {
        return 'filesystem';
    }

    async initialize(
        config: InternalResourceConfig,
        _services: InternalResourceServices
    ): Promise<void> {
        if (config.type !== 'filesystem') {
            throw ResourceError.providerError(
                'Filesystem',
                'initialize',
                'Invalid config type for FileSystemResourceHandler'
            );
        }
        this.config = config;

        this.canonicalRoots = [];
        for (const configPath of this.config.paths) {
            try {
                const canonicalRoot = await fs.realpath(path.resolve(configPath));
                this.canonicalRoots.push(canonicalRoot);
            } catch (error) {
                logger.warn(
                    `Failed to canonicalize root path '${configPath}': ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        await this.buildResourceCache();
    }

    async listResources(): Promise<ResourceMetadata[]> {
        return Array.from(this.resourcesCache.values());
    }

    canHandle(uri: string): boolean {
        return uri.startsWith('fs://');
    }

    private isPathAllowed(canonicalPath: string): boolean {
        return this.canonicalRoots.some((root) => {
            const normalizedPath = path.normalize(canonicalPath);
            const normalizedRoot = path.normalize(root);
            return (
                normalizedPath.startsWith(normalizedRoot + path.sep) ||
                normalizedPath === normalizedRoot
            );
        });
    }

    /**
     * Check if a path is a blob storage directory that should be excluded
     * from filesystem resource scanning to avoid conflicts with BlobResourceHandler
     */
    private isBlobStorageDirectory(canonicalPath: string): boolean {
        const normalizedPath = path.normalize(canonicalPath).replace(/\\/g, '/');

        // Common blob storage directory patterns
        const blobPatterns = ['/.dexto/blobs', '/.dexto/data/blobs', '/blobs', '/data/blobs'];

        return blobPatterns.some(
            (pattern) => normalizedPath.endsWith(pattern) || normalizedPath.includes(pattern + '/')
        );
    }

    async readResource(uri: string): Promise<ReadResourceResult> {
        if (!this.canHandle(uri)) {
            throw ResourceError.noSuitableProvider(uri);
        }

        const filePath = uri.replace('fs://', '');
        const resolvedPath = path.resolve(filePath);

        let canonicalPath: string;
        try {
            canonicalPath = await fs.realpath(resolvedPath);
        } catch (_error) {
            throw ResourceError.resourceNotFound(uri);
        }

        if (!this.isPathAllowed(canonicalPath)) {
            throw ResourceError.accessDenied(uri);
        }

        try {
            const stat = await fs.stat(canonicalPath);
            if (stat.size > 10 * 1024 * 1024) {
                throw ResourceError.readFailed(uri, `File too large (${stat.size} bytes)`);
            }

            if (this.isBinaryFile(canonicalPath)) {
                return {
                    contents: [
                        {
                            uri,
                            mimeType: 'text/plain',
                            text: `[Binary file: ${path.basename(canonicalPath)} (${stat.size} bytes)]`,
                        },
                    ],
                    _meta: {
                        isBinary: true,
                        size: stat.size,
                        originalMimeType: this.getMimeType(canonicalPath),
                    },
                };
            }

            const content = await fs.readFile(canonicalPath, 'utf-8');
            return {
                contents: [
                    {
                        uri,
                        mimeType: this.getMimeType(canonicalPath),
                        text: content,
                    },
                ],
                _meta: { size: stat.size },
            };
        } catch (error) {
            throw ResourceError.readFailed(uri, error);
        }
    }

    private isBinaryFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        const binaryExtensions = [
            '.exe',
            '.dll',
            '.so',
            '.dylib',
            '.bin',
            '.dat',
            '.db',
            '.sqlite',
            '.jpg',
            '.jpeg',
            '.png',
            '.gif',
            '.bmp',
            '.ico',
            '.tiff',
            '.webp',
            '.mp3',
            '.mp4',
            '.avi',
            '.mov',
            '.wmv',
            '.flv',
            '.mkv',
            '.webm',
            '.pdf',
            '.zip',
            '.tar',
            '.gz',
            '.7z',
            '.rar',
            '.dmg',
            '.iso',
            '.woff',
            '.woff2',
            '.ttf',
            '.otf',
            '.eot',
            '.class',
            '.jar',
            '.war',
            '.ear',
            '.o',
            '.obj',
            '.lib',
            '.a',
        ];
        return binaryExtensions.includes(ext);
    }

    async refresh(): Promise<void> {
        await this.buildResourceCache();
    }

    private async buildResourceCache(): Promise<void> {
        if (!this.config) return;

        this.resourcesCache.clear();
        this.visitedPaths.clear();
        this.fileCount = 0;

        const maxFiles = this.config?.maxFiles ?? FileSystemResourceHandler.DEFAULT_MAX_FILES;

        for (const configPath of this.config?.paths ?? []) {
            if (this.fileCount >= maxFiles) {
                logger.warn(`Reached maximum file limit (${maxFiles}), stopping scan`);
                break;
            }

            try {
                const root = await fs.realpath(path.resolve(configPath));
                await this.scanPath(root, 0, root);
            } catch (error) {
                logger.warn(
                    `Failed to scan path '${configPath}': ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        logger.debug(
            `FileSystem resources cached: ${this.resourcesCache.size} resources (${this.fileCount} files scanned)`
        );
    }

    private async scanPath(
        targetPath: string,
        currentDepth: number,
        rootBase?: string
    ): Promise<void> {
        const resolvedPath = path.resolve(targetPath);
        let canonical: string;
        try {
            canonical = await fs.realpath(resolvedPath);
        } catch {
            return;
        }
        if (!this.isPathAllowed(canonical)) return;

        // Skip blob storage directories to avoid conflicts with BlobResourceHandler
        if (this.isBlobStorageDirectory(canonical)) {
            return;
        }

        const maxDepth = this.config?.maxDepth ?? FileSystemResourceHandler.DEFAULT_MAX_DEPTH;
        const maxFiles = this.config?.maxFiles ?? FileSystemResourceHandler.DEFAULT_MAX_FILES;
        const includeHidden = this.config?.includeHidden ?? false;
        const includeExtensions =
            this.config?.includeExtensions ?? FileSystemResourceHandler.DEFAULT_INCLUDE_EXTENSIONS;

        if (this.fileCount >= maxFiles) return;
        if (currentDepth > maxDepth) {
            logger.debug(`Skipping path due to depth limit (${maxDepth}): ${canonical}`);
            return;
        }
        if (this.visitedPaths.has(canonical)) return;
        this.visitedPaths.add(canonical);

        try {
            const stat = await fs.stat(canonical);
            if (stat.isFile()) {
                if (!this.shouldIncludeFile(canonical, includeExtensions, includeHidden)) return;

                const base =
                    rootBase ??
                    this.canonicalRoots.find((r) => canonical.startsWith(r)) ??
                    process.cwd();
                const rel = path.relative(base, canonical).replace(/\\/g, '/');
                const uri = `fs://${rel}`;
                this.resourcesCache.set(uri, {
                    uri,
                    name: this.generateCleanFileName(canonical),
                    description: 'Filesystem resource',
                    source: 'custom',
                    size: stat.size,
                    lastModified: stat.mtime,
                });
                this.fileCount++;
                return;
            }

            if (stat.isDirectory()) {
                const entries = await fs.readdir(canonical);
                for (const entry of entries) {
                    const entryPath = path.join(canonical, entry);
                    await this.scanPath(
                        entryPath,
                        currentDepth + 1,
                        rootBase ?? this.canonicalRoots.find((r) => canonical.startsWith(r))
                    );
                }
            }
        } catch (error) {
            logger.debug(
                `Skipping inaccessible path: ${canonical} - ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private shouldIncludeFile(
        filePath: string,
        includeExtensions: string[],
        includeHidden: boolean
    ): boolean {
        const basename = path.basename(filePath).toLowerCase();
        const ext = path.extname(filePath).toLowerCase();

        if (basename.startsWith('.')) {
            if (!includeHidden) {
                const allowedDotfiles = [
                    '.gitignore',
                    '.env',
                    '.env.example',
                    '.npmignore',
                    '.dockerignore',
                    '.editorconfig',
                ];
                if (!allowedDotfiles.includes(basename)) return false;
            }
            if (basename === '.env' || basename.startsWith('.env.')) return true;
        }

        if (!ext) {
            const commonNoExtFiles = [
                'dockerfile',
                'makefile',
                'readme',
                'license',
                'changelog',
                'contributing',
            ];
            return commonNoExtFiles.some((common) => basename.includes(common));
        }

        if (basename === '.gitignore') return true;

        return includeExtensions.includes(ext);
    }

    /**
     * Generate a clean, user-friendly filename from a potentially messy path
     */
    private generateCleanFileName(filePath: string): string {
        const basename = path.basename(filePath);

        // For screenshot files with timestamps, clean them up
        if (basename.startsWith('Screenshot ') && basename.includes(' at ')) {
            // "Screenshot 2025-09-14 at 11.39.20 PM.png" -> "Screenshot 2025-09-14.png"
            const match = basename.match(/^Screenshot (\d{4}-\d{2}-\d{2}).*?(\.[^.]+)$/);
            if (match) {
                return `Screenshot ${match[1]}${match[2]}`;
            }
        }

        // For other temp files, just use the basename as-is
        // but remove any weird prefixes or temp markers
        if (basename.length > 50) {
            // If filename is too long, try to extract meaningful parts
            const ext = path.extname(basename);
            const nameWithoutExt = path.basename(basename, ext);

            // Look for recognizable patterns
            const patterns = [
                /Screenshot.*(\d{4}-\d{2}-\d{2})/,
                /([A-Za-z\s]+\d{4}-\d{2}-\d{2})/,
                /(image|photo|file).*(\d+)/i,
            ];

            for (const pattern of patterns) {
                const match = nameWithoutExt.match(pattern);
                if (match) {
                    return `${match[1] || match[0]}${ext}`;
                }
            }

            // If no pattern matches, truncate intelligently
            if (nameWithoutExt.length > 30) {
                return `${nameWithoutExt.substring(0, 30)}...${ext}`;
            }
        }

        return basename;
    }

    private getMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
            '.txt': 'text/plain',
            '.md': 'text/markdown',
            '.markdown': 'text/markdown',
            '.html': 'text/html',
            '.htm': 'text/html',
            '.css': 'text/css',
            '.js': 'text/javascript',
            '.mjs': 'text/javascript',
            '.jsx': 'text/javascript',
            '.ts': 'text/typescript',
            '.tsx': 'text/typescript',
            '.vue': 'text/x-vue',
            '.json': 'application/json',
            '.xml': 'text/xml',
            '.yaml': 'text/yaml',
            '.yml': 'text/yaml',
            '.toml': 'text/toml',
            '.ini': 'text/plain',
            '.cfg': 'text/plain',
            '.conf': 'text/plain',
            '.py': 'text/x-python',
            '.rb': 'text/x-ruby',
            '.php': 'text/x-php',
            '.java': 'text/x-java',
            '.kt': 'text/x-kotlin',
            '.swift': 'text/x-swift',
            '.go': 'text/x-go',
            '.rs': 'text/x-rust',
            '.cpp': 'text/x-c++',
            '.c': 'text/x-c',
            '.h': 'text/x-c',
            '.hpp': 'text/x-c++',
            '.sh': 'text/x-shellscript',
            '.bash': 'text/x-shellscript',
            '.zsh': 'text/x-shellscript',
            '.fish': 'text/x-shellscript',
            '.sql': 'text/x-sql',
            '.rst': 'text/x-rst',
            '.tex': 'text/x-tex',
            '.dockerfile': 'text/x-dockerfile',
        };
        return mimeTypes[ext] || 'text/plain';
    }
}

export class BlobResourceHandler implements InternalResourceHandler {
    private config?: BlobResourceConfig;
    private blobService?: BlobService;

    getType(): string {
        return 'blob';
    }

    async initialize(
        config: InternalResourceConfig,
        services: InternalResourceServices
    ): Promise<void> {
        if (config.type !== 'blob') {
            throw ResourceError.providerError(
                'Blob',
                'initialize',
                'Invalid config type for BlobResourceHandler'
            );
        }
        this.config = config;

        // Use the provided BlobService from services
        if (!services.blobService) {
            throw ResourceError.providerError(
                'Blob',
                'initialize',
                'BlobService is required but not provided in services'
            );
        }

        this.blobService = services.blobService;
        logger.debug('BlobResourceHandler initialized with BlobService');
    }

    async listResources(): Promise<ResourceMetadata[]> {
        logger.debug('🔍 BlobResourceHandler.listResources() called');

        if (!this.blobService) {
            logger.warn('❌ BlobResourceHandler: blobService is undefined');
            return [];
        }

        try {
            const stats = await this.blobService.getStats();
            logger.debug(
                `📊 BlobService stats: ${stats.count} blobs, backend: ${stats.backendType}`
            );
            const resources: ResourceMetadata[] = [];

            // Try to list individual blobs if the backend supports it
            try {
                const blobs = await this.blobService.listBlobs();
                logger.debug(`📄 Found ${blobs.length} individual blobs`);

                for (const blob of blobs) {
                    // Generate a user-friendly name with proper extension
                    const displayName = this.generateBlobDisplayName(blob.metadata, blob.id);
                    const friendlyType = this.getFriendlyType(blob.metadata.mimeType);

                    resources.push({
                        uri: blob.uri,
                        name: displayName,
                        description: `${friendlyType} (${this.formatSize(blob.metadata.size)})${blob.metadata.source ? ` • ${blob.metadata.source}` : ''}`,
                        source: 'custom',
                        size: blob.metadata.size,
                        mimeType: blob.metadata.mimeType,
                        lastModified: new Date(blob.metadata.createdAt),
                        metadata: {
                            type: 'blob',
                            source: blob.metadata.source,
                            hash: blob.metadata.hash,
                            createdAt: blob.metadata.createdAt,
                            originalName: blob.metadata.originalName,
                        },
                    });
                }
            } catch (error) {
                logger.warn(`Failed to list individual blobs: ${String(error)}`);
            }

            // Add summary resource if we have blobs
            if (stats.count > 0) {
                resources.unshift({
                    uri: 'blob:store',
                    name: 'Blob Storage',
                    description: `${stats.backendType} blob storage with ${stats.count} blobs (${Math.round(stats.totalSize / 1024)}KB)`,
                    source: 'custom',
                    size: stats.totalSize,
                    metadata: {
                        type: 'blob-store',
                        count: stats.count,
                        backendType: stats.backendType,
                        ...(stats.storePath && { storePath: stats.storePath }),
                        ...(stats.bucket && { bucket: stats.bucket }),
                    },
                });
            }

            logger.debug(`✅ BlobResourceHandler returning ${resources.length} resources`);
            return resources;
        } catch (error) {
            logger.warn(`Failed to list blob resources: ${String(error)}`);
            return [];
        }
    }

    canHandle(uri: string): boolean {
        return uri.startsWith('blob:');
    }

    async readResource(uri: string): Promise<ReadResourceResult> {
        if (!this.canHandle(uri)) {
            throw ResourceError.noSuitableProvider(uri);
        }

        if (!this.blobService) {
            throw ResourceError.providerNotInitialized('Blob', uri);
        }

        try {
            // Extract blob ID from URI (remove 'blob:' prefix)
            const blobId = uri.substring(5);

            // Special case: blob store info
            if (blobId === 'store') {
                const stats = await this.blobService.getStats();
                return {
                    contents: [
                        {
                            uri,
                            mimeType: 'application/json',
                            text: JSON.stringify(stats, null, 2),
                        },
                    ],
                };
            }

            // Retrieve actual blob data
            const result = await this.blobService.retrieve(uri, 'base64');

            return {
                contents: [
                    {
                        uri,
                        mimeType: result.metadata.mimeType,
                        blob: result.data as string, // base64 data from retrieve call
                    },
                ],
                _meta: {
                    size: result.metadata.size,
                    createdAt: result.metadata.createdAt,
                    originalName: result.metadata.originalName,
                    source: result.metadata.source,
                },
            };
        } catch (error) {
            if (error instanceof ResourceError) {
                throw error;
            }
            throw ResourceError.readFailed(uri, error);
        }
    }

    async refresh(): Promise<void> {
        // BlobService doesn't need refresh as it's not file-system based scanning
        // But we can perform cleanup of old blobs if needed
        if (this.blobService && this.config?.cleanupAfterDays) {
            try {
                await this.blobService.cleanup();
                logger.debug('Blob service cleanup completed');
            } catch (error) {
                logger.warn(`Blob service cleanup failed: ${String(error)}`);
            }
        }
    }

    getBlobService(): BlobService | undefined {
        return this.blobService;
    }

    /**
     * Generate a user-friendly display name for a blob with proper file extension
     */
    private generateBlobDisplayName(metadata: any, _blobId: string): string {
        // If we have an original name with extension, use it
        if (metadata.originalName && metadata.originalName.includes('.')) {
            return metadata.originalName;
        }

        // Generate a name based on MIME type and content
        let baseName =
            metadata.originalName || this.generateNameFromType(metadata.mimeType, metadata.source);
        const extension = this.getExtensionFromMimeType(metadata.mimeType);

        // Add extension if not present
        if (extension && !baseName.toLowerCase().endsWith(extension)) {
            baseName += extension;
        }

        return baseName;
    }

    /**
     * Generate a descriptive base name from MIME type and source
     */
    private generateNameFromType(mimeType: string, source?: string): string {
        if (mimeType.startsWith('image/')) {
            if (source === 'user') return 'uploaded-image';
            if (source === 'tool') return 'generated-image';
            return 'image';
        }
        if (mimeType.startsWith('text/')) {
            if (source === 'tool') return 'tool-output';
            return 'text-file';
        }
        if (mimeType.startsWith('application/pdf')) {
            return 'document';
        }
        if (mimeType.startsWith('audio/')) {
            return 'audio-file';
        }
        if (mimeType.startsWith('video/')) {
            return 'video-file';
        }

        // Default based on source
        if (source === 'user') return 'user-upload';
        if (source === 'tool') return 'tool-result';
        return 'file';
    }

    /**
     * Get file extension from MIME type
     */
    private getExtensionFromMimeType(mimeType: string): string {
        const mimeToExt: Record<string, string> = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg',
            'text/plain': '.txt',
            'text/markdown': '.md',
            'text/html': '.html',
            'text/css': '.css',
            'application/json': '.json',
            'application/pdf': '.pdf',
            'application/xml': '.xml',
            'audio/mpeg': '.mp3',
            'audio/wav': '.wav',
            'video/mp4': '.mp4',
            'video/webm': '.webm',
        };

        return mimeToExt[mimeType] || '';
    }

    /**
     * Convert MIME type to user-friendly type description
     */
    private getFriendlyType(mimeType: string): string {
        if (mimeType.startsWith('image/')) return 'Image';
        if (mimeType.startsWith('text/')) return 'Text File';
        if (mimeType.startsWith('audio/')) return 'Audio File';
        if (mimeType.startsWith('video/')) return 'Video File';
        if (mimeType === 'application/pdf') return 'PDF Document';
        if (mimeType === 'application/json') return 'JSON Data';
        return 'File';
    }

    /**
     * Format file size in human-readable format
     */
    private formatSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}

export function createInternalResourceHandler(type: string): InternalResourceHandler {
    if (type === 'filesystem') return new FileSystemResourceHandler();
    if (type === 'blob') return new BlobResourceHandler();
    throw new Error(`Unsupported internal resource handler type: ${type}`);
}

export function getInternalResourceHandlerTypes(): string[] {
    return ['filesystem', 'blob'];
}
