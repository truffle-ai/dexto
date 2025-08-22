import { ResourceMetadata } from './types.js';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../logger/index.js';

/**
 * Configuration for different internal resource types
 */
export interface FileSystemResourceConfig {
    type: 'filesystem';
    paths: string[];
    /** Maximum directory depth to traverse (default: 3) */
    maxDepth?: number;
    /** Maximum number of files to include (default: 1000) */
    maxFiles?: number;
    /** Include hidden files and directories (default: false) */
    includeHidden?: boolean;
    /** File extensions to include (default: common text files) */
    includeExtensions?: string[];
}

/**
 * Union type for all internal resource configurations
 */
export type InternalResourceConfig = FileSystemResourceConfig;

/**
 * Services available to internal resource handlers
 */
export interface InternalResourceServices {
    // Add services as needed for resource implementations
}

/**
 * Internal resource handler interface
 */
export interface InternalResourceHandler {
    /**
     * Get the resource type this handler manages
     */
    getType(): string;

    /**
     * Initialize the resource handler with configuration
     */
    initialize(config: InternalResourceConfig, services: InternalResourceServices): Promise<void>;

    /**
     * List all resources this handler provides
     */
    listResources(): Promise<ResourceMetadata[]>;

    /**
     * Read a specific resource by URI
     */
    readResource(uri: string): Promise<ReadResourceResult>;

    /**
     * Check if this handler can handle a specific URI
     */
    canHandle(uri: string): boolean;

    /**
     * Refresh/reload resources (optional)
     */
    refresh?(): Promise<void>;
}

/**
 * File System Resource Handler
 * Exposes local files and directories as resources
 */
export class FileSystemResourceHandler implements InternalResourceHandler {
    private config?: FileSystemResourceConfig;
    private resourcesCache: Map<string, ResourceMetadata> = new Map();
    private visitedPaths: Set<string> = new Set();
    private fileCount: number = 0;

