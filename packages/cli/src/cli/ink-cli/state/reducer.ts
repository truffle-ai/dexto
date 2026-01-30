/**
 * State reducer for CLI state machine
 * Pure function that handles all state transitions
 *
 * Note: Message/streaming state is handled separately via useState in InkCLIRefactored
 * to simplify the reducer and match WebUI's direct event handling pattern.
 */

import type { CLIState } from './types.js';
import type { CLIAction } from './actions.js';

/**
 * Main CLI state reducer
 * Handles all state transitions in a predictable, testable way
 */
export function cliReducer(state: CLIState, action: CLIAction): CLIState {
    switch (action.type) {
        // Input actions
        case 'INPUT_CHANGE':
            return {
                ...state,
                input: {
                    ...state.input,
                    value: action.value,
                },
                // Clear exit warning when user starts typing
                ui: state.ui.exitWarningShown
                    ? {
                          ...state.ui,
                          exitWarningShown: false,
                          exitWarningTimestamp: null,
                      }
                    : state.ui,
            };

        case 'INPUT_CLEAR':
            return {
                ...state,
                input: {
                    ...state.input,
                    value: '',
                    historyIndex: -1,
                },
            };

        case 'INPUT_HISTORY_NAVIGATE': {
            const { history } = state.input;
            if (history.length === 0) return state;

            let newIndex = state.input.historyIndex;
            if (action.direction === 'up') {
                // Navigate backward through history (older items)
                // From -1 (current input) -> last history item -> ... -> first history item
                if (newIndex < 0) {
                    newIndex = history.length - 1; // Start at most recent
                } else if (newIndex > 0) {
                    newIndex = newIndex - 1; // Go to older
                }
                // If at 0, stay there (oldest item)
            } else {
                // Navigate forward through history (newer items)
                // From first history item -> ... -> last history item -> current input (-1)
                if (newIndex >= 0 && newIndex < history.length - 1) {
                    newIndex = newIndex + 1; // Go to newer
                } else if (newIndex === history.length - 1) {
                    // At most recent history, go back to current input
                    return {
                        ...state,
                        input: {
                            ...state.input,
                            value: '',
                            historyIndex: -1,
                        },
                    };
                }
                // If at -1, stay there (no change needed)
                if (newIndex < 0) return state;
            }

            const historyItem = history[newIndex];
            return {
                ...state,
                input: {
                    ...state.input,
                    value: historyItem || '',
                    historyIndex: newIndex,
                },
            };
        }

        case 'INPUT_HISTORY_RESET':
            return {
                ...state,
                input: {
                    ...state.input,
                    historyIndex: -1,
                },
            };

        case 'INPUT_HISTORY_ADD': {
            // Add to history if not duplicate of last entry
            const { history } = state.input;
            if (
                !action.value ||
                (history.length > 0 && history[history.length - 1] === action.value)
            ) {
                return state;
            }
            return {
                ...state,
                input: {
                    ...state.input,
                    history: [...history, action.value].slice(-100), // Keep last 100
                    historyIndex: -1,
                },
            };
        }

        // Image actions
        case 'IMAGE_ADD':
            return {
                ...state,
                input: {
                    ...state.input,
                    images: [...state.input.images, action.image],
                },
            };

        case 'IMAGE_REMOVE':
            return {
                ...state,
                input: {
                    ...state.input,
                    images: state.input.images.filter((img) => img.id !== action.imageId),
                },
            };

        case 'IMAGES_CLEAR':
            return {
                ...state,
                input: {
                    ...state.input,
                    images: [],
                },
            };

        case 'CANCEL_START':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    isProcessing: false,
                    isCancelling: true,
                },
            };

        case 'THINKING_START':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    isThinking: true,
                },
            };

        case 'THINKING_END':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    isThinking: false,
                },
            };

        // UI actions
        case 'PROCESSING_START':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    isProcessing: true,
                    isCancelling: false, // Clear cancellation flag for new request
                    activeOverlay: 'none',
                    exitWarningShown: false, // Clear exit warning on new submission
                    exitWarningTimestamp: null,
                },
            };

        case 'PROCESSING_END':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    isProcessing: false,
                    isCancelling: false,
                    isThinking: false, // Clear thinking state when processing ends
                },
            };

        case 'SHOW_OVERLAY':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    activeOverlay: action.overlay,
                },
            };

        case 'CLOSE_OVERLAY':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    activeOverlay: 'none',
                    mcpWizardServerType: null, // Clear wizard state when closing overlay
                },
            };

        case 'SET_MCP_WIZARD_SERVER_TYPE':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    mcpWizardServerType: action.serverType,
                },
            };

        // Session actions
        case 'SESSION_SET':
            return {
                ...state,
                session: {
                    ...state.session,
                    id: action.sessionId,
                    hasActiveSession: action.hasActiveSession,
                },
            };

        case 'SESSION_CLEAR':
            return {
                ...state,
                session: {
                    ...state.session,
                    id: null,
                    hasActiveSession: false,
                },
                approval: null,
                approvalQueue: [],
                ui: {
                    ...state.ui,
                    activeOverlay: 'none',
                },
            };

        case 'MODEL_UPDATE':
            return {
                ...state,
                session: {
                    ...state.session,
                    modelName: action.modelName,
                },
            };

        case 'CONVERSATION_RESET':
            return {
                ...state,
                approval: null,
                approvalQueue: [],
                ui: {
                    ...state.ui,
                    activeOverlay: 'none',
                },
            };

        // Approval actions
        case 'APPROVAL_REQUEST':
            // Dedupe: skip if this approval ID is already pending or queued
            if (state.approval?.approvalId === action.approval.approvalId) {
                return state;
            }
            if (state.approvalQueue.some((r) => r.approvalId === action.approval.approvalId)) {
                return state;
            }
            // If there's already a pending approval, queue this one
            if (state.approval !== null) {
                return {
                    ...state,
                    approvalQueue: [...state.approvalQueue, action.approval],
                };
            }
            // Otherwise, show it immediately
            return {
                ...state,
                approval: action.approval,
                ui: {
                    ...state.ui,
                    activeOverlay: 'approval',
                },
            };

        case 'APPROVAL_COMPLETE':
            // Check if there are queued approvals
            if (state.approvalQueue.length > 0) {
                // Show the next approval from the queue
                const nextApproval = state.approvalQueue[0]!;
                const remainingQueue = state.approvalQueue.slice(1);
                return {
                    ...state,
                    approval: nextApproval,
                    approvalQueue: remainingQueue,
                    ui: {
                        ...state.ui,
                        activeOverlay: 'approval',
                    },
                };
            }
            // No more approvals, clear everything
            return {
                ...state,
                approval: null,
                ui: {
                    ...state.ui,
                    activeOverlay: 'none',
                },
            };

        // Exit warning actions (for double Ctrl+C to exit)
        case 'EXIT_WARNING_SHOW':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    exitWarningShown: true,
                    exitWarningTimestamp: Date.now(),
                },
            };

        case 'EXIT_WARNING_CLEAR':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    exitWarningShown: false,
                    exitWarningTimestamp: null,
                },
            };

        // Copy mode actions (for text selection in alternate buffer)
        case 'COPY_MODE_ENABLE':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    copyModeEnabled: true,
                },
            };

        case 'COPY_MODE_DISABLE':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    copyModeEnabled: false,
                },
            };

        default:
            return state;
    }
}
