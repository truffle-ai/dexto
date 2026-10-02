import type { Logger } from '../logger/v2/types.js';
import { cloneQueuedMessage, cloneQueuedMessages } from '../session/queue-clone.js';
import type { QueuedMessage } from '../session/types.js';
import type { ApprovalStore } from '../storage/approvals/types.js';
import type { SessionMessageQueueStore } from '../storage/message-queue/types.js';
import {
    createQueueTakeFilter,
    selectMissingMessages,
} from '../storage/message-queue/take-filter.js';
import { InMemoryDextoStores } from '../storage/stores/in-memory.js';
import { SessionToolPreferencesStore } from '../tools/session-tool-preferences-store.js';

export function createInMemorySessionApprovalStore(logger: Logger): ApprovalStore {
    void logger;
    return new InMemoryDextoStores().getStore('approvals');
}

export function createInMemorySessionToolPreferencesStore(
    logger: Logger
): SessionToolPreferencesStore {
    return new SessionToolPreferencesStore(
        new InMemoryDextoStores().getStore('toolPreferences'),
        logger
    );
}

export function createInMemoryMessageQueueStore(): SessionMessageQueueStore {
    const queues = new Map<string, QueuedMessage[]>();

    return {
        async list(input: { sessionId: string }): Promise<QueuedMessage[]> {
            return cloneQueuedMessages(queues.get(input.sessionId) ?? []);
        },
        async append(input: {
            sessionId: string;
            message: QueuedMessage;
        }): Promise<{ position: number }> {
            const queue = [
                ...(queues.get(input.sessionId) ?? []),
                cloneQueuedMessage(input.message),
            ];
            queues.set(input.sessionId, queue);
            return { position: queue.length };
        },
        async takeAll(input: {
            sessionId: string;
            excludeIds?: readonly string[];
            onlyIds?: readonly string[];
        }): Promise<QueuedMessage[]> {
            const isTaken = createQueueTakeFilter(input);
            const queue = queues.get(input.sessionId) ?? [];
            const kept = queue.filter((message) => !isTaken(message));
            const taken = cloneQueuedMessages(queue.filter(isTaken));
            if (kept.length === 0) {
                queues.delete(input.sessionId);
            } else {
                queues.set(input.sessionId, kept);
            }
            return taken;
        },
        async prepend(input: {
            sessionId: string;
            messages: readonly QueuedMessage[];
        }): Promise<void> {
            const queue = queues.get(input.sessionId) ?? [];
            const restored = selectMissingMessages(queue, input.messages);
            if (restored.length > 0) {
                queues.set(input.sessionId, [...restored, ...queue]);
            }
        },
        async remove(input: { sessionId: string; id: string }): Promise<boolean> {
            const queue = queues.get(input.sessionId) ?? [];
            const updatedQueue = queue.filter((message) => message.id !== input.id);
            if (updatedQueue.length === queue.length) {
                return false;
            }
            if (updatedQueue.length === 0) {
                queues.delete(input.sessionId);
            } else {
                queues.set(input.sessionId, updatedQueue);
            }
            return true;
        },
        async clear(input: { sessionId: string }): Promise<void> {
            queues.delete(input.sessionId);
        },
    };
}
