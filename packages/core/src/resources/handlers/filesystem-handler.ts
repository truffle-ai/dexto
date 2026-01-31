import { promises as fs } from 'fs';
import path from 'path';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import { ResourceError } from '../errors.js';
import type { ResourceMetadata } from '../types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { ValidatedFileSystemResourceConfig } from '../schemas.js';
import type { InternalResourceHandler, InternalResourceServices } from './types.js';

export class FileSystemResourceHandler implements InternalResourceHandler {
    private config: ValidatedFileSystemResourceConfig;
    private resourcesCache: Map<string, ResourceMetadata> = new Map();
    private visitedPaths: Set<string> = new Set();
    private fileCount: number = 0;
    private canonicalRoots: string[] = [];
    private blobStoragePath: string | undefined;
    private logger: IDextoLogger;

    constructor(
        config: ValidatedFileSystemResourceConfig,
        logger: IDextoLogger,
        blobStoragePath?: string
    ) {
        this.config = config;
        this.logger = logger.createChild(DextoLogComponent.RESOURCE);
        this.blobStoragePath = blobStoragePath;
    }

    getType(): string {
        return 'filesystem';
    }

    async initialize(_services: InternalResourceServices): Promise<void> {
        // Config is set in constructor, just do async initialization
        this.canonicalRoots = [];
        for (const configPath of this.config.paths) {
            try {
                const canonicalRoot = await fs.realpath(path.resolve(configPath));
                this.canonicalRoots.push(canonicalRoot);
            } catch (error) {
                this.logger.warn(
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
        if (!this.blobStoragePath) {
            return false;
        }

        // Check if this path is under the actual blob storage directory
        const normalizedPath = path.normalize(canonicalPath);
        const normalizedBlobPath = path.normalize(this.blobStoragePath);

        return (
            normalizedPath === normalizedBlobPath ||
            normalizedPath.startsWith(normalizedBlobPath + path.sep)
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

        const { maxFiles, paths } = this.config;

        for (const configPath of paths) {
            if (this.fileCount >= maxFiles) {
                this.logger.warn(`Reached maximum file limit (${maxFiles}), stopping scan`);
                break;
            }

            try {
                const root = await fs.realpath(path.resolve(configPath));
                await this.scanPath(root, 0, root);
            } catch (error) {
                this.logger.warn(
                    `Failed to scan path '${configPath}': ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        this.logger.debug(
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

        // Config has defaults already applied by schema validation
        const { maxDepth, maxFiles, includeHidden, includeExtensions } = this.config;

        if (this.fileCount >= maxFiles) return;
        if (currentDepth > maxDepth) {
            // silly to avoid spamming the logs
            this.logger.silly(`Skipping path due to depth limit (${maxDepth}): ${canonical}`);
            return;
        }
        if (this.visitedPaths.has(canonical)) return;
        this.visitedPaths.add(canonical);

        try {
            const stat = await fs.stat(canonical);
            if (stat.isFile()) {
                if (!this.shouldIncludeFile(canonical, includeExtensions, includeHidden)) return;

                // Use absolute canonical path to ensure readResource resolves correctly
                const uri = `fs://${canonical.replace(/\\/g, '/')}`;
                this.resourcesCache.set(uri, {
                    uri,
                    name: this.generateCleanFileName(canonical),
                    description: 'Filesystem resource',
                    source: 'internal',
                    size: stat.size,
                    lastModified: stat.mtime,
                });
                this.fileCount++;
                return;
            }

            if (stat.isDirectory()) {
                const basename = path.basename(canonical).toLowerCase();
                if (this.shouldIgnoreDirectory(basename)) {
                    return;
                }

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
            this.logger.debug(
                `Skipping inaccessible path: ${canonical} - ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private shouldIgnoreDirectory(basename: string): boolean {
        const ignoredDirectories = [
            'node_modules',
            '.git',
            '.turbo',
            '.next',
            'dist',
            'build',
            'out',
            'coverage',
            '.cache',
            '.vscode',
            '.idea',
            '.changeset',
            '.github',
            '.husky',
            'tmp',
            'temp',
        ];
        return ignoredDirectories.includes(basename);
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
