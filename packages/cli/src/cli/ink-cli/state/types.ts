/**
 * Core state types for Ink CLI
 * Central type definitions for the CLI state machine
 */

import type { ApprovalRequest } from '../components/ApprovalPrompt.js';

/**
 * Message in the chat interface
 */
export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: Date;
    isStreaming?: boolean;
}

/**
 * Streaming message state
 */
export interface StreamingMessage {
    id: string;
    content: string;
}

/**
 * Input state management
 */
export interface InputState {
    value: string;
    history: string[];
    historyIndex: number;
}

/**
 * Available overlay types
 */
export type OverlayType =
    | 'none'
    | 'slash-autocomplete'
    | 'resource-autocomplete'
    | 'model-selector'
    | 'session-selector'
    | 'approval';

/**
 * UI state management
 */
export interface UIState {
    isProcessing: boolean;
    activeOverlay: OverlayType;
}

/**
 * Session state management
 */
export interface SessionState {
    id: string | null;
    hasActiveSession: boolean;
}

/**
 * Root CLI state
 */
export interface CLIState {
    // Message state
    messages: Message[];
    streamingMessage: StreamingMessage | null;

    // Input state
    input: InputState;

    // UI state
    ui: UIState;

    // Session state
    session: SessionState;

    // Approval state
    approval: ApprovalRequest | null;
}
