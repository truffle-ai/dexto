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
    saveMessage(input: { sessionId: string; message: InternalMessage }): Promise<void>;
    updateMessage(input: { sessionId: string; message: InternalMessage }): Promise<void>;
    clearMessages(input: { sessionId: string }): Promise<void>;
    flush(input: { sessionId: string }): Promise<void>;
}
