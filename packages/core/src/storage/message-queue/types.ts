import type { QueuedMessage } from '../../session/types.js';

export interface SessionMessageQueueStore {
    listSessionIds(): Promise<string[]>;
    load(input: { sessionId: string }): Promise<QueuedMessage[]>;
    save(input: { sessionId: string; queue: QueuedMessage[] }): Promise<void>;
    delete(input: { sessionId: string }): Promise<void>;
}
