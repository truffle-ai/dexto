import type { QueuedMessage } from '../../session/types.js';

export interface SessionMessageQueueStore {
    list(input: { sessionId: string }): Promise<QueuedMessage[]>;
    append(input: { sessionId: string; message: QueuedMessage }): Promise<{ position: number }>;
    /**
     * Atomically remove and return the queued messages for a session.
     * Messages whose ids are listed in `excludeIds` stay in the queue untouched.
     * When `onlyIds` is set, only messages whose ids it lists are taken.
     */
    takeAll(input: {
        sessionId: string;
        excludeIds?: readonly string[];
        onlyIds?: readonly string[];
    }): Promise<QueuedMessage[]>;
    /**
     * Atomically put messages back at the head of the queue, in the given order, in one
     * operation. Messages whose ids are already queued are skipped.
     */
    prepend(input: { sessionId: string; messages: readonly QueuedMessage[] }): Promise<void>;
    remove(input: { sessionId: string; id: string }): Promise<boolean>;
    clear(input: { sessionId: string }): Promise<void>;
}
