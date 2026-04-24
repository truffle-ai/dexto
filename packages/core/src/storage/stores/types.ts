import type { ApprovalStore } from '../approvals/types.js';
import type { ArtifactStore } from '../artifacts/types.js';
import type { CacheStore } from '../cache-store/types.js';
import type { ConversationStore } from '../conversation/types.js';
import type { SessionMessageQueueStore } from '../message-queue/types.js';
import type { RuntimeEventStore } from '../runtime-events/types.js';
import type { ToolPreferenceStore } from '../tool-preferences/types.js';

export interface DextoStoreMap {
    conversation: ConversationStore;
    approvals: ApprovalStore;
    toolPreferences: ToolPreferenceStore;
    messageQueue: SessionMessageQueueStore;
    artifacts: ArtifactStore;
    cache: CacheStore;
    runtimeEvents: RuntimeEventStore;
}

export type DextoStoreName = keyof DextoStoreMap;

export interface DextoStores {
    getStore<K extends DextoStoreName>(name: K): DextoStoreMap[K];
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    getStoreType(): string;
}
