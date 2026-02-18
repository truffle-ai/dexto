// ============================================================================
// USER APPROVAL TYPES - Generalized approval and user input system
// ============================================================================

import type { z } from 'zod';
import type {
    ToolApprovalMetadataSchema,
    CommandConfirmationMetadataSchema,
    ElicitationMetadataSchema,
    CustomApprovalMetadataSchema,
    DirectoryAccessMetadataSchema,
    BaseApprovalRequestSchema,
    ToolApprovalRequestSchema,
    CommandConfirmationRequestSchema,
    ElicitationRequestSchema,
    CustomApprovalRequestSchema,
    DirectoryAccessRequestSchema,
    ApprovalRequestSchema,
    ApprovalRequestDetailsSchema,
    ToolApprovalResponseDataSchema,
    CommandConfirmationResponseDataSchema,
    ElicitationResponseDataSchema,
    CustomApprovalResponseDataSchema,
    DirectoryAccessResponseDataSchema,
    BaseApprovalResponseSchema,
    ToolApprovalResponseSchema,
    CommandConfirmationResponseSchema,
    ElicitationResponseSchema,
    CustomApprovalResponseSchema,
    DirectoryAccessResponseSchema,
    ApprovalResponseSchema,
} from './schemas.js';

/**
 * Types of approval requests supported by the system
 */
export enum ApprovalType {
    /**
     * Binary approval for tool execution
     * Metadata contains: toolName, args, description
     */
    TOOL_APPROVAL = 'tool_confirmation',

    /**
     * Binary approval for dangerous commands within an already-approved tool
     * Metadata contains: toolName, command, originalCommand
     * (sessionId is provided at the request level, not in metadata)
     */
    COMMAND_CONFIRMATION = 'command_confirmation',

    /**
     * Schema-based form input from MCP servers
     * Metadata contains: schema, prompt, serverName, context
     */
    ELICITATION = 'elicitation',

    /**
     * Approval for accessing files outside the working directory
     * Metadata contains: path, parentDir, operation, toolName
     */
    DIRECTORY_ACCESS = 'directory_access',

    /**
     * Custom approval types for extensibility
     * Metadata format defined by consumer
     */
    CUSTOM = 'custom',
}

/**
 * Status of an approval response
 */
export enum ApprovalStatus {
    APPROVED = 'approved',
    DENIED = 'denied',
    CANCELLED = 'cancelled',
}

/**
 * Reason for denial or cancellation
 * Provides context about why an approval was not granted
 */
export enum DenialReason {
    /** User explicitly clicked deny/reject */
    USER_DENIED = 'user_denied',
    /** System denied due to policy (auto-deny mode, alwaysDeny list) */
    SYSTEM_DENIED = 'system_denied',
    /** Request timed out waiting for user response */
    TIMEOUT = 'timeout',
    /** User cancelled the request */
    USER_CANCELLED = 'user_cancelled',
    /** System cancelled (session ended, agent stopped) */
    SYSTEM_CANCELLED = 'system_cancelled',
    /** Validation failed (form validation, schema mismatch) */
    VALIDATION_FAILED = 'validation_failed',
    /** Elicitation disabled in configuration */
    ELICITATION_DISABLED = 'elicitation_disabled',
}

// ============================================================================
// Metadata Types - Derived from Zod schemas
// ============================================================================

/**
 * Tool approval specific metadata
 * Derived from ToolApprovalMetadataSchema
 */
export type ToolApprovalMetadata = z.output<typeof ToolApprovalMetadataSchema>;

/**
 * Command confirmation specific metadata
 * Derived from CommandConfirmationMetadataSchema
 */
export type CommandConfirmationMetadata = z.output<typeof CommandConfirmationMetadataSchema>;

/**
 * Elicitation specific metadata (MCP)
 * Derived from ElicitationMetadataSchema
 */
export type ElicitationMetadata = z.output<typeof ElicitationMetadataSchema>;

/**
 * Custom approval metadata - flexible structure
 * Derived from CustomApprovalMetadataSchema
 */
export type CustomApprovalMetadata = z.output<typeof CustomApprovalMetadataSchema>;

/**
 * Directory access metadata
 * Derived from DirectoryAccessMetadataSchema
 */
export type DirectoryAccessMetadata = z.output<typeof DirectoryAccessMetadataSchema>;

// ============================================================================
// Request Types - Derived from Zod schemas
// ============================================================================

/**
 * Base approval request that all approvals extend
 * Derived from BaseApprovalRequestSchema
 */
export type BaseApprovalRequest<_TMetadata = unknown> = z.output<typeof BaseApprovalRequestSchema>;

/**
 * Tool approval request
 * Derived from ToolApprovalRequestSchema
 */
export type ToolApprovalRequest = z.output<typeof ToolApprovalRequestSchema>;

/**
 * Command confirmation request
 * Derived from CommandConfirmationRequestSchema
 */
export type CommandConfirmationRequest = z.output<typeof CommandConfirmationRequestSchema>;

/**
 * Elicitation request from MCP server
 * Derived from ElicitationRequestSchema
 */
export type ElicitationRequest = z.output<typeof ElicitationRequestSchema>;

/**
 * Custom approval request
 * Derived from CustomApprovalRequestSchema
 */
export type CustomApprovalRequest = z.output<typeof CustomApprovalRequestSchema>;

/**
 * Directory access request
 * Derived from DirectoryAccessRequestSchema
 */
