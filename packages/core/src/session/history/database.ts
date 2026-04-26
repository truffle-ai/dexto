import type { Logger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import type { Database } from '../../storage/types.js';
import { SessionError } from '../errors.js';
import type { InternalMessage } from '../../context/types.js';
import type { ConversationHistoryProvider } from './types.js';

/**
 * History provider that works directly with DatabaseBackend.
 * Uses write-through caching for read performance while maintaining durability.
 *
 * Caching strategy:
 * - getHistory(): Returns cached messages after first load (eliminates repeated DB reads)
 * - saveMessage(): Updates cache AND writes to DB immediately (new messages are critical)
 * - updateMessage(): Updates cache immediately, debounces DB writes (batches rapid updates)
 * - flush(): Appends the latest pending updates to DB (called at turn boundaries)
 * - clearHistory(): Clears cache and DB immediately
 *
 * Durability guarantees:
 * - New messages (saveMessage) are always immediately durable
 * - Updates (updateMessage) are durable within flush interval or on explicit flush()
 * - Worst case on crash: lose updates from last flush interval (typically <100ms)
 */
export class DatabaseHistoryProvider implements ConversationHistoryProvider {
    private logger: Logger;

    // Cache state
    private cache: InternalMessage[] | null = null;
    private pendingUpdates = new Map<string, InternalMessage>();
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private flushPromise: Promise<void> | null = null;

    // Flush configuration
    private static readonly FLUSH_DELAY_MS = 100; // Debounce window for batching updates

    constructor(
        private sessionId: string,
        private database: Database,
        logger: Logger
    ) {
        this.logger = logger.createChild(DextoLogComponent.SESSION);
    }

    async getHistory(): Promise<InternalMessage[]> {
        // Load from DB on first access
        if (this.cache === null) {
            const key = this.getMessagesKey();
            try {
                const limit = 10000;
                const rawMessages = await this.database.getRange<InternalMessage>(key, 0, limit);

                if (rawMessages.length === limit) {
                    this.logger.warn(
                        `DatabaseHistoryProvider: Session ${this.sessionId} hit message limit (${limit}), history may be truncated`
                    );
                }

                // Deduplicate message updates by ID: keep the latest version in the original slot.
                const seenIndexes = new Map<string, number>();
                this.cache = [];
                let duplicateCount = 0;

                for (const msg of rawMessages) {
                    const seenIndex = msg.id ? seenIndexes.get(msg.id) : undefined;
                    if (seenIndex !== undefined) {
                        duplicateCount++;
                        this.cache[seenIndex] = msg;
                        continue;
                    }
                    if (msg.id) {
                        seenIndexes.set(msg.id, this.cache.length);
                    }
                    this.cache.push(msg);
                }

                if (duplicateCount > 0) {
                    this.logger.warn(
                        `DatabaseHistoryProvider: Found ${duplicateCount} duplicate message updates for session ${this.sessionId}, deduped to ${this.cache.length}`
                    );
                } else {
                    this.logger.debug(
                        `DatabaseHistoryProvider: Loaded ${this.cache.length} messages for session ${this.sessionId}`
                    );
                }
            } catch (error) {
                this.logger.error(
                    `DatabaseHistoryProvider: Error loading messages for session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
                );
                throw SessionError.storageFailed(
                    this.sessionId,
                    'load history',
                    error instanceof Error ? error.message : String(error)
                );
            }
        }

        // Return a copy to prevent external mutation
        return [...this.cache];
    }

    async saveMessage(message: InternalMessage): Promise<void> {
        const key = this.getMessagesKey();

        // Ensure cache is initialized
        if (this.cache === null) {
            await this.getHistory();
        }

        // Check if message already exists in cache (prevent duplicates)
        if (message.id && this.cache!.some((m) => m.id === message.id)) {
            this.logger.debug(
                `DatabaseHistoryProvider: Message ${message.id} already exists, skipping`
            );
            return;
        }

        // Update cache
        this.cache!.push(message);

        // Write to DB immediately - new messages must be durable
        try {
            await this.database.append(key, message);

            this.logger.debug(
                `DatabaseHistoryProvider: Saved message ${message.id} (${message.role}) for session ${this.sessionId}`
            );
        } catch (error) {
            // Remove from cache on failure to keep in sync
            this.cache!.pop();
            this.logger.error(
                `DatabaseHistoryProvider: Error saving message for session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw SessionError.storageFailed(
                this.sessionId,
                'save message',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    async updateMessage(message: InternalMessage): Promise<void> {
        // Guard against undefined id
        if (!message.id) {
            this.logger.warn(
                `DatabaseHistoryProvider: Ignoring update for message without id in session ${this.sessionId}`
            );
            return;
        }

        // Ensure cache is initialized
        if (this.cache === null) {
            await this.getHistory();
        }

        // Update cache immediately (fast, in-memory)
        const cache = this.cache;
        if (cache === null) {
            return;
        }
        const index = cache.findIndex((m) => m.id === message.id);
        if (index !== -1) {
            cache[index] = message;
            this.pendingUpdates.set(message.id, message);
            this.scheduleFlush();

            this.logger.debug(
                `DatabaseHistoryProvider: Updated message ${message.id} in cache for session ${this.sessionId}`
            );
        } else {
            this.logger.warn(
                `DatabaseHistoryProvider: Message ${message.id} not found for update in session ${this.sessionId}`
            );
        }
    }

    async clearHistory(): Promise<void> {
        // Cancel any pending flush
        this.cancelPendingFlush();

        // Clear cache
        this.cache = [];
        this.pendingUpdates.clear();

        // Clear DB
        const key = this.getMessagesKey();
        try {
            await this.database.delete(key);
            this.logger.debug(
                `DatabaseHistoryProvider: Cleared history for session ${this.sessionId}`
            );
        } catch (error) {
            this.logger.error(
                `DatabaseHistoryProvider: Error clearing session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw SessionError.resetFailed(
                this.sessionId,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    async flush(): Promise<void> {
        if (this.flushPromise) {
            await this.flushPromise;
        }

        this.cancelPendingFlush();

        // Drain updates that arrive while flushPendingUpdates() awaits.
        while (this.pendingUpdates.size > 0) {
            this.flushPromise = this.flushPendingUpdates();
            try {
                await this.flushPromise;
            } finally {
                this.flushPromise = null;
            }
        }
    }

    private async flushPendingUpdates(): Promise<void> {
        const key = this.getMessagesKey();
        const updates = [...this.pendingUpdates.values()];
        this.pendingUpdates.clear();

        this.logger.debug(
            `DatabaseHistoryProvider: FLUSH UPDATES key=${key} count=${updates.length} ids=[${updates.map((m) => m.id).join(',')}]`
        );

        let failedIndex = updates.length;
        try {
            for (const [index, message] of updates.entries()) {
                failedIndex = index;
                await this.database.append(key, message);
            }
        } catch (error) {
            for (const message of updates.slice(failedIndex)) {
                if (message.id && !this.pendingUpdates.has(message.id)) {
                    this.pendingUpdates.set(message.id, message);
                }
            }
            this.logger.error(
                `DatabaseHistoryProvider: Error flushing message updates for session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw SessionError.storageFailed(
                this.sessionId,
                'flush message updates',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    private scheduleFlush(): void {
        if (this.flushTimer) {
            return;
        }

        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flush().catch(() => {
                // Error already logged in flushPendingUpdates.
            });
        }, DatabaseHistoryProvider.FLUSH_DELAY_MS);
    }

    private cancelPendingFlush(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
    }

    private getMessagesKey(): string {
        return `messages:${this.sessionId}`;
    }
}
