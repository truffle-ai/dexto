/**
 * Initial state for CLI state machine
 */

import type { CLIState } from './types.js';

/**
 * Creates the initial CLI state
 */
export function createInitialState(): CLIState {
    return {
        messages: [],
        streamingMessage: null,
        input: {
            value: '',
            history: [],
            historyIndex: -1,
            remountKey: 0,
        },
        ui: {
            isProcessing: false,
            activeOverlay: 'none',
        },
        session: {
            id: null,
            hasActiveSession: false,
        },
        approval: null,
    };
}
