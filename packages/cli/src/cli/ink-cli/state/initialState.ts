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
            pastedBlocks: [],
            pasteCounter: 0,
        },
        ui: {
            isProcessing: false,
            isCancelling: false,
            isThinking: false,
            isCompacting: false,
            activeOverlay: 'none',
            exitWarningShown: false,
            exitWarningTimestamp: null,
            mcpWizardServerType: null,
            copyModeEnabled: false,
            pendingModelSwitch: null,
            selectedMcpServer: null,
            historySearch: {
                isActive: false,
                query: '',
                matchIndex: 0,
                originalInput: '',
                lastMatch: '',
            },
            promptAddWizard: null,
            autoApproveEdits: false,
            todoExpanded: true,
            backgroundTasksRunning: 0,
            backgroundTasksExpanded: false,
            backgroundTasks: [],
            planModeActive: false,
            planModeInitialized: false,
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
