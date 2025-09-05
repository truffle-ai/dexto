import type { InternalMessage } from '@core/context/types.js';

/**
 * Session-scoped conversation history provider.
 * Each instance is tied to a specific session and manages only that session's messages.
 */
export interface IConversationHistoryProvider {
    /** Load the full message history for this session */
    getHistory(): Promise<InternalMessage[]>;

    /** Append a message to this session's history */
    saveMessage(message: InternalMessage): Promise<void>;

    /** Clear all messages for this session */
    clearHistory(): Promise<void>;
}
