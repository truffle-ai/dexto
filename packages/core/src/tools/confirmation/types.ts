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
 * Event emitted when elicitation is requested
 */
export interface ElicitationEvent {
    message: string;
    requestedSchema: object;
    executionId: string;
    timestamp: Date;
    sessionId?: string;
    serverName?: string;
}

/**
 * Response to elicitation request
 */
export interface ElicitationResponse {
    executionId: string;
    action: 'accept' | 'decline' | 'cancel';
    data?: object;
    sessionId?: string;
}

/**
 * Interface for elicitation request details
 */
export interface ElicitationDetails {
    message: string;
    requestedSchema: object;
    sessionId?: string;
    serverName?: string;
}

/**
 * Interface for user approval providers that handle both tool confirmations and elicitation
 */
export interface UserApprovalProviderInterface extends ToolConfirmationProvider {
    // Elicitation methods
    requestElicitation(details: ElicitationDetails): Promise<ElicitationResponse>;
    handleElicitationResponse?(response: ElicitationResponse): Promise<void>;

    // Management methods
    getPendingConfirmations?(): string[];
    getPendingElicitations?(): string[];
    cancelConfirmation?(executionId: string): void;
    cancelElicitation?(executionId: string): void;
    cancelAllRequests?(): void;
}

/**
 * Interface to get tool confirmation and manage allowed tools
 * @deprecated Use UserApprovalProviderInterface for new implementations
 */
export interface ToolConfirmationProvider {
    allowedToolsProvider: IAllowedToolsProvider;
    requestConfirmation(details: ToolExecutionDetails): Promise<boolean>;

    // Only implemented by event-based providers – kept here for convenience
    handleConfirmationResponse?(response: ToolConfirmationResponse): Promise<void>;
}