    // Default safe limits
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
        '.dockerfile',
        '.gitignore',
        '.env.example',
    ];

    getType(): string {
        return 'filesystem';
    }

    async initialize(
        config: InternalResourceConfig,
        _services: InternalResourceServices
    ): Promise<void> {
        if (config.type !== 'filesystem') {
            throw new Error('Invalid config type for FileSystemResourceHandler');
        }
        this.config = config;
        await this.buildResourceCache();
    }

    async listResources(): Promise<ResourceMetadata[]> {
        return Array.from(this.resourcesCache.values());
    }

    canHandle(uri: string): boolean {
        return uri.startsWith('fs://');
    }

    async readResource(uri: string): Promise<ReadResourceResult> {
        if (!this.canHandle(uri)) {
            throw new Error(`Cannot handle URI: ${uri}`);
        }

        const filePath = uri.replace('fs://', '');
        const resolvedPath = path.resolve(filePath);

        try {
            // Check if file exists and get stats
            const stat = await fs.stat(resolvedPath);
            if (stat.size > 10 * 1024 * 1024) {
                // 10MB limit
                throw new Error(`File too large (${stat.size} bytes): ${resolvedPath}`);
            }

            // Check if file is likely binary before attempting to read as text
            if (this.isBinaryFile(resolvedPath)) {
                return {
                    contents: [
                        {
                            uri,
                            mimeType: this.getMimeType(resolvedPath),
                            text: `[Binary file: ${path.basename(resolvedPath)} (${stat.size} bytes)]`,
                        },
                    ],
                    _meta: { isBinary: true, size: stat.size },
                };
            }

            const content = await fs.readFile(resolvedPath, 'utf-8');
            return {
                contents: [
                    {
                        uri,
                        mimeType: this.getMimeType(resolvedPath),
                        text: content,
                    },
                ],
                _meta: { size: stat.size },
            };
        } catch (error) {
            throw new Error(
                `Failed to read file ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Check if a file is likely binary based on extension
     */
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

        const maxFiles = this.config.maxFiles ?? FileSystemResourceHandler.DEFAULT_MAX_FILES;

        for (const configPath of this.config.paths) {
            if (this.fileCount >= maxFiles) {
                logger.warn(`Reached maximum file limit (${maxFiles}), stopping scan`);
                break;
            }

            try {
                await this.scanPath(configPath, 0);
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

    private async scanPath(targetPath: string, currentDepth: number): Promise<void> {
        const resolvedPath = path.resolve(targetPath);
        const maxDepth = this.config?.maxDepth ?? FileSystemResourceHandler.DEFAULT_MAX_DEPTH;
        const maxFiles = this.config?.maxFiles ?? FileSystemResourceHandler.DEFAULT_MAX_FILES;
        const includeHidden = this.config?.includeHidden ?? false;
        const includeExtensions =
            this.config?.includeExtensions ?? FileSystemResourceHandler.DEFAULT_INCLUDE_EXTENSIONS;

        // Check file limit
        if (this.fileCount >= maxFiles) {
            return;
        }

        // Check depth limit
        if (currentDepth > maxDepth) {
            logger.debug(`Skipping path due to depth limit (${maxDepth}): ${resolvedPath}`);
            return;
        }

        // Check if we've already visited this path (prevent cycles/infinite recursion)
        if (this.visitedPaths.has(resolvedPath)) {
            return;
        }

        this.visitedPaths.add(resolvedPath);

        try {
            const stat = await fs.stat(resolvedPath);

            if (stat.isFile()) {
                // Check if file should be included
                if (!this.shouldIncludeFile(resolvedPath, includeExtensions)) {
                    logger.debug(`Skipping file due to extension filter: ${resolvedPath}`);
                    return;
                }

                // Check file size (skip very large files)
                if (stat.size > 10 * 1024 * 1024) {
                    // 10MB limit
                    logger.debug(`Skipping large file (${stat.size} bytes): ${resolvedPath}`);
                    return;
                }

                const uri = `fs://${resolvedPath}`;
                const metadata: ResourceMetadata = {
                    uri,
                    name: path.basename(resolvedPath),
                    description: `File: ${path.relative(process.cwd(), resolvedPath)}`,
                    source: 'custom',
                    size: stat.size,
                    lastModified: stat.mtime,
                    mimeType: this.getMimeType(resolvedPath),
                };
                this.resourcesCache.set(uri, metadata);
                this.fileCount++;
            } else if (stat.isDirectory()) {
                const basename = path.basename(resolvedPath);

                // Skip hidden directories unless explicitly included
                if (
                    basename.startsWith('.') &&
                    !includeHidden &&
                    targetPath !== '.' &&
                    currentDepth > 0
                ) {
                    logger.debug(`Skipping hidden directory: ${resolvedPath}`);
                    return;
                }

                // Skip common non-useful directories
                const skipDirs = [
                    'node_modules',
                    '.git',
                    '.svn',
                    '.hg',
                    'dist',
                    'build',
                    'coverage',
                    'target',
                ];
                if (skipDirs.includes(basename) && currentDepth > 0) {
                    logger.debug(`Skipping common directory: ${resolvedPath}`);
                    return;
                }

                const entries = await fs.readdir(resolvedPath);

                // Sort entries to ensure consistent ordering
                entries.sort();

                for (const entry of entries) {
                    if (this.fileCount >= maxFiles) {
                        logger.debug(
                            `Reached file limit while scanning directory: ${resolvedPath}`
                        );
                        break;
                    }

                    const entryPath = path.join(resolvedPath, entry);
                    await this.scanPath(entryPath, currentDepth + 1);
                }
            }
        } catch (error) {
            logger.debug(
                `Skipping inaccessible path: ${resolvedPath} - ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Check if a file should be included based on extension filter
     */
    private shouldIncludeFile(filePath: string, includeExtensions: string[]): boolean {
        const ext = path.extname(filePath).toLowerCase();

        // Always include files without extensions (like Dockerfile, Makefile, etc.)
        if (!ext) {
            const basename = path.basename(filePath).toLowerCase();
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

        return includeExtensions.includes(ext);
    }

    private getMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
            // Text files
            '.txt': 'text/plain',
            '.md': 'text/markdown',
            '.markdown': 'text/markdown',

            // Web technologies
            '.html': 'text/html',
            '.htm': 'text/html',
            '.css': 'text/css',
            '.js': 'text/javascript',
            '.mjs': 'text/javascript',
            '.jsx': 'text/javascript',
            '.ts': 'text/typescript',
            '.tsx': 'text/typescript',
            '.vue': 'text/x-vue',

            // Data formats
            '.json': 'application/json',
            '.xml': 'text/xml',
            '.yaml': 'text/yaml',
            '.yml': 'text/yaml',
            '.toml': 'text/toml',
            '.ini': 'text/plain',
            '.cfg': 'text/plain',
            '.conf': 'text/plain',

            // Programming languages
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

            // Shell scripts
            '.sh': 'text/x-shellscript',
            '.bash': 'text/x-shellscript',
            '.zsh': 'text/x-shellscript',
            '.fish': 'text/x-shellscript',

            // Database
            '.sql': 'text/x-sql',

            // Documentation
            '.rst': 'text/x-rst',
            '.tex': 'text/x-tex',

            // Docker & Infrastructure
            '.dockerfile': 'text/x-dockerfile',
        };
        return mimeTypes[ext] || 'text/plain';
    }
}

/**
 * Internal Resource Registry
 * Manages different types of internal resource handlers
 */
export const INTERNAL_RESOURCE_HANDLERS: Record<string, () => InternalResourceHandler> = {
    filesystem: () => new FileSystemResourceHandler(),
    // Add new resource handlers here
};

/**
 * Get available internal resource handler types
 */
export function getInternalResourceHandlerTypes(): string[] {
    return Object.keys(INTERNAL_RESOURCE_HANDLERS);
}

/**
 * Create an internal resource handler by type
 */
export function createInternalResourceHandler(type: string): InternalResourceHandler {
    const factory = INTERNAL_RESOURCE_HANDLERS[type];
    if (!factory) {
        throw new Error(`Unknown internal resource handler type: ${type}`);
    }
    return factory();
}
