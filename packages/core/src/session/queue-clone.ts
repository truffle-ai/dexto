import { cloneContentParts } from '../context/content-clone.js';
import type { CoalescedMessage, QueuedMessage } from './types.js';

export function cloneQueuedMessage(message: QueuedMessage): QueuedMessage {
    return {
        ...message,
        content: cloneContentParts(message.content),
        ...(message.metadata !== undefined ? { metadata: structuredClone(message.metadata) } : {}),
    };
}

export function cloneQueuedMessages(messages: QueuedMessage[]): QueuedMessage[] {
    return messages.map(cloneQueuedMessage);
}

export function cloneCoalescedMessage(message: CoalescedMessage): CoalescedMessage {
    return {
        messages: cloneQueuedMessages(message.messages),
        combinedContent: cloneContentParts(message.combinedContent),
        firstQueuedAt: message.firstQueuedAt,
        lastQueuedAt: message.lastQueuedAt,
    };
}
