/**
 * Mouse Scroll Hook
 * Enables trackpad/mouse scroll support for VirtualizedList
 *
 * This hook only enables/disables mouse events on the terminal.
 * Actual mouse event parsing happens in useInputOrchestrator to avoid
 * stdin listener conflicts with Ink's useInput.
 */

import { useEffect } from 'react';
import { enableMouseEvents, disableMouseEvents } from '../utils/mouse.js';

export interface UseMouseScrollOptions {
    /** Whether mouse scroll is enabled */
    isActive?: boolean;
}

/**
 * Hook that enables mouse events on the terminal
 *
 * Note: Mouse event PARSING is done in useInputOrchestrator.
 * This hook only sends the terminal escape codes to enable/disable mouse reporting.
 */
export function useMouseScroll({ isActive = true }: UseMouseScrollOptions): void {
    useEffect(() => {
        if (!isActive) {
            return;
        }

        // Enable mouse events in the terminal
        enableMouseEvents();

        return () => {
            // Disable mouse events when unmounting
            disableMouseEvents();
        };
    }, [isActive]);
}
