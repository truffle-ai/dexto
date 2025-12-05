import type { IDextoLogger } from '@core/logger/v2/types.js';
import { DextoLogComponent } from '@core/logger/v2/types.js';
import type { Database } from '@core/storage/types.js';
import { SessionError } from '../errors.js';
import type { InternalMessage } from '@core/context/types.js';
import type { IConversationHistoryProvider } from './types.js';

/**
 * History provider that works directly with DatabaseBackend.
 * Uses write-through caching for read performance while maintaining durability.
 *
 * Caching strategy:
 * - getHistory(): Returns cached messages after first load (eliminates repeated DB reads)
 * - saveMessage(): Updates cache AND writes to DB immediately (new messages are critical)
 * - updateMessage(): Updates cache immediately, debounces DB writes (batches rapid updates)
 * - flush(): Forces all pending updates to DB (called at turn boundaries)
 * - clearHistory(): Clears cache and DB immediately
 *
 * Durability guarantees:
 * - New messages (saveMessage) are always immediately durable
 * - Updates (updateMessage) are durable within flush interval or on explicit flush()
 * - Worst case on crash: lose updates from last flush interval (typically <100ms)
 */
export class DatabaseHistoryProvider implements IConversationHistoryProvider {
    private logger: IDextoLogger;

    // Cache state
    private cache: InternalMessage[] | null = null;
    private dirty = false;
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private flushPromise: Promise<void> | null = null;

    // Flush configuration
    private static readonly FLUSH_DELAY_MS = 100; // Debounce window for batching updates

    constructor(
        private sessionId: string,
        private database: Database,
        logger: IDextoLogger
    ) {
        this.logger = logger.createChild(DextoLogComponent.SESSION);
    }

    async getHistory(): Promise<InternalMessage[]> {
        // Load from DB on first access
        if (this.cache === null) {
            const key = this.getMessagesKey();
            try {
                this.cache = await this.database.getRange<InternalMessage>(key, 0, 10000);
                this.logger.debug(
                    `DatabaseHistoryProvider: Loaded ${this.cache.length} messages from DB for session ${this.sessionId}`
                );
            } catch (error) {
                // TODO: Consider propagating this error instead of silently falling back to empty history.
                // Silent failure could mask transient DB issues and lead to data loss if subsequent
                // writes overwrite the actual history. For now, log error and fall back for resilience.
                this.logger.error(
                    `DatabaseHistoryProvider: Error loading messages for session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
                );
                this.cache = [];
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

        // Update cache
        this.cache!.push(message);

        // Write to DB immediately - new messages must be durable
        try {
            await this.database.append(key, message);

            this.logger.debug(
                `DatabaseHistoryProvider: Saved message for session ${this.sessionId}`,
                {
                    role: message.role,
                    id: message.id,
                }
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
        const index = this.cache!.findIndex((m) => m.id === message.id);
        if (index !== -1) {
            this.cache![index] = message;
            this.dirty = true;

            // Schedule debounced flush
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
        this.dirty = false;

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

    /**
     * Flush any pending updates to the database.
     * Should be called at turn boundaries to ensure durability.
     */
    async flush(): Promise<void> {
        // If a flush is already in progress, wait for it
        if (this.flushPromise) {
            await this.flushPromise;
            return;
        }

        // Cancel any scheduled flush since we're flushing now
        this.cancelPendingFlush();

        // Nothing to flush
        if (!this.dirty || !this.cache) {
            return;
        }

        // Perform the flush
        this.flushPromise = this.doFlush();
        try {
            await this.flushPromise;
        } finally {
            this.flushPromise = null;
        }
    }

    /**
     * Internal flush implementation.
     * Writes entire cache to DB (delete + re-append all).
     */
    private async doFlush(): Promise<void> {
        if (!this.dirty || !this.cache) {
            return;
        }

        const key = this.getMessagesKey();
        const messageCount = this.cache.length;

        try {
            // Atomic replace: delete all + re-append
            await this.database.delete(key);
            for (const msg of this.cache) {
                await this.database.append(key, msg);
            }

            // Only clear dirty if no new updates were scheduled during flush.
            // If flushTimer exists, updateMessage() was called during the flush,
            // so keep dirty=true to ensure the scheduled flush persists those updates.
            if (!this.flushTimer) {
                this.dirty = false;
            }
            this.logger.debug(
                `DatabaseHistoryProvider: Flushed ${messageCount} messages to DB for session ${this.sessionId}`
            );
        } catch (error) {
            this.logger.error(
                `DatabaseHistoryProvider: Error flushing messages for session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw SessionError.storageFailed(
                this.sessionId,
                'flush messages',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Schedule a debounced flush.
     * Batches rapid updateMessage() calls into a single DB write.
     */
    private scheduleFlush(): void {
        // Already scheduled
        if (this.flushTimer) {
            return;
        }

        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            // Fire and forget - errors are logged in doFlush
            this.doFlush().catch(() => {
                // Error already logged in doFlush
            });
        }, DatabaseHistoryProvider.FLUSH_DELAY_MS);
    }

    /**
     * Cancel any pending scheduled flush.
     */
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
