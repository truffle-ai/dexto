// ============================================================================
// USER APPROVAL TYPES - Generalized approval and user input system
// ============================================================================

import type { z } from 'zod';
import type {
    ToolConfirmationMetadataSchema,
    ElicitationMetadataSchema,
    CustomApprovalMetadataSchema,
    BaseApprovalRequestSchema,
    ToolConfirmationRequestSchema,
    ElicitationRequestSchema,
    CustomApprovalRequestSchema,
    ApprovalRequestSchema,
    ApprovalRequestDetailsSchema,
    ToolConfirmationResponseDataSchema,
    ElicitationResponseDataSchema,
    CustomApprovalResponseDataSchema,
    BaseApprovalResponseSchema,
    ToolConfirmationResponseSchema,
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

// ============================================================================
// Metadata Types - Derived from Zod schemas
// ============================================================================

/**
 * Tool confirmation specific metadata
 * Derived from ToolConfirmationMetadataSchema
 */
export type ToolConfirmationMetadata = z.output<typeof ToolConfirmationMetadataSchema>;

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
 * Interface for approval providers
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
