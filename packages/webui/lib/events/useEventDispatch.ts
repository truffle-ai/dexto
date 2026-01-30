/**
 * Event Dispatch Hook
 *
 * Provides a hook for components to dispatch SSE events to the event bus.
 * Use this when receiving events from the message stream or other SSE sources.
 */

import { useCallback } from 'react';
import type { StreamingEvent } from '@dexto/core';
import { useEventBus } from '@/components/providers/EventBusProvider.js';

/**
 * Hook to dispatch SSE events to the event bus
 *
 * @returns Object with dispatchEvent function
 *
 * @example
 * ```tsx
 * function MessageStream() {
 *   const { dispatchEvent } = useEventDispatch();
 *
 *   useEffect(() => {
 *     const eventSource = createMessageStream(responsePromise);
 *     for await (const event of eventSource) {
 *       dispatchEvent(event); // Dispatches to event bus
 *     }
 *   }, [dispatchEvent]);
 * }
 * ```
 */
export function useEventDispatch() {
    const bus = useEventBus();

    const dispatchEvent = useCallback(
        (event: StreamingEvent) => {
            bus.dispatch(event);
        },
        [bus]
    );

    return { dispatchEvent };
}
