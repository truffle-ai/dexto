import type { Logger } from '../logger/v2/types.js';
import type { StorageManager } from '../storage/index.js';
import type { QueuedMessage } from '../session/types.js';
import type { ApprovalStore } from '../storage/approvals/types.js';
import type { SessionMessageQueueStore } from '../storage/message-queue/types.js';
import { InMemoryDextoStores } from '../storage/stores/in-memory.js';
import { SessionToolPreferencesStore } from '../tools/session-tool-preferences-store.js';
import { createInMemoryCache, createInMemoryDatabase } from './in-memory-storage.js';

type SessionStateStorage = Pick<StorageManager, 'getCache' | 'getDatabase'>;

export function createInMemorySessionStateStorage(): SessionStateStorage {
    const cache = createInMemoryCache();
    const database = createInMemoryDatabase();

    return {
        getCache: () => cache,
        getDatabase: () => database,
    };
}

export function createInMemorySessionApprovalStore(
    logger: Logger,
    _storageManager: SessionStateStorage = createInMemorySessionStateStorage()
): ApprovalStore {
    void logger;
    return new InMemoryDextoStores().getStore('approvals');
}

export function createInMemorySessionToolPreferencesStore(
    logger: Logger,
    storageManager: SessionStateStorage = createInMemorySessionStateStorage()
): SessionToolPreferencesStore {
    return new SessionToolPreferencesStore(storageManager as StorageManager, logger);
}

export function createInMemoryMessageQueueStore(): SessionMessageQueueStore {
    const queues = new Map<string, QueuedMessage[]>();

    return {
        async load(input: { sessionId: string }): Promise<QueuedMessage[]> {
            return structuredClone(queues.get(input.sessionId) ?? []);
        },
        async save(input: { sessionId: string; queue: QueuedMessage[] }): Promise<void> {
            if (input.queue.length === 0) {
                queues.delete(input.sessionId);
                return;
            }

            queues.set(input.sessionId, structuredClone(input.queue));
        },
        async delete(input: { sessionId: string }): Promise<void> {
            queues.delete(input.sessionId);
        },
    };
}
