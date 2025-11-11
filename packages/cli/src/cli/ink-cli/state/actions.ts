/**
 * State actions for CLI state machine
 * All state mutations go through these actions
 */

import type { Message, OverlayType } from './types.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';

/**
 * Input actions
 */
export type InputChangeAction = {
    type: 'INPUT_CHANGE';
    value: string;
    forceRemount?: boolean; // Force TextInput remount to reset cursor position
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

export type InputToggleMultiLineAction = {
    type: 'INPUT_TOGGLE_MULTILINE';
};

/**
 * Message actions
 */
export type MessageAddAction = {
    type: 'MESSAGE_ADD';
    message: Message;
};

export type MessageAddMultipleAction = {
    type: 'MESSAGE_ADD_MULTIPLE';
    messages: Message[];
};

export type MessageInsertBeforeStreamingAction = {
    type: 'MESSAGE_INSERT_BEFORE_STREAMING';
    message: Message;
};

export type MessageUpdateAction = {
    type: 'MESSAGE_UPDATE';
    id: string;
    update: Partial<Message>;
};

export type MessageRemoveAction = {
    type: 'MESSAGE_REMOVE';
    id: string;
};

/**
 * Streaming actions
 */
export type StreamingStartAction = {
    type: 'STREAMING_START';
    id: string;
};

export type StreamingChunkAction = {
    type: 'STREAMING_CHUNK';
    content: string;
};

export type StreamingEndAction = {
    type: 'STREAMING_END';
    content: string;
};

export type StreamingCancelAction = {
    type: 'STREAMING_CANCEL';
};

export type CancelStartAction = {
    type: 'CANCEL_START';
};

/**
 * Submission actions
 */
export type SubmitStartAction = {
    type: 'SUBMIT_START';
    userMessage: Message;
    inputValue: string;
};

export type SubmitCompleteAction = {
    type: 'SUBMIT_COMPLETE';
};

export type SubmitErrorAction = {
    type: 'SUBMIT_ERROR';
    errorMessage: string;
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
 * Error actions
 */
export type ErrorAction = {
    type: 'ERROR';
    errorMessage: string;
};

/**
 * Combined action type
 */
export type CLIAction =
    | InputChangeAction
    | InputClearAction
    | InputHistoryNavigateAction
    | InputHistoryResetAction
    | InputToggleMultiLineAction
    | MessageAddAction
    | MessageAddMultipleAction
    | MessageInsertBeforeStreamingAction
    | MessageUpdateAction
    | MessageRemoveAction
    | StreamingStartAction
    | StreamingChunkAction
    | StreamingEndAction
    | StreamingCancelAction
    | CancelStartAction
    | SubmitStartAction
    | SubmitCompleteAction
    | SubmitErrorAction
    | ProcessingStartAction
    | ProcessingEndAction
    | ShowOverlayAction
    | CloseOverlayAction
    | SessionSetAction
    | SessionClearAction
    | ModelUpdateAction
    | ConversationResetAction
    | ApprovalRequestAction
    | ApprovalCompleteAction
    | ErrorAction;
