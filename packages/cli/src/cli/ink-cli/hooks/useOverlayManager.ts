/**
 * Hook for managing overlay state
 * Provides helpers for showing/hiding overlays
 */

import { useCallback } from 'react';
import type { CLIAction } from '../state/actions.js';
import type { OverlayType } from '../state/types.js';

interface UseOverlayManagerProps {
    dispatch: React.Dispatch<CLIAction>;
}

interface UseOverlayManagerReturn {
    showOverlay: (overlay: OverlayType) => void;
    closeOverlay: () => void;
}

/**
 * Manages overlay visibility state
 */
export function useOverlayManager({ dispatch }: UseOverlayManagerProps): UseOverlayManagerReturn {
    const showOverlay = useCallback(
        (overlay: OverlayType) => {
            dispatch({
                type: 'SHOW_OVERLAY',
                overlay,
            });
        },
        [dispatch]
    );

    const closeOverlay = useCallback(() => {
        dispatch({
            type: 'CLOSE_OVERLAY',
        });
    }, [dispatch]);

    return {
        showOverlay,
        closeOverlay,
    };
}
