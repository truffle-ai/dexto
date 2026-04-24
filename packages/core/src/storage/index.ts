/**
 * @dexto/core storage surface
 *
 * Core exposes only:
 * - storage interfaces (`BlobStore`, `Database`, `Cache`)
 * - the `StorageManager` lifecycle wrapper
 * - storage error types/codes
 *
 * Concrete implementations + config schemas live in `@dexto/storage`.
 */

export { StorageManager } from './storage-manager.js';
export type { StorageBackends } from './storage-manager.js';

export { StorageError } from './errors.js';
export { StorageErrorCode } from './error-codes.js';

export type { Cache } from './cache/types.js';
export type { Database } from './database/types.js';
export type { BlobStore } from './blob/types.js';
export type {
    BlobInput,
    BlobMetadata,
    StoredBlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
} from './blob/types.js';

export { InMemoryDextoStores } from './stores/in-memory.js';
export { DatabaseBackedDextoStores } from './stores/database-backed.js';
export type { DatabaseBackedDextoStoresBackends } from './stores/database-backed.js';
export type { DextoStoreMap, DextoStoreName, DextoStores } from './stores/types.js';
export { DatabaseConversationStore } from './conversation/database.js';
export type { ConversationStore } from './conversation/types.js';
export type { ApprovalStore } from './approvals/types.js';
export type { ToolPreferenceStore } from './tool-preferences/types.js';
export type { SessionMessageQueueStore } from './message-queue/types.js';
export type {
    ArtifactData,
    ArtifactFormat,
    ArtifactInput,
    ArtifactMetadata,
    ArtifactReference,
    ArtifactStats,
    ArtifactStore,
    StoredArtifactMetadata,
} from './artifacts/types.js';
export type { CacheStore } from './cache-store/types.js';
export type { RuntimeEventRecord, RuntimeEventStore } from './runtime-events/types.js';
