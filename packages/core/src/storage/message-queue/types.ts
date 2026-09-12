import type { QueuedMessage } from '../../session/types.js';

export interface SessionMessageQueueStore {
    list(input: { sessionId: string }): Promise<QueuedMessage[]>;
    append(input: { sessionId: string; message: QueuedMessage }): Promise<{ position: number }>;
    /**
     * Atomically remove and return the queued messages for a session.
     * Messages whose ids are listed in `excludeIds` stay in the queue untouched.
     */
    takeAll(input: { sessionId: string; excludeIds?: readonly string[] }): Promise<QueuedMessage[]>;
    remove(input: { sessionId: string; id: string }): Promise<boolean>;
    clear(input: { sessionId: string }): Promise<void>;
}
