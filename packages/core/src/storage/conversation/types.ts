import type { InternalMessage, ToolMessage } from '../../context/types.js';

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
    /**
     * The stored messages with these ids, as `listMessages` would return them, in history order.
     * Ids with no stored message are left out. Optional: when a store omits it, core picks the
     * messages from `listMessages`. Implement it when the store can read a few messages without
     * loading the whole session.
     */
    getMessagesById?(input: {
        sessionId: string;
        messageIds: readonly string[];
    }): Promise<InternalMessage[]>;
    /**
     * Every stored tool result answering one of these tool call ids, as `listMessages` would
     * return it, in history order. Optional, with the same `listMessages` fallback as
     * `getMessagesById`.
     */
    getToolResultsByCallId?(input: {
        sessionId: string;
        toolCallIds: readonly string[];
    }): Promise<ToolMessage[]>;
    saveMessage(input: { sessionId: string; message: InternalMessage }): Promise<void>;
    updateMessage(input: { sessionId: string; message: InternalMessage }): Promise<void>;
    clearMessages(input: { sessionId: string }): Promise<void>;
    flush(input: { sessionId: string }): Promise<void>;
}
