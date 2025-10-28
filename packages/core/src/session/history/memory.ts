import type { InternalMessage } from '@core/context/types.js';
import type { IConversationHistoryProvider } from './types.js';

/**
 * Lightweight in-memory history provider for ephemeral, isolated LLM calls.
 * Used to run background tasks (e.g., title generation) without touching
 * the real session history or emitting history-related side effects.
 */
export class MemoryHistoryProvider implements IConversationHistoryProvider {
    private messages: InternalMessage[] = [];

    async getHistory(): Promise<InternalMessage[]> {
        // Return a shallow copy to prevent external mutation
        return [...this.messages];
    }

    async saveMessage(message: InternalMessage): Promise<void> {
        this.messages.push(message);
    }

    async clearHistory(): Promise<void> {
        this.messages = [];
    }
}
