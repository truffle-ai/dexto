// ============================================================================
// USER APPROVAL TYPES - Generalized approval and user input system
// ============================================================================

import type { JSONSchema7 } from 'json-schema';

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
export type ApprovalStatus = 'approved' | 'denied' | 'cancelled';

/**
 * Tool confirmation specific metadata
 */
export interface ToolConfirmationMetadata {
    toolName: string;
    args: Record<string, unknown>;
    description?: string;
}

/**
 * Elicitation specific metadata (MCP)
 */
export interface ElicitationMetadata {
    /**
     * JSON Schema defining the expected input structure
     */
    schema: JSONSchema7;

    /**
     * Prompt text to display to the user
     */
    prompt: string;

    /**
     * MCP server name requesting the input
     */
    serverName: string;

    /**
     * Additional context for the elicitation request
     */
    context?: Record<string, unknown>;
}

/**
 * Custom approval metadata - flexible structure
 */
export interface CustomApprovalMetadata {
    [key: string]: unknown;
}

/**
 * Base approval request that all approvals extend
 */
export interface BaseApprovalRequest<TMetadata = unknown> {
    /**
     * Unique identifier for this approval request
     */
    approvalId: string;

    /**
     * Type of approval being requested
     */
    type: ApprovalType;

    /**
     * Optional session identifier to scope the approval
     */
    sessionId?: string;

    /**
     * Timeout in milliseconds for this specific request
     * Overrides default timeout if provided
     */
    timeout?: number;

    /**
     * Timestamp when the request was created
     */
    timestamp: Date;

    /**
     * Type-specific metadata for the approval
     */
    metadata: TMetadata;
}

/**
 * Tool confirmation request
 */
export type ToolConfirmationRequest = BaseApprovalRequest<ToolConfirmationMetadata> & {
    type: ApprovalType.TOOL_CONFIRMATION;
};

/**
 * Elicitation request from MCP server
 */
export type ElicitationRequest = BaseApprovalRequest<ElicitationMetadata> & {
    type: ApprovalType.ELICITATION;
};

/**
 * Custom approval request
 */
export type CustomApprovalRequest = BaseApprovalRequest<CustomApprovalMetadata> & {
    type: ApprovalType.CUSTOM;
};

/**
 * Union of all approval request types
 */
export type ApprovalRequest = ToolConfirmationRequest | ElicitationRequest | CustomApprovalRequest;

/**
 * Tool confirmation response data
 */
export interface ToolConfirmationResponseData {
    /**
     * Whether to remember this approval decision
     */
    rememberChoice?: boolean;
}

/**
 * Elicitation response data - validated form inputs
 */
export interface ElicitationResponseData {
    /**
     * Form data matching the requested schema
     */
    formData: Record<string, unknown>;
}

/**
 * Custom approval response data
 */
export interface CustomApprovalResponseData {
    [key: string]: unknown;
}

/**
 * Base approval response
 */
export interface BaseApprovalResponse<TData = unknown> {
    /**
     * Must match the approvalId from the request
     */
    approvalId: string;

    /**
     * Status of the approval
     */
    status: ApprovalStatus;

    /**
     * Optional session identifier (should match request if provided)
     */
    sessionId?: string;

    /**
     * Type-specific response data
     */
    data?: TData;
}

/**
 * Tool confirmation response
 */
export type ToolConfirmationResponse = BaseApprovalResponse<ToolConfirmationResponseData>;

/**
 * Elicitation response
 */
export type ElicitationResponse = BaseApprovalResponse<ElicitationResponseData>;

/**
 * Custom approval response
 */
export type CustomApprovalResponse = BaseApprovalResponse<CustomApprovalResponseData>;

/**
 * Union of all approval response types
 */
export type ApprovalResponse =
    | ToolConfirmationResponse
    | ElicitationResponse
    | CustomApprovalResponse;

/**
 * Details for creating an approval request
 */
export interface ApprovalRequestDetails {
    type: ApprovalType;
    sessionId?: string;
    timeout?: number;
    metadata: ToolConfirmationMetadata | ElicitationMetadata | CustomApprovalMetadata;
}

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
