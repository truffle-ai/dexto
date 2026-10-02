import type { QueuedMessage, RestoredPendingInput } from '@dexto/core';

export const EMPTY_RESTORED_PENDING_INPUT: RestoredPendingInput = { steer: [], followUp: [] };

/**
 * Ids of the restored entries currently on hold. Used to keep them out of the live
 * current-turn / follow-up lists, which render the same ids after a queue sync.
 */
export function restoredPendingInputIds(pending: RestoredPendingInput): Set<string> {
    return new Set([...pending.steer, ...pending.followUp].map((message) => message.id));
}

export function withoutRestoredPendingInput(
    messages: QueuedMessage[],
    pending: RestoredPendingInput
): QueuedMessage[] {
    const heldIds = restoredPendingInputIds(pending);
    if (heldIds.size === 0) {
        return messages;
    }
    return messages.filter((message) => !heldIds.has(message.id));
}
