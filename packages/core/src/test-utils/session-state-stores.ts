import type { Logger } from '../logger/v2/types.js';
import type { StorageManager } from '../storage/index.js';
import { SessionApprovalStore } from '../approval/session-approval-store.js';
import type { MessageQueueStore } from '../session/message-queue-store.js';
import type { QueuedMessage } from '../session/types.js';
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
    storageManager: SessionStateStorage = createInMemorySessionStateStorage()
): SessionApprovalStore {
    return new SessionApprovalStore(storageManager as StorageManager, logger);
}

export function createInMemorySessionToolPreferencesStore(
    logger: Logger,
    storageManager: SessionStateStorage = createInMemorySessionStateStorage()
): SessionToolPreferencesStore {
    return new SessionToolPreferencesStore(storageManager as StorageManager, logger);
}

export function createInMemoryMessageQueueStore(): Pick<
    MessageQueueStore,
    'load' | 'save' | 'delete'
> {
    const queues = new Map<string, QueuedMessage[]>();

    return {
        async load(sessionId: string): Promise<QueuedMessage[]> {
            return structuredClone(queues.get(sessionId) ?? []);
        },
        async save(sessionId: string, queue: QueuedMessage[]): Promise<void> {
            if (queue.length === 0) {
                queues.delete(sessionId);
                return;
            }

            queues.set(sessionId, structuredClone(queue));
        },
        async delete(sessionId: string): Promise<void> {
            queues.delete(sessionId);
        },
    };
}
