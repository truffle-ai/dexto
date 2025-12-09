/**
 * Initial state for CLI state machine
 *
 * Note: Messages are handled separately via useState in InkCLIRefactored
 */

import type { CLIState } from './types.js';

/**
 * Creates the initial CLI state
 * @param initialModelName - Initial model name
 */
export function createInitialState(initialModelName: string = ''): CLIState {
    return {
        input: {
            value: '',
            history: [],
            historyIndex: -1,
            draftBeforeHistory: '',
            images: [],
        },
        ui: {
            isProcessing: false,
            isCancelling: false,
            isThinking: false,
            activeOverlay: 'none',
            exitWarningShown: false,
            exitWarningTimestamp: null,
            mcpWizardServerType: null,
            copyModeEnabled: false,
        },
        session: {
            id: null,
            hasActiveSession: false,
            modelName: initialModelName,
        },
        approval: null,
        approvalQueue: [],
    };
}
