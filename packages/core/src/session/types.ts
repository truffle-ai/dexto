import { TextPart, ImagePart, FilePart, UIResourcePart } from '../context/types.js';

export type UserMessageContentPart = TextPart | ImagePart | FilePart | UIResourcePart;

export interface QueuedMessage {
    id: string;
    content: UserMessageContentPart[];
    queuedAt: number;
    metadata?: Record<string, unknown>;
}

export interface CoalescedMessage {
    messages: QueuedMessage[];
    combinedContent: UserMessageContentPart[];
    firstQueuedAt: number;
    lastQueuedAt: number;
}
