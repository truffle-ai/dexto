import type { ResourceMetadata } from '../types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { BlobStore } from '../../storage/blob/blob-store.js';

export type InternalResourceServices = {
    blobStore: BlobStore;
};

export interface InternalResourceHandler {
    getType(): string;
    initialize(services: InternalResourceServices): Promise<void>;
    listResources(): Promise<ResourceMetadata[]>;
    readResource(uri: string): Promise<ReadResourceResult>;
    canHandle(uri: string): boolean;
    refresh?(): Promise<void>;
}
