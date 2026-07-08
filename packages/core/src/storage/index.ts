/**
 * @dexto/core storage surface
 *
 * Core exposes typed store contracts and concrete in-memory/backend store composition.
 */

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
export {
    BackendDextoStores,
    DatabaseBackedApprovalStore,
    DatabaseBackedArtifactStore,
    DatabaseBackedCustomPromptStore,
    DatabaseBackedMemoryStore,
    DatabaseBackedRuntimeEventStore,
    DatabaseBackedSessionMessageQueueStore,
    DatabaseBackedSessionStore,
    DatabaseBackedToolExecutionStore,
    DatabaseBackedToolPreferenceStore,
    DatabaseBackedToolStateStore,
    DatabaseBackedWorkspaceStore,
    SESSION_FOLLOW_UP_QUEUE_KEY_PREFIX,
    SESSION_STEER_QUEUE_KEY_PREFIX,
} from './stores/backend.js';
export type { DextoStoresLifecycle } from './stores/backend.js';
export type { DextoStoreMap, DextoStoreName, DextoStores } from './stores/types.js';
export { DatabaseConversationStore } from './conversation/database.js';
export type {
    ConversationStore,
    ModelHistoryLoad,
    ModelHistoryLoadStats,
} from './conversation/types.js';
export type { SessionStore } from './sessions/types.js';
export type { MemoryStore } from './memories/types.js';
export type { WorkspaceStore } from './workspaces/types.js';
export type { CustomPromptStore } from './prompts/types.js';
export { SessionApprovalStateSchema } from './approvals/types.js';
export type { ApprovalStore, SessionApprovalState } from './approvals/types.js';
export type { ToolPreferenceStore } from './tool-preferences/types.js';
export type { ToolStateStore } from './tool-state/types.js';
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
export type { RuntimeEventRecord, RuntimeEventStore } from './runtime-events/types.js';
export type {
    ToolExecutionCancelledRecord,
    ToolExecutionCompletedRecord,
    ToolExecutionFailedRecord,
    ToolExecutionIdentity,
    ToolExecutionRecord,
    ToolExecutionRunningRecord,
    ToolExecutionStartResult,
    ToolExecutionStore,
} from './tool-executions/types.js';
