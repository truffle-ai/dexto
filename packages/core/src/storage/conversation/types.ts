import type { InternalMessage } from '../../context/types.js';

export interface ConversationStore {
    listMessages(input: { sessionId: string }): Promise<InternalMessage[]>;
    saveMessage(input: { sessionId: string; message: InternalMessage }): Promise<void>;
    updateMessage(input: { sessionId: string; message: InternalMessage }): Promise<void>;
    clearMessages(input: { sessionId: string }): Promise<void>;
    flush(input: { sessionId: string }): Promise<void>;
}