export type DirectoryAccessRequest = z.output<typeof DirectoryAccessRequestSchema>;

/**
 * Union of all approval request types
 * Derived from ApprovalRequestSchema
 */
export type ApprovalRequest = z.output<typeof ApprovalRequestSchema>;

// ============================================================================
// Response Data Types - Derived from Zod schemas
// ============================================================================

/**
 * Tool approval response data
 * Derived from ToolApprovalResponseDataSchema
 */
export type ToolApprovalResponseData = z.output<typeof ToolApprovalResponseDataSchema>;

/**
 * Command confirmation response data
 * Derived from CommandConfirmationResponseDataSchema
 */
export type CommandConfirmationResponseData = z.output<
    typeof CommandConfirmationResponseDataSchema
>;

/**
 * Elicitation response data - validated form inputs
 * Derived from ElicitationResponseDataSchema
 */
export type ElicitationResponseData = z.output<typeof ElicitationResponseDataSchema>;

/**
 * Custom approval response data
 * Derived from CustomApprovalResponseDataSchema
 */
export type CustomApprovalResponseData = z.output<typeof CustomApprovalResponseDataSchema>;

/**
 * Directory access response data
 * Derived from DirectoryAccessResponseDataSchema
 */
export type DirectoryAccessResponseData = z.output<typeof DirectoryAccessResponseDataSchema>;

// ============================================================================
// Response Types - Derived from Zod schemas
// ============================================================================

/**
 * Base approval response
 * Derived from BaseApprovalResponseSchema
 */
export type BaseApprovalResponse<_TData = unknown> = z.output<typeof BaseApprovalResponseSchema>;

/**
 * Tool approval response
 * Derived from ToolApprovalResponseSchema
 */
export type ToolApprovalResponse = z.output<typeof ToolApprovalResponseSchema>;

/**
 * Command confirmation response
 * Derived from CommandConfirmationResponseSchema
 */
export type CommandConfirmationResponse = z.output<typeof CommandConfirmationResponseSchema>;

/**
 * Elicitation response
 * Derived from ElicitationResponseSchema
 */
export type ElicitationResponse = z.output<typeof ElicitationResponseSchema>;

/**
 * Custom approval response
 * Derived from CustomApprovalResponseSchema
 */
export type CustomApprovalResponse = z.output<typeof CustomApprovalResponseSchema>;

/**
 * Directory access response
 * Derived from DirectoryAccessResponseSchema
 */
export type DirectoryAccessResponse = z.output<typeof DirectoryAccessResponseSchema>;

/**
 * Union of all approval response types
 * Derived from ApprovalResponseSchema
 */
export type ApprovalResponse = z.output<typeof ApprovalResponseSchema>;

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Details for creating an approval request
 * Derived from ApprovalRequestDetailsSchema
 */
export type ApprovalRequestDetails = z.output<typeof ApprovalRequestDetailsSchema>;

/**
 * Handler interface for processing approval requests.
 *
 * This is the core abstraction for approval handling in Dexto. When tool confirmation
 * mode is 'manual', a handler must be provided to process approval requests.
 *
 * The handler is a callable interface that:
 * - Processes approval requests and returns responses
 * - Manages pending approval state (for cancellation)
 * - Provides lifecycle management methods
 *
 * @example
 * ```typescript
 * const handler: ApprovalHandler = Object.assign(
 *   async (request: ApprovalRequest) => {
 *     console.log(`Approve tool: ${request.metadata.toolName}?`);
 *     // In real implementation, wait for user input
 *     return {
 *       approvalId: request.approvalId,
 *       status: ApprovalStatus.APPROVED,
 *       sessionId: request.sessionId,
 *     };
 *   },
 *   {
 *     cancel: (id: string) => { },
 *     cancelAll: () => { },
 *     getPending: () => [] as string[],
 *   }
 * );
 * ```
 */
export interface ApprovalHandler {
    /**
     * Process an approval request
     * @param request The approval request to handle
     * @returns Promise resolving to the approval response
     */
    (request: ApprovalRequest): Promise<ApprovalResponse>;

    /**
     * Cancel a specific pending approval request (optional)
     * @param approvalId The ID of the approval to cancel
     * @remarks Not all handlers support cancellation (e.g., auto-approve handlers)
     */
    cancel?(approvalId: string): void;

    /**
     * Cancel all pending approval requests (optional)
     * @remarks Not all handlers support cancellation (e.g., auto-approve handlers)
     */
    cancelAll?(): void;

    /**
     * Get list of pending approval request IDs (optional)
     * @returns Array of approval IDs currently pending
     * @remarks Not all handlers track pending requests (e.g., auto-approve handlers)
     */
    getPending?(): string[];

    /**
     * Get full pending approval requests (optional)
     * @returns Array of pending approval requests
     * @remarks Not all handlers track pending requests (e.g., auto-approve handlers)
     */
    getPendingRequests?(): ApprovalRequest[];

    /**
     * Auto-approve pending requests that match a predicate (optional)
     * Used when a pattern is remembered to auto-approve other parallel requests
     * that would now match the same pattern.
     *
     * @param predicate Function that returns true for requests that should be auto-approved
     * @param responseData Optional data to include in the auto-approval response
     * @returns Number of requests that were auto-approved
     * @remarks Not all handlers support this (e.g., auto-approve handlers don't need it)
     */
    autoApprovePending?(
        predicate: (request: ApprovalRequest) => boolean,
        responseData?: Record<string, unknown>
    ): number;
}
