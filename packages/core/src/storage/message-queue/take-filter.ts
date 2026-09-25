import type { QueuedMessage } from '../../session/types.js';

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
