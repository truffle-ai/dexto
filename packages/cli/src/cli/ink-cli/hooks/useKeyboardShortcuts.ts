/**
 * Hook for global keyboard shortcuts
 * Handles shortcuts like Ctrl+C, Escape, etc.
 */

import type React from 'react';
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
                if (state.ui.isProcessing && state.session.id) {
                    void agent.cancel(state.session.id).catch(() => {});
                    dispatch({ type: 'CANCEL_START' });
                    dispatch({ type: 'STREAMING_CANCEL' });
                } else if (!state.ui.isProcessing) {
                    exit();
                }
            }

            // Escape: Cancel or close
            if (key.escape) {
                if (state.ui.isProcessing && state.session.id) {
                    void agent.cancel(state.session.id).catch(() => {});
                    dispatch({ type: 'CANCEL_START' });
                    dispatch({ type: 'STREAMING_CANCEL' });
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
