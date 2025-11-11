/**
 * State reducer for CLI state machine
 * Pure function that handles all state transitions
 */

import type { CLIState, Message } from './types.js';
import type { CLIAction } from './actions.js';
import { generateMessageId } from '../utils/idGenerator.js';

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
                    remountKey: action.forceRemount
                        ? state.input.remountKey + 1
                        : state.input.remountKey,
                },
            };

        case 'INPUT_CLEAR':
            return {
                ...state,
                input: {
                    ...state.input,
                    value: '',
                    historyIndex: -1,
                    remountKey: state.input.remountKey + 1,
                    isMultiLine: false, // Reset to single-line on clear
                },
            };

        case 'INPUT_HISTORY_NAVIGATE': {
            const { history } = state.input;
            if (history.length === 0) return state;

            let newIndex = state.input.historyIndex;
            if (action.direction === 'up') {
                newIndex = newIndex < 0 ? history.length - 1 : Math.max(0, newIndex - 1);
            } else {
                newIndex = newIndex + 1;
            }

            // If we've gone past the end, clear input
            if (newIndex >= history.length) {
                return {
                    ...state,
                    input: {
                        ...state.input,
                        value: '',
                        historyIndex: -1,
                    },
                };
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

        case 'INPUT_TOGGLE_MULTILINE':
            return {
                ...state,
                input: {
                    ...state.input,
                    isMultiLine: !state.input.isMultiLine,
                    remountKey: state.input.remountKey + 1,
                },
            };

        // Message actions
        case 'MESSAGE_ADD':
            return {
                ...state,
                messages: [...state.messages, action.message],
            };

        case 'MESSAGE_ADD_MULTIPLE':
            return {
                ...state,
                messages: [...state.messages, ...action.messages],
            };

        case 'MESSAGE_INSERT_BEFORE_STREAMING': {
            // Insert message before the streaming message (for tool calls)
            if (!state.streamingMessage) {
                // No streaming message, just append
                return {
                    ...state,
                    messages: [...state.messages, action.message],
                };
            }

            // Find streaming message and insert before it
            const streamingIndex = state.messages.findIndex(
                (msg) => msg.id === state.streamingMessage?.id
            );

            if (streamingIndex === -1) {
                // Streaming message not found, append
                return {
                    ...state,
                    messages: [...state.messages, action.message],
                };
            }

            // Insert before streaming message
            const newMessages = [
                ...state.messages.slice(0, streamingIndex),
                action.message,
                ...state.messages.slice(streamingIndex),
            ];

            return {
                ...state,
                messages: newMessages,
            };
        }

        case 'MESSAGE_UPDATE':
            return {
                ...state,
                messages: state.messages.map((msg) =>
                    msg.id === action.id ? { ...msg, ...action.update } : msg
                ),
            };

        case 'MESSAGE_REMOVE':
            return {
                ...state,
                messages: state.messages.filter((msg) => msg.id !== action.id),
            };

        // Streaming actions
        case 'STREAMING_START': {
            const streamingMessage: Message = {
                id: action.id,
                role: 'assistant',
                content: '',
                timestamp: new Date(),
                isStreaming: true,
            };
            return {
                ...state,
                messages: [...state.messages, streamingMessage],
                streamingMessage: {
                    id: action.id,
                    content: '',
                },
            };
        }

        case 'STREAMING_CHUNK': {
            if (!state.streamingMessage) return state;

            const newContent = state.streamingMessage.content + action.content;
            return {
                ...state,
                streamingMessage: {
                    ...state.streamingMessage,
                    content: newContent,
                },
                messages: state.messages.map((msg) =>
                    msg.id === state.streamingMessage?.id
                        ? { ...msg, content: newContent, isStreaming: true }
                        : msg
                ),
            };
        }

        case 'STREAMING_END': {
            if (!state.streamingMessage) return state;

            // Preserve accumulated content if action.content is empty
            const finalContent =
                action.content && action.content.length > 0
                    ? action.content
                    : state.streamingMessage.content;

            return {
                ...state,
                streamingMessage: null,
                messages: state.messages.map((msg) =>
                    msg.id === state.streamingMessage?.id
                        ? { ...msg, content: finalContent, isStreaming: false }
                        : msg
                ),
            };
        }

        case 'STREAMING_CANCEL': {
            const streamingId = state.streamingMessage?.id;
            return {
                ...state,
                streamingMessage: null,
                messages: streamingId
                    ? state.messages.filter((msg) => msg.id !== streamingId)
                    : state.messages,
            };
        }

        // Submission actions
        case 'SUBMIT_START': {
            // Add to history if not duplicate
            const newHistory =
                action.inputValue &&
                (state.input.history.length === 0 ||
                    state.input.history[state.input.history.length - 1] !== action.inputValue)
                    ? [...state.input.history, action.inputValue].slice(-100)
                    : state.input.history;

            return {
                ...state,
                messages: [...state.messages, action.userMessage],
                input: {
                    value: '',
                    history: newHistory,
                    historyIndex: -1,
                    remountKey: state.input.remountKey + 1,
                    isMultiLine: false, // Reset to single-line after submit
                },
                ui: {
                    ...state.ui,
                    isProcessing: true,
                    activeOverlay: 'none',
                },
            };
        }

        case 'SUBMIT_COMPLETE':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    isProcessing: false,
                },
            };

        case 'SUBMIT_ERROR': {
            const errorMessage: Message = {
                id: generateMessageId('error'),
                role: 'system',
                content: action.errorMessage,
                timestamp: new Date(),
            };
            return {
                ...state,
                messages: [...state.messages, errorMessage],
                ui: {
                    ...state.ui,
                    isProcessing: false,
                },
                streamingMessage: null,
            };
        }

        // UI actions
        case 'PROCESSING_START':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    isProcessing: true,
                },
            };

        case 'PROCESSING_END':
            return {
                ...state,
                ui: {
                    ...state.ui,
                    isProcessing: false,
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
                messages: [],
                session: {
                    ...state.session,
                    id: null,
                    hasActiveSession: false,
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
                messages: [],
                streamingMessage: null,
            };

        // Approval actions
        case 'APPROVAL_REQUEST':
            return {
                ...state,
                approval: action.approval,
                ui: {
                    ...state.ui,
                    activeOverlay: 'approval',
                },
            };

        case 'APPROVAL_COMPLETE':
            return {
                ...state,
                approval: null,
                ui: {
                    ...state.ui,
                    activeOverlay: 'none',
                },
            };

        // Error actions
        case 'ERROR': {
            const errorMessage: Message = {
                id: generateMessageId('error'),
                role: 'system',
                content: `❌ Error: ${action.errorMessage}`,
                timestamp: new Date(),
            };
            return {
                ...state,
                messages: [...state.messages, errorMessage],
                ui: {
                    ...state.ui,
                    isProcessing: false,
                },
                streamingMessage: null,
            };
        }

        default:
            return state;
    }
}
