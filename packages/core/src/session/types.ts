import { ContentPart } from '../context/types.js';

export interface QueuedMessage {
    id: string;
    content: ContentPart[];
    queuedAt: number;
    metadata?: Record<string, unknown>;
    kind?: 'default' | 'background';
}

export interface CoalescedMessage {
    messages: QueuedMessage[];
    combinedContent: ContentPart[];
    firstQueuedAt: number;
    lastQueuedAt: number;
}
