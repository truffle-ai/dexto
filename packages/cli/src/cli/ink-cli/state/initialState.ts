/**
 * Initial state for CLI state machine
 */

import type { CLIState, Message } from './types.js';

/**
 * Creates the initial CLI state
 * @param initialMessages - Optional messages to populate the state with (e.g., startup info)
 * @param initialModelName - Initial model name
 */
export function createInitialState(
    initialMessages: Message[] = [],
    initialModelName: string = ''
): CLIState {
    return {
        messages: initialMessages,
        streamingMessage: null,
        input: {
            value: '',
            history: [],
            historyIndex: -1,
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
