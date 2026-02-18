import type { InternalMessage } from '../../context/types.js';

/**
 * Session-scoped conversation history provider.
 * Each instance is tied to a specific session and manages only that session's messages.
 *
 * Implementations may use caching to optimize read performance. If caching is used,
 * the flush() method should be called at turn boundaries to ensure all updates
 * are persisted to durable storage.
 */
export type ConversationHistoryProvider = {
    /** Load the full message history for this session */
    getHistory(): Promise<InternalMessage[]>;

    /** Append a message to this session's history (must be durable immediately) */
    saveMessage(message: InternalMessage): Promise<void>;

    /** Update an existing message in this session's history (may be cached/batched) */
    updateMessage(message: InternalMessage): Promise<void>;

    /** Clear all messages for this session */
    clearHistory(): Promise<void>;

    /**
     * Flush any pending updates to durable storage.
     * Called at turn boundaries to ensure data durability.
     * Implementations without caching can make this a no-op.
     */
    flush(): Promise<void>;
};
