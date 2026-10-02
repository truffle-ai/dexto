import type { QueuedMessage } from '../../session/types.js';
import { cloneQueuedMessage } from '../../session/queue-clone.js';

/**
 * Selection shared by every `SessionMessageQueueStore.takeAll` implementation: a message is
 * taken when `onlyIds` (if set) lists it and `excludeIds` does not.
 */
export function createQueueTakeFilter(input: {
    excludeIds?: readonly string[] | undefined;
    onlyIds?: readonly string[] | undefined;
}): (message: QueuedMessage) => boolean {
    const excludeIds = new Set(input.excludeIds ?? []);
    const onlyIds = input.onlyIds ? new Set(input.onlyIds) : null;
    return (message) =>
        !excludeIds.has(message.id) && (onlyIds === null || onlyIds.has(message.id));
}

/**
 * Copies of `messages` whose ids are not already in `queue`, in order, keeping only the first
 * occurrence of an id repeated within `messages` (for `prepend`).
 */
export function selectMissingMessages(
    queue: readonly QueuedMessage[],
    messages: readonly QueuedMessage[]
): QueuedMessage[] {
    const present = new Set(queue.map((message) => message.id));
    const missing: QueuedMessage[] = [];
    for (const message of messages) {
        if (present.has(message.id)) continue;
        present.add(message.id);
        missing.push(cloneQueuedMessage(message));
    }
    return missing;
}
