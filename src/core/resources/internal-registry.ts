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
            const content = await fs.readFile(resolvedPath, 'utf-8');
            return {
                contents: [
                    {
                        uri,
                        mimeType: this.getMimeType(resolvedPath),
                        text: content,
                    },
                ],
                _meta: {},
            };
        } catch (error) {
            throw new Error(
                `Failed to read file ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    async refresh(): Promise<void> {
        await this.buildResourceCache();
    }

    private async buildResourceCache(): Promise<void> {
        if (!this.config) return;

        this.resourcesCache.clear();
        this.visitedPaths.clear();

        for (const configPath of this.config.paths) {
            try {
                await this.scanPath(configPath);
            } catch (error) {
                logger.warn(
                    `Failed to scan path '${configPath}': ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        logger.debug(`FileSystem resources cached: ${this.resourcesCache.size} resources`);
    }

    private async scanPath(targetPath: string): Promise<void> {
        const resolvedPath = path.resolve(targetPath);

        // Check if we've already visited this path (prevent cycles/infinite recursion)
        if (this.visitedPaths.has(resolvedPath)) {
            return;
        }

        this.visitedPaths.add(resolvedPath);

        try {
            const stat = await fs.stat(resolvedPath);

            if (stat.isFile()) {
                const uri = `fs://${resolvedPath}`;
                const metadata: ResourceMetadata = {
                    uri,
                    name: path.basename(resolvedPath),
                    description: `File: ${resolvedPath}`,
                    source: 'custom',
                    size: stat.size,
                    lastModified: stat.mtime,
                    mimeType: this.getMimeType(resolvedPath),
                };
                this.resourcesCache.set(uri, metadata);
            } else if (stat.isDirectory()) {
                const entries = await fs.readdir(resolvedPath);

                for (const entry of entries) {
                    // Skip hidden files and directories that start with . (except if explicitly targeted)
                    if (
                        entry.startsWith('.') &&
                        targetPath !== '.' &&
                        !targetPath.endsWith('/.' + entry)
                    ) {
                        continue;
                    }

                    const entryPath = path.join(resolvedPath, entry);
                    await this.scanPath(entryPath);
                }
            }
        } catch (_error) {
            logger.debug(`Skipping inaccessible path: ${resolvedPath}`);
        }
    }

    private getMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
            '.txt': 'text/plain',
            '.md': 'text/markdown',
            '.js': 'text/javascript',
            '.ts': 'text/typescript',
            '.json': 'application/json',
            '.html': 'text/html',
            '.css': 'text/css',
            '.py': 'text/x-python',
            '.yaml': 'text/yaml',
            '.yml': 'text/yaml',
            '.xml': 'text/xml',
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
