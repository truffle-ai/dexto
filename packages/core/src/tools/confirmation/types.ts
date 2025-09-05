// ============================================================================
// TOOL CONFIRMATION TYPES - Centralized confirmation and approval management
// ============================================================================

import type { IAllowedToolsProvider } from './allowed-tools-provider/types.js';

/**
 * Event emitted when tool confirmation is requested
 */
export interface ToolConfirmationEvent {
    toolName: string;
    args: Record<string, unknown>;
    description?: string | undefined;
    executionId: string;
    timestamp: Date;
    sessionId?: string;
}

/**
 * Response to tool confirmation request
 */
export interface ToolConfirmationResponse {
    executionId: string;
    approved: boolean;
    rememberChoice?: boolean;
    /**
     * Optional session identifier to scope the approval. When provided, a
     * "remembered" approval is stored only for this session by the
     * AllowedToolsProvider implementation.
     */
    sessionId?: string;
}

/**
 * Interface for current tool being executed
 */
export interface ToolExecutionDetails {
    toolName: string;
    args: Record<string, unknown>;
    description?: string;
    sessionId?: string;
}

/**
 * Interface to get tool confirmation and manage allowed tools
 */
export interface ToolConfirmationProvider {
    allowedToolsProvider: IAllowedToolsProvider;
    requestConfirmation(details: ToolExecutionDetails): Promise<boolean>;

    // Only implemented by event-based providers – kept here for convenience
    handleConfirmationResponse?(response: ToolConfirmationResponse): Promise<void>;
}
