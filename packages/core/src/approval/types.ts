// ============================================================================
// USER APPROVAL TYPES - Generalized approval and user input system
// ============================================================================

import type { z } from 'zod';
import type {
    ToolConfirmationMetadataSchema,
    CommandConfirmationMetadataSchema,
    ElicitationMetadataSchema,
    CustomApprovalMetadataSchema,
    BaseApprovalRequestSchema,
    ToolConfirmationRequestSchema,
    CommandConfirmationRequestSchema,
    ElicitationRequestSchema,
    CustomApprovalRequestSchema,
    ApprovalRequestSchema,
    ApprovalRequestDetailsSchema,
    ToolConfirmationResponseDataSchema,
    CommandConfirmationResponseDataSchema,
    ElicitationResponseDataSchema,
    CustomApprovalResponseDataSchema,
    BaseApprovalResponseSchema,
    ToolConfirmationResponseSchema,
    CommandConfirmationResponseSchema,
    ElicitationResponseSchema,
    CustomApprovalResponseSchema,
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
    TOOL_CONFIRMATION = 'tool_confirmation',

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
 * Tool confirmation specific metadata
 * Derived from ToolConfirmationMetadataSchema
 */
export type ToolConfirmationMetadata = z.output<typeof ToolConfirmationMetadataSchema>;

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

// ============================================================================
// Request Types - Derived from Zod schemas
// ============================================================================

/**
 * Base approval request that all approvals extend
 * Derived from BaseApprovalRequestSchema
 */
export type BaseApprovalRequest<_TMetadata = unknown> = z.output<typeof BaseApprovalRequestSchema>;

/**
 * Tool confirmation request
 * Derived from ToolConfirmationRequestSchema
 */
export type ToolConfirmationRequest = z.output<typeof ToolConfirmationRequestSchema>;

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
 * Union of all approval request types
 * Derived from ApprovalRequestSchema
 */
export type ApprovalRequest = z.output<typeof ApprovalRequestSchema>;

// ============================================================================
// Response Data Types - Derived from Zod schemas
// ============================================================================

/**
 * Tool confirmation response data
 * Derived from ToolConfirmationResponseDataSchema
 */
export type ToolConfirmationResponseData = z.output<typeof ToolConfirmationResponseDataSchema>;

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

// ============================================================================
// Response Types - Derived from Zod schemas
// ============================================================================

/**
 * Base approval response
 * Derived from BaseApprovalResponseSchema
 */
export type BaseApprovalResponse<_TData = unknown> = z.output<typeof BaseApprovalResponseSchema>;

/**
 * Tool confirmation response
 * Derived from ToolConfirmationResponseSchema
 */
export type ToolConfirmationResponse = z.output<typeof ToolConfirmationResponseSchema>;

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
 * Handler function for processing approval requests.
 *
 * This is the core abstraction for approval handling in Dexto. When tool confirmation
 * mode is 'manual', a handler must be provided to process approval requests.
 *
 * The handler receives an approval request and must return a promise that resolves
 * to an approval response. The handler is responsible for:
 * - Presenting the approval request to the user (CLI, UI, webhook, etc.)
 * - Collecting the user's decision
 * - Returning an appropriate response with approved/denied/cancelled status
 *
 * @param request The approval request to handle
 * @returns Promise resolving to the approval response
 *
 * @example
 * ```typescript
 * const handler: ApprovalHandler = async (request) => {
 *   console.log(`Approve tool: ${request.metadata.toolName}?`);
 *   // In real implementation, wait for user input
 *   return {
 *     approvalId: request.approvalId,
 *     status: ApprovalStatus.APPROVED,
 *     sessionId: request.sessionId,
 *   };
 * };
 * ```
 */
export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalResponse>;

/**
 * Interface for approval providers
 * @deprecated Will be removed in favor of ApprovalHandler
 */
export interface ApprovalProvider {
    /**
     * Request approval from the user
     * @param request The approval request details
     * @returns Promise resolving to the approval response
     */
    requestApproval(request: ApprovalRequest): Promise<ApprovalResponse>;

    /**
     * Cancel a pending approval request
     * @param approvalId The ID of the approval to cancel
     */
    cancelApproval(approvalId: string): void;

    /**
     * Cancel all pending approval requests
     */
    cancelAllApprovals(): void;

    /**
     * Get list of pending approval request IDs
     */
    getPendingApprovals(): string[];
}
