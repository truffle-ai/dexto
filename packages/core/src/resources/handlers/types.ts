import type { ResourceMetadata } from '../types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

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
    // NOTE: Storage configuration (maxBlobSize, maxTotalSize, etc.) is in blobStorage section
}

export type InternalResourceConfig = FileSystemResourceConfig | BlobResourceConfig;

export type InternalResourceServices = {
    blobService?: import('../../blob/index.js').BlobService;
};

export interface InternalResourceHandler {
    getType(): string;
    initialize(services: InternalResourceServices): Promise<void>;
    listResources(): Promise<ResourceMetadata[]>;
    readResource(uri: string): Promise<ReadResourceResult>;
    canHandle(uri: string): boolean;
    refresh?(): Promise<void>;
}
