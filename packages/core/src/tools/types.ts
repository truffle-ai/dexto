// ============================================================================
// SIMPLIFIED TOOL TYPES - Essential interfaces only
// ============================================================================

import type { JSONSchema7 } from 'json-schema';
import type { ZodSchema } from 'zod';
import type { ToolDisplayData } from './display-types.js';
import type { ApprovalRequestDetails, ApprovalResponse } from '../approval/types.js';

/**
 * Context passed to tool execution
 */
export interface ToolExecutionContext {
    /** Session ID if available */
    sessionId?: string | undefined;
    /** Abort signal for cancellation support */
    abortSignal?: AbortSignal | undefined;
    /** Unique tool call ID for tracking parallel tool calls */
    toolCallId?: string | undefined;
}

/**
 * Result of tool execution, including approval metadata
 */
export interface ToolExecutionResult {
    /** The actual result data from tool execution */
    result: unknown;
    /** Whether this tool required user approval before execution */
    requireApproval?: boolean;
    /** The approval status (only present if requireApproval is true) */
    approvalStatus?: 'approved' | 'rejected';
}

// ============================================================================
// CORE TOOL INTERFACES
// ============================================================================

/**
 * Internal tool interface - for tools implemented within Dexto
 */
export interface InternalTool {
    /** Unique identifier for the tool */
    id: string;

    /** Human-readable description of what the tool does */
    description: string;

    /** Zod schema defining the input parameters */
    inputSchema: ZodSchema;

    /** The actual function that executes the tool - input is validated by Zod before execution */
    execute: (input: unknown, context?: ToolExecutionContext) => Promise<unknown> | unknown;

    /**
     * Optional preview generator for approval UI.
     * Called before requesting user approval to generate display data (e.g., diff preview).
     * Returns null if no preview is available.
     */
    generatePreview?: (
        input: unknown,
        context?: ToolExecutionContext
    ) => Promise<ToolDisplayData | null>;

    /**
     * Optional custom approval override.
     * If present and returns non-null, this approval request is used instead of
     * the default tool confirmation. Allows tools to request specialized approval
     * flows (e.g., directory access approval for file tools).
     *
     * @param args The validated input arguments for the tool
     * @returns ApprovalRequestDetails for custom approval, or null to use default tool confirmation
     *
     * @example
     * ```typescript
     * // File tool requesting directory access approval for external paths
     * getApprovalOverride: async (args) => {
     *   const filePath = (args as {file_path: string}).file_path;
     *   if (!await isPathWithinAllowed(filePath)) {
     *     return {
     *       type: ApprovalType.DIRECTORY_ACCESS,
     *       metadata: { path: filePath, operation: 'read', ... }
     *     };
     *   }
     *   return null; // Use default tool confirmation
     * }
     * ```
     */
    getApprovalOverride?: (
        args: unknown
    ) => Promise<ApprovalRequestDetails | null> | ApprovalRequestDetails | null;

    /**
     * Optional callback invoked when custom approval is granted.
     * Allows tools to handle approval responses (e.g., remember approved directories).
     * Only called when getApprovalOverride returned non-null and approval was granted.
     *
     * @param response The approval response from ApprovalManager
     *
     * @example
     * ```typescript
     * onApprovalGranted: (response) => {
     *   if (response.data?.rememberDirectory) {
     *     directoryApproval.addApproved(parentDir, 'session');
     *   }
     * }
     * ```
     */
    onApprovalGranted?: (response: ApprovalResponse) => void;
}

/**
 * Standard tool set interface - used by AI/LLM services
 * Each tool entry contains JSON Schema parameters
 */
export interface ToolSet {
    [key: string]: {
        name?: string;
        description?: string;
        parameters: JSONSchema7; // JSON Schema v7 specification
    };
}

// ============================================================================
// TOOL EXECUTION AND RESULTS
// ============================================================================

/**
 * Tool execution result
 */
export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
}

/**
 * Interface for any provider of tools
 */
export interface ToolProvider {
    getTools(): Promise<ToolSet>;
    callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}
