/**
 * State management module exports
 */

// Types
export type {
    StartupInfo,
    Message,
    StreamingMessage,
    InputState,
    OverlayType,
    UIState,
    SessionState,
    CLIState,
} from './types.js';

// Actions
export type {
    InputChangeAction,
    InputClearAction,
    InputHistoryNavigateAction,
    InputHistoryResetAction,
    MessageAddAction,
    MessageAddMultipleAction,
    MessageInsertBeforeStreamingAction,
    MessageUpdateAction,
    MessageRemoveAction,
    StreamingStartAction,
    StreamingChunkAction,
    StreamingEndAction,
    StreamingCancelAction,
    SubmitStartAction,
    SubmitCompleteAction,
    SubmitErrorAction,
    ProcessingStartAction,
    ProcessingEndAction,
    ShowOverlayAction,
    CloseOverlayAction,
    SessionSetAction,
    SessionClearAction,
    ModelUpdateAction,
    ConversationResetAction,
    ApprovalRequestAction,
    ApprovalCompleteAction,
    ErrorAction,
    CLIAction,
} from './actions.js';

// Reducer
export { cliReducer } from './reducer.js';

// Initial state
export { createInitialState } from './initialState.js';
