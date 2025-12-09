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
 * Styled message types for rich command output
 */
export type StyledMessageType =
    | 'config'
    | 'stats'
    | 'help'
    | 'session-list'
    | 'session-history'
    | 'log-config';

/**
 * Structured data for styled messages
 */
export interface ConfigStyledData {
    provider: string;
    model: string;
    maxSessions: string;
    sessionTTL: string;
    mcpServers: string[];
}

export interface StatsStyledData {
    sessions: {
        total: number;
        inMemory: number;
        maxAllowed: number;
    };
    mcp: {
        connected: number;
        failed: number;
        toolCount: number;
    };
}

export interface HelpStyledData {
    commands: Array<{
        name: string;
        description: string;
        category: string;
    }>;
}

export interface SessionListStyledData {
    sessions: Array<{
        id: string;
        messageCount: number;
        lastActive: string;
        isCurrent: boolean;
    }>;
    total: number;
}

export interface SessionHistoryStyledData {
    sessionId: string;
    messages: Array<{
        role: string;
        content: string;
        timestamp: string;
    }>;
    total: number;
}

export interface LogConfigStyledData {
    currentLevel: string;
    logFile: string | null;
    availableLevels: string[];
}

export type StyledData =
    | ConfigStyledData
    | StatsStyledData
    | HelpStyledData
    | SessionListStyledData
    | SessionHistoryStyledData
    | LogConfigStyledData;

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
    styledType?: StyledMessageType; // Type of styled rendering (if any)
    styledData?: StyledData; // Structured data for styled rendering
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
    copyModeEnabled: boolean; // True when copy mode is active (mouse events disabled for text selection)
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
 * Root CLI state (UI state only - messages handled separately via useState)
 */
export interface CLIState {
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
