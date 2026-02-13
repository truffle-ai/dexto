import type { InternalMessage } from '../../context/types.js';
import type { IConversationHistoryProvider } from './types.js';
import type { Logger } from '../../logger/v2/types.js';

/**
 * Lightweight in-memory history provider for ephemeral, isolated LLM calls.
 * Used to run background tasks (e.g., title generation) without touching
 * the real session history or emitting history-related side effects.
 */
export class MemoryHistoryProvider implements IConversationHistoryProvider {
    private messages: InternalMessage[] = [];

    constructor(private logger: Logger) {}

    async getHistory(): Promise<InternalMessage[]> {
        // Return a shallow copy to prevent external mutation
        return [...this.messages];
    }

    async saveMessage(message: InternalMessage): Promise<void> {
        this.messages.push(message);
    }

    async updateMessage(message: InternalMessage): Promise<void> {
        // Guard against undefined id - could match another message with undefined id
        if (!message.id) {
            this.logger.warn('MemoryHistoryProvider: Ignoring update for message without id');
            return;
        }
        const index = this.messages.findIndex((m) => m.id === message.id);
        if (index !== -1) {
            this.messages[index] = message;
        }
    }

    async clearHistory(): Promise<void> {
        this.messages = [];
    }

    /**
     * No-op for in-memory provider - all operations are already "flushed".
     */
    async flush(): Promise<void> {
        // Nothing to flush - memory provider is always in sync
    }
}
