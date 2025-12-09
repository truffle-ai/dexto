import { MessageContentPart } from '../context/types.js';

export interface QueuedMessage {
    id: string;
    content: MessageContentPart[];
    queuedAt: number;
    metadata?: Record<string, unknown>;
}

export interface CoalescedMessage {
    messages: QueuedMessage[];
    combinedContent: MessageContentPart[];
    firstQueuedAt: number;
    lastQueuedAt: number;
}
