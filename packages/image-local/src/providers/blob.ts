/**
 * Blob storage providers for local development
 */

import { LocalBlobStore, InMemoryBlobStore } from '@dexto/core';
import type { BlobStoreProvider } from '@dexto/core';

export const localBlobProvider: BlobStoreProvider<'local'> = {
    type: 'local',
    configSchema: null as any, // Uses built-in schema from core
    create: (config: any, deps: any) => {
        return new LocalBlobStore(config, deps.logger);
    },
    metadata: {
        displayName: 'Local Filesystem',
        description: 'Stores blobs in local filesystem',
        requiresFilesystem: true,
        requiresNetwork: false,
        persistenceLevel: 'persistent',
        platforms: ['node'],
    },
};

export const inMemoryBlobProvider: BlobStoreProvider<'in-memory'> = {
    type: 'in-memory',
    configSchema: null as any,
    create: (config: any, deps: any) => {
        return new InMemoryBlobStore(config, deps.logger);
    },
    metadata: {
        displayName: 'In-Memory Blob Storage',
        description: 'Stores blobs in memory (ephemeral)',
        requiresFilesystem: false,
        requiresNetwork: false,
        persistenceLevel: 'ephemeral',
        platforms: ['node', 'browser', 'edge'],
    },
};
