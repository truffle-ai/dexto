/**
 * Core state types for Ink CLI
 * Central type definitions for the CLI state machine
 */

import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import type { ToolDisplayData, ContentPart, McpConnectionStatus, McpServerType } from '@dexto/core';

/**
 * Startup information displayed in CLI header
 */
export interface StartupInfo {
    connectedServers: { count: number; names: string[] };
    failedConnections: string[];
    toolCount: number;
    logFile: string | null;
}

/**
 * Tool call status for visual feedback
 * - pending: Tool call received, checking if approval needed (static gray dot)
 * - pending_approval: Waiting for user approval (static orange dot)
 * - running: Actually executing (animated green/teal spinner)
 * - finished: Completed (green dot success, red dot error)
 */
export type ToolStatus = 'pending' | 'pending_approval' | 'running' | 'finished';

/**
 * Styled message types for rich command output
 */
export type StyledMessageType =
    | 'config'
    | 'stats'
    | 'help'
    | 'session-list'
    | 'session-history'
    | 'log-config'
    | 'run-summary'
    | 'prompts'
    | 'sysprompt'
    | 'shortcuts';

/**
 * Structured data for styled messages
 */
export interface ConfigStyledData {
    configFilePath: string | null;
    provider: string;
    model: string;
    maxTokens: number | null;
    temperature: number | null;
    toolConfirmationMode: string;
    maxSessions: string;
    sessionTTL: string;
    mcpServers: string[];
    promptsCount: number;
    pluginsEnabled: string[];
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
    tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        totalTokens: number;
    };
    estimatedCost?: number;
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

export interface RunSummaryStyledData {
    /** Duration in milliseconds */
    durationMs: number;
    /** Total tokens used (lastInput + cumulativeOutput) */
    totalTokens: number;
}

export interface PromptsStyledData {
    mcpPrompts: Array<{
        name: string;
        title?: string;
        description?: string;
        args?: string[];
    }>;
    configPrompts: Array<{
        name: string;
        title?: string;
        description?: string;
    }>;
    customPrompts: Array<{
        name: string;
        title?: string;
        description?: string;
    }>;
    total: number;
}

export interface SysPromptStyledData {
    content: string;
}

export interface ShortcutsStyledData {
    categories: Array<{
        name: string;
        shortcuts: Array<{
            keys: string;
            description: string;
        }>;
    }>;
}

export type StyledData =
    | ConfigStyledData
    | StatsStyledData
    | HelpStyledData
    | SessionListStyledData
    | SessionHistoryStyledData
    | LogConfigStyledData
    | RunSummaryStyledData
    | PromptsStyledData
    | SysPromptStyledData
    | ShortcutsStyledData;

/**
 * Sub-agent progress data for spawn_agent tool calls
 */
export interface SubAgentProgress {
    /** Short task description */
    task: string;
    /** Agent ID (e.g., 'explore-agent') */
    agentId: string;
    /** Number of tools called by the sub-agent */
    toolsCalled: number;
    /** Current tool being executed */
    currentTool: string;
    /** Current tool arguments (optional) */
    currentArgs?: Record<string, unknown> | undefined;
    /** Cumulative token usage from the sub-agent (updated on each llm:response) */
    tokenUsage?: {
        input: number;
        output: number;
        total: number;
    };
}

/**
 * Todo status for workflow tracking
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

/**
 * Todo item for workflow tracking
 */
export interface TodoItem {
    id: string;
    sessionId: string;
    content: string;
    activeForm: string;
    status: TodoStatus;
    position: number;
    createdAt: Date | string;
    updatedAt: Date | string;
}

/**
 * Message in the chat interface
 *
 * TODO: Consolidate with InternalMessage from @dexto/core. Currently we have two
 * message types: InternalMessage (core, ContentPart[] content) and Message (CLI,
 * string content + UI fields). Consider extending InternalMessage or extracting
 * shared role type to reduce duplication and type confusion.
 */
export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: Date;
    isStreaming?: boolean;
    toolResult?: string; // Tool result preview (first 4-5 lines)
    toolStatus?: ToolStatus; // Status for tool messages (running/finished)
    isError?: boolean; // True if tool execution failed
    styledType?: StyledMessageType; // Type of styled rendering (if any)
    styledData?: StyledData; // Structured data for styled rendering
    /** True for split messages that continue a previous message (no role indicator) */
    isContinuation?: boolean;
    /** True for messages that are queued while agent is processing */
    isQueued?: boolean;
    /** Queue position (1-indexed) for queued messages */
    queuePosition?: number;
    /** Structured display data for tool-specific rendering (diffs, shell output, etc.) */
    toolDisplayData?: ToolDisplayData;
    /** Content parts for tool result rendering */
    toolContent?: ContentPart[];
    /** Sub-agent progress data (for spawn_agent tool calls) */
    subAgentProgress?: SubAgentProgress;
}

