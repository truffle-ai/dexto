/**
 * Core state types for Ink CLI
 * Central type definitions for the CLI state machine
 */

import type { ApprovalRequest } from '../components/ApprovalPrompt.js';

/**
 * Startup information displayed in CLI header
 */
export interface StartupInfo {
    connectedServers: { count: number; names: string[] };
    failedConnections: string[];
    toolCount: number;
    logFile: string;
}

/**
 * Tool call status for visual feedback
 */
export type ToolStatus = 'running' | 'finished';

/**
 * Message in the chat interface
 */
export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: Date;
    isStreaming?: boolean;
    toolResult?: string; // Tool result preview (first 4-5 lines)
    toolStatus?: ToolStatus; // Status for tool messages (running/finished)
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
    | 'mcp-selector'
    | 'mcp-add-selector'
    | 'mcp-remove-selector'
    | 'mcp-custom-type-selector'
    | 'mcp-custom-wizard'
    | 'log-level-selector'
    | 'session-subcommand-selector'
    | 'approval';

/**
 * MCP server type for custom wizard
 */
export type McpWizardServerType = 'stdio' | 'http' | 'sse' | null;

/**
 * UI state management
 */
export interface UIState {
    isProcessing: boolean;
    isCancelling: boolean; // True when cancellation is in progress
    isThinking: boolean; // True when LLM is thinking (before streaming starts)
    activeOverlay: OverlayType;
    exitWarningShown: boolean; // True when first Ctrl+C was pressed (pending second to exit)
    exitWarningTimestamp: number | null; // Timestamp of first Ctrl+C for timeout
    mcpWizardServerType: McpWizardServerType; // Server type for MCP custom wizard
}

/**
 * Session state management
 */
export interface SessionState {
    id: string | null;
    hasActiveSession: boolean;
    modelName: string; // Current model name
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
    approvalQueue: ApprovalRequest[]; // Queue for pending approvals
}
