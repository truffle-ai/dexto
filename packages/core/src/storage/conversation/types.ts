import type { InternalMessage } from '../../context/types.js';

export type ModelHistoryLoadStats = {
    returnedMessages: number;
    skippedPreSummaryMessages: number;
    summaryMessageId: string | null;
};

export type ModelHistoryLoad = {
    messages: InternalMessage[];
    stats: ModelHistoryLoadStats;
};

export interface ConversationStore {
    listMessages(input: { sessionId: string }): Promise<InternalMessage[]>;
    loadModelHistory(input: { sessionId: string }): Promise<ModelHistoryLoad>;
    /**
     * Number of messages `loadModelHistory` would return, without loading them. Optional: when a
     * store omits it, core derives the count from `loadModelHistory`. Implement it when the store
     * can count without reading or parsing the messages.
     */
    countModelMessages?(input: { sessionId: string }): Promise<number>;
    saveMessage(input: { sessionId: string; message: InternalMessage }): Promise<void>;
    updateMessage(input: { sessionId: string; message: InternalMessage }): Promise<void>;
    clearMessages(input: { sessionId: string }): Promise<void>;
    flush(input: { sessionId: string }): Promise<void>;
}
