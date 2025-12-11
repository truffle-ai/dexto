/**
 * State actions for CLI state machine
 * All state mutations go through these actions
 *
 * Note: Message/streaming state is handled separately via useState in InkCLIRefactored
 * to simplify the reducer and match WebUI's direct event handling pattern.
 */

import type { OverlayType, McpWizardServerType, PendingImage } from './types.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';

/**
 * Input actions
 */
export type InputChangeAction = {
    type: 'INPUT_CHANGE';
    value: string;
};

export type InputClearAction = {
    type: 'INPUT_CLEAR';
};

export type InputHistoryNavigateAction = {
    type: 'INPUT_HISTORY_NAVIGATE';
    direction: 'up' | 'down';
};

export type InputHistoryResetAction = {
    type: 'INPUT_HISTORY_RESET';
};

export type InputHistoryAddAction = {
    type: 'INPUT_HISTORY_ADD';
    value: string;
};

/**
 * Image attachment actions
 */
export type ImageAddAction = {
    type: 'IMAGE_ADD';
    image: PendingImage;
};

export type ImageRemoveAction = {
    type: 'IMAGE_REMOVE';
    imageId: string;
};

export type ImagesClearAction = {
    type: 'IMAGES_CLEAR';
};

export type CancelStartAction = {
    type: 'CANCEL_START';
};

export type ThinkingStartAction = {
    type: 'THINKING_START';
};

export type ThinkingEndAction = {
    type: 'THINKING_END';
};

/**
 * UI actions
 */
export type ProcessingStartAction = {
    type: 'PROCESSING_START';
};

export type ProcessingEndAction = {
    type: 'PROCESSING_END';
};

export type ShowOverlayAction = {
    type: 'SHOW_OVERLAY';
    overlay: OverlayType;
};

export type CloseOverlayAction = {
    type: 'CLOSE_OVERLAY';
};

export type SetMcpWizardServerTypeAction = {
    type: 'SET_MCP_WIZARD_SERVER_TYPE';
    serverType: McpWizardServerType;
};

/**
 * Session actions
 */
export type SessionSetAction = {
    type: 'SESSION_SET';
    sessionId: string;
    hasActiveSession: boolean;
};

export type SessionClearAction = {
    type: 'SESSION_CLEAR';
};

export type ModelUpdateAction = {
    type: 'MODEL_UPDATE';
    modelName: string;
};

export type ConversationResetAction = {
    type: 'CONVERSATION_RESET';
};

/**
 * Approval actions
 */
export type ApprovalRequestAction = {
    type: 'APPROVAL_REQUEST';
    approval: ApprovalRequest;
};

export type ApprovalCompleteAction = {
    type: 'APPROVAL_COMPLETE';
};

/**
 * Exit warning actions (for double Ctrl+C to exit)
 */
export type ExitWarningShowAction = {
    type: 'EXIT_WARNING_SHOW';
};

export type ExitWarningClearAction = {
    type: 'EXIT_WARNING_CLEAR';
};

/**
 * Copy mode actions (for text selection in alternate buffer)
 */
export type CopyModeEnableAction = {
    type: 'COPY_MODE_ENABLE';
};

export type CopyModeDisableAction = {
    type: 'COPY_MODE_DISABLE';
};

/**
 * Combined action type
 */
export type CLIAction =
    // Input actions
    | InputChangeAction
    | InputClearAction
    | InputHistoryNavigateAction
    | InputHistoryResetAction
    | InputHistoryAddAction
    // Image actions
    | ImageAddAction
    | ImageRemoveAction
    | ImagesClearAction
    // Processing/streaming state
    | CancelStartAction
    | ThinkingStartAction
    | ThinkingEndAction
    | ProcessingStartAction
    | ProcessingEndAction
    // UI actions
    | ShowOverlayAction
    | CloseOverlayAction
    | SetMcpWizardServerTypeAction
    // Session actions
    | SessionSetAction
    | SessionClearAction
    | ModelUpdateAction
    | ConversationResetAction
    // Approval actions
    | ApprovalRequestAction
    | ApprovalCompleteAction
    // Exit/copy mode actions
    | ExitWarningShowAction
    | ExitWarningClearAction
    | CopyModeEnableAction
    | CopyModeDisableAction;
