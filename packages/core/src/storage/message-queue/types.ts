import type { QueuedMessage } from '../../session/types.js';

export interface SessionMessageQueueStore {
    list(input: { sessionId: string }): Promise<QueuedMessage[]>;
    append(input: { sessionId: string; message: QueuedMessage }): Promise<{ position: number }>;
    takeAll(input: { sessionId: string }): Promise<QueuedMessage[]>;
    remove(input: { sessionId: string; id: string }): Promise<boolean>;
    clear(input: { sessionId: string }): Promise<void>;
}
