/**
 * Hook for global keyboard shortcuts
 * Handles shortcuts like Ctrl+C, Escape, etc.
 */

import { useInput, useApp } from 'ink';
import type { DextoAgent } from '@dexto/core';
import type { CLIAction } from '../state/actions.js';
import type { CLIState } from '../state/types.js';

interface UseKeyboardShortcutsProps {
    state: CLIState;
    dispatch: React.Dispatch<CLIAction>;
    agent: DextoAgent;
}

/**
 * Manages global keyboard shortcuts
 */
export function useKeyboardShortcuts({ state, dispatch, agent }: UseKeyboardShortcutsProps): void {
    const { exit } = useApp();

    useInput(
        (inputChar, key) => {
            // Don't intercept if approval prompt is active
            if (state.approval) {
                return;
            }

            // Don't intercept if autocomplete/selector is active (they handle their own keys)
            if (state.ui.activeOverlay !== 'none' && state.ui.activeOverlay !== 'approval') {
                return;
            }

            // Ctrl+C: Cancel or exit
            if (key.ctrl && inputChar === 'c') {
                if (state.ui.isProcessing) {
                    void agent.cancel().catch(() => {});
                    dispatch({ type: 'STREAMING_CANCEL' });
                    dispatch({ type: 'PROCESSING_END' });
                } else {
                    exit();
                }
            }

            // Escape: Cancel or close
            if (key.escape) {
                if (state.ui.isProcessing) {
                    void agent.cancel().catch(() => {});
                    dispatch({ type: 'STREAMING_CANCEL' });
                    dispatch({ type: 'PROCESSING_END' });
                } else if (state.ui.activeOverlay !== 'none') {
                    dispatch({ type: 'CLOSE_OVERLAY' });
                }
            }
        },
        {
            isActive: !state.ui.isProcessing || state.ui.activeOverlay === 'none',
        }
    );
}
