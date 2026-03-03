/**
 * useKeypress Hook
 *
 * Subscribe to keyboard events from the KeypressProvider.
 * This replaces Ink's useInput hook.
 */

import { useEffect } from 'react';
import type { KeypressHandler, Key } from '../contexts/KeypressContext.js';
import { useKeypressContext } from '../contexts/KeypressContext.js';

export type { Key };

/**
 * Hook to subscribe to keypress events.
 *
 * @param onKeypress - Callback for each keypress
 * @param options.isActive - Whether to listen for input
 */
export function useKeypress(onKeypress: KeypressHandler, { isActive }: { isActive: boolean }) {
    const { subscribe, unsubscribe } = useKeypressContext();

    useEffect(() => {
        if (!isActive) {
            return;
        }

        subscribe(onKeypress);
        return () => {
            unsubscribe(onKeypress);
        };
    }, [isActive, onKeypress, subscribe, unsubscribe]);
}
