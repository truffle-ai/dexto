import { ResourceMetadata } from './types.js';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../logger/index.js';

export interface FileSystemResourceConfig {
    type: 'filesystem';
    paths: string[];
    maxDepth?: number;
    maxFiles?: number;
    includeHidden?: boolean;
    includeExtensions?: string[];
}

export type InternalResourceConfig = FileSystemResourceConfig;

export type InternalResourceServices = {};

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
            throw new Error('Invalid config type for FileSystemResourceHandler');
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

    async readResource(uri: string): Promise<ReadResourceResult> {
        if (!this.canHandle(uri)) {
            throw new Error(`Cannot handle URI: ${uri}`);
        }

        const filePath = uri.replace('fs://', '');
        const resolvedPath = path.resolve(filePath);

        let canonicalPath: string;
        try {
            canonicalPath = await fs.realpath(resolvedPath);
        } catch (_error) {
            throw new Error(`Path does not exist or is not accessible: ${resolvedPath}`);
        }

        if (!this.isPathAllowed(canonicalPath)) {
            throw new Error(`Access denied: path is outside configured roots: ${canonicalPath}`);
        }

        try {
            const stat = await fs.stat(canonicalPath);
            if (stat.size > 10 * 1024 * 1024) {
                throw new Error(`File too large (${stat.size} bytes): ${canonicalPath}`);
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
            throw new Error(
                `Failed to read file ${canonicalPath}: ${error instanceof Error ? error.message : String(error)}`
            );
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

        if (this.fileCount >= maxFiles) return;
        if (currentDepth > maxDepth) {
            logger.debug(`Skipping path due to depth limit (${maxDepth}): ${resolvedPath}`);
            return;
        }
        if (this.visitedPaths.has(resolvedPath)) return;
        this.visitedPaths.add(resolvedPath);

        try {
            const stat = await fs.stat(resolvedPath);
            if (stat.isFile()) {
                if (!this.shouldIncludeFile(resolvedPath, includeExtensions, includeHidden)) return;

                const uri = `fs://${path.relative(process.cwd(), resolvedPath)}`;
                this.resourcesCache.set(uri, {
                    uri,
                    name: path.basename(resolvedPath),
                    description: 'Filesystem resource',
                    source: 'custom',
                    size: stat.size,
                    lastModified: stat.mtime,
                });
                this.fileCount++;
                return;
            }

            if (stat.isDirectory()) {
                const entries = await fs.readdir(resolvedPath);
                for (const entry of entries) {
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

export function createInternalResourceHandler(type: string): InternalResourceHandler {
    if (type === 'filesystem') return new FileSystemResourceHandler();
    throw new Error(`Unsupported internal resource handler type: ${type}`);
}

export function getInternalResourceHandlerTypes(): string[] {
    return ['filesystem'];
}