/**
 * Streaming message state
 */
export interface StreamingMessage {
    id: string;
    content: string;
}

/**
 * Pending image attachment
 */
export interface PendingImage {
    /** Unique ID for tracking/removal */
    id: string;
    /** Base64-encoded image data */
    data: string;
    /** MIME type of the image */
    mimeType: string;
    /** Placeholder text shown in input (e.g., "[Image 1]") */
    placeholder: string;
}

/**
 * Pasted content block (for collapsible paste feature)
 */
export interface PastedBlock {
    /** Unique ID for tracking */
    id: string;
    /** Sequential number for display (Paste 1, Paste 2, etc.) */
    number: number;
    /** The full original pasted text */
    fullText: string;
    /** Line count for display */
    lineCount: number;
    /** Whether this block is currently collapsed */
    isCollapsed: boolean;
    /** The placeholder text when collapsed (e.g., "[Paste 1: ~32 lines]") */
    placeholder: string;
}

/**
 * Input state management
 */
export interface InputState {
    value: string;
    history: string[];
    historyIndex: number;
    draftBeforeHistory: string;
    /** Pending images to be sent with the next message */
    images: PendingImage[];
    /** Pasted content blocks (collapsed/expandable) */
    pastedBlocks: PastedBlock[];
    /** Counter for generating sequential paste numbers */
    pasteCounter: number;
}

/**
 * Available overlay types
 */
export type OverlayType =
    | 'none'
    | 'slash-autocomplete'
    | 'resource-autocomplete'
    | 'model-selector'
    | 'custom-model-wizard'
    | 'session-selector'
    | 'mcp-server-list'
    | 'mcp-server-actions'
    | 'mcp-add-choice'
    | 'mcp-add-selector'
    | 'mcp-custom-type-selector'
    | 'mcp-custom-wizard'
    | 'log-level-selector'
    | 'stream-selector'
    | 'session-subcommand-selector'
    | 'api-key-input'
    | 'search'
    | 'approval'
    | 'tool-browser'
    | 'prompt-list'
    | 'prompt-add-choice'
    | 'prompt-add-wizard'
    | 'prompt-delete-selector'
    | 'session-rename'
    | 'context-stats';

/**
 * MCP server type for custom wizard (null = not yet selected)
 */
export type McpWizardServerType = McpServerType | null;

/**
 * MCP server info for actions screen
 */
export interface SelectedMcpServer {
    name: string;
    enabled: boolean;
    status: McpConnectionStatus;
    type: McpServerType;
}

/**
 * Pending model switch info (when waiting for API key input)
 */
export interface PendingModelSwitch {
    provider: string;
    model: string;
    displayName?: string;
}

/**
 * Prompt add wizard state
 */
export type PromptAddScope = 'agent' | 'shared';

export interface PromptAddWizardState {
    scope: PromptAddScope;
    step: 'name' | 'title' | 'description' | 'content';
    name: string;
    title: string;
    description: string;
    content: string;
}

/**
 * History search state (Ctrl+R reverse search)
 */
export interface HistorySearchState {
    isActive: boolean;
    query: string;
    matchIndex: number; // Index into filtered matches (0 = most recent match)
    originalInput: string; // Cached input to restore on Escape
    lastMatch: string; // Last valid match (preserved when no results)
}

/**
 * UI state management
 */
export interface UIState {
    isProcessing: boolean;
    isCancelling: boolean; // True when cancellation is in progress
    isThinking: boolean; // True when LLM is thinking (before streaming starts)
    isCompacting: boolean; // True when context is being compacted
    activeOverlay: OverlayType;
    exitWarningShown: boolean; // True when first Ctrl+C was pressed (pending second to exit)
    exitWarningTimestamp: number | null; // Timestamp of first Ctrl+C for timeout
    mcpWizardServerType: McpWizardServerType; // Server type for MCP custom wizard
    copyModeEnabled: boolean; // True when copy mode is active (mouse events disabled for text selection)
    pendingModelSwitch: PendingModelSwitch | null; // Pending model switch waiting for API key
    selectedMcpServer: SelectedMcpServer | null; // Selected server for MCP actions screen
    historySearch: HistorySearchState; // Ctrl+R reverse history search
    promptAddWizard: PromptAddWizardState | null; // Prompt add wizard state
    autoApproveEdits: boolean; // True when edit mode is on (auto-approve edit_file/write_file)
    todoExpanded: boolean; // True when todo list is expanded (shows all tasks), false when collapsed (shows current task only)
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
