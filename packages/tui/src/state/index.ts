/**
 * State management module exports
 *
 * Note: State is now managed via useState hooks in InkCLIRefactored.
 * This module exports types and remaining actions for UI/overlay state.
 */

// Types
export type {
    StartupInfo,
    Message,
    StreamingMessage,
    InputState,
    PendingImage,
    OverlayType,
    McpWizardServerType,
    UIState,
    SessionState,
    CLIState,
} from './types.js';

// Actions (reduced set - UI/overlay/session only, no message/streaming actions)
export type {
    InputChangeAction,
    InputClearAction,
    InputHistoryNavigateAction,
    InputHistoryResetAction,
    InputHistoryAddAction,
    ImageAddAction,
    ImageRemoveAction,
    ImagesClearAction,
    CancelStartAction,
    ThinkingStartAction,
    ThinkingEndAction,
    ProcessingStartAction,
    ProcessingEndAction,
    ShowOverlayAction,
    CloseOverlayAction,
    SetMcpWizardServerTypeAction,
    SessionSetAction,
    SessionClearAction,
    ModelUpdateAction,
    ConversationResetAction,
    ApprovalRequestAction,
    ApprovalCompleteAction,
    ExitWarningShowAction,
    ExitWarningClearAction,
    CopyModeEnableAction,
    CopyModeDisableAction,
    CLIAction,
} from './actions.js';

// Initial state (for types reference only)
export { createInitialState } from './initialState.js';
