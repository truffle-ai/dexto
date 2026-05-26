import type { ResourceMetadata } from '../types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { ArtifactStore } from '../../storage/artifacts/types.js';

export type InternalResourceServices = {
    artifactStore: ArtifactStore;
};

export interface InternalResourceHandler {
    getType(): string;
    initialize(services: InternalResourceServices): Promise<void>;
    listResources(): Promise<ResourceMetadata[]>;
    readResource(uri: string): Promise<ReadResourceResult>;
    canHandle(uri: string): boolean;
    refresh?(): Promise<void>;
}
