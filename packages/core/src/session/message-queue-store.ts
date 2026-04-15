import type { Logger } from '../logger/v2/types.js';
import type { StorageManager } from '../storage/index.js';
import type { QueuedMessage } from './types.js';

export interface MessageQueueStoreLike {
    load(sessionId: string): Promise<QueuedMessage[]>;
    save(sessionId: string, queue: QueuedMessage[]): Promise<void>;
    delete(sessionId: string): Promise<void>;
}

export class MessageQueueStore implements MessageQueueStoreLike {
    private readonly cacheTtlSeconds: number;

    constructor(
        private readonly storageManager: StorageManager,
        private readonly logger: Logger,
        options: { cacheTtlMs?: number } = {}
    ) {
        const cacheTtlMs = options.cacheTtlMs ?? 3600000;
        this.cacheTtlSeconds = Math.max(1, Math.floor(cacheTtlMs / 1000));
    }

    private buildKey(sessionId: string): string {
        return `session-message-queue:${sessionId}`;
    }

    async load(sessionId: string): Promise<QueuedMessage[]> {
        const key = this.buildKey(sessionId);
        const cached = await this.storageManager.getCache().get<QueuedMessage[] | unknown>(key);
        if (Array.isArray(cached)) {
            return structuredClone(cached);
        }

        const stored = await this.storageManager.getDatabase().get<QueuedMessage[] | unknown>(key);
        if (!Array.isArray(stored)) {
            if (stored !== undefined) {
                this.logger.warn('Invalid persisted message queue encountered; ignoring state', {
                    key,
                });
            }
            return [];
        }

        const cloned = structuredClone(stored);
        await this.storageManager.getCache().set(key, cloned, this.cacheTtlSeconds);
        return cloned;
    }

    async save(sessionId: string, queue: QueuedMessage[]): Promise<void> {
        const key = this.buildKey(sessionId);
        if (queue.length === 0) {
            await this.delete(sessionId);
            return;
        }

        const cloned = structuredClone(queue);
        await this.storageManager.getDatabase().set(key, cloned);
        await this.storageManager.getCache().set(key, cloned, this.cacheTtlSeconds);
    }

    async delete(sessionId: string): Promise<void> {
        const key = this.buildKey(sessionId);
        await Promise.all([
            this.storageManager.getDatabase().delete(key),
            this.storageManager.getCache().delete(key),
        ]);
    }
}

export class InMemoryMessageQueueStore implements MessageQueueStoreLike {
    private readonly queues = new Map<string, QueuedMessage[]>();

    async load(sessionId: string): Promise<QueuedMessage[]> {
        return structuredClone(this.queues.get(sessionId) ?? []);
    }

    async save(sessionId: string, queue: QueuedMessage[]): Promise<void> {
        if (queue.length === 0) {
            this.queues.delete(sessionId);
            return;
        }

        this.queues.set(sessionId, structuredClone(queue));
    }

    async delete(sessionId: string): Promise<void> {
        this.queues.delete(sessionId);
    }
}
