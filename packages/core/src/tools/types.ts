// ============================================================================
// SIMPLIFIED TOOL TYPES - Essential interfaces only
// ============================================================================

import type { JSONSchema7 } from 'json-schema';
import type { ZodSchema } from 'zod';
import type { ToolDisplayData } from './display-types.js';
import type { ApprovalRequestDetails, ApprovalResponse } from '../approval/types.js';
import type { ApprovalManager } from '../approval/manager.js';
import type { DextoAgent } from '../agent/DextoAgent.js';
import type { Cache } from '../storage/cache/types.js';
import type { BlobStore } from '../storage/blob/types.js';
import type { Database } from '../storage/database/types.js';
import type { MCPManager } from '../mcp/manager.js';
import type { PromptManager } from '../prompts/prompt-manager.js';
import type { ResourceManager } from '../resources/manager.js';
import type { SearchService } from '../search/search-service.js';
import type { Logger } from '../logger/v2/types.js';

/**
 * Interface for forking execution to an isolated sub-agent context.
 *
 * Implemented by AgentSpawnerRuntime in `@dexto/agent-management` and surfaced to tools
 * via {@link ToolExecutionContext.services}.
 */
export interface TaskForker {
    fork(options: {
        task: string;
        instructions: string;
        agentId?: string;
        autoApprove?: boolean;
        toolCallId?: string;
        sessionId?: string;
    }): Promise<{
        success: boolean;
        response?: string;
        error?: string;
    }>;
}

export interface ToolServices {
    approval: ApprovalManager;
    search: SearchService;
    resources: ResourceManager;
    prompts: PromptManager;
    mcp: MCPManager;
    taskForker?: TaskForker | undefined;
}

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

    /**
     * Runtime agent reference (DI refactor: provided by ToolManager on each execute()).
     */
    agent?: DextoAgent | undefined;

    /**
     * Logger scoped to the tool execution.
     */
    logger?: Logger | undefined;

    /**
     * Concrete storage backends (DI-first).
     */
    storage?:
        | {
              blob: BlobStore;
              database: Database;
              cache: Cache;
          }
        | undefined;

    /**
     * Runtime services available to tools.
     * These are injected at execution time (not factory time) to avoid init ordering cycles.
     */
    services?: ToolServices | undefined;
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
 * Tool interface - for tools implemented within Dexto
 */
export interface Tool {
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
        args: unknown,
        context?: ToolExecutionContext
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
    onApprovalGranted?: (response: ApprovalResponse, context?: ToolExecutionContext) => void;
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
    data?: unknown;
    error?: string;
}

/**
 * Interface for any provider of tools
 */
export interface ToolProvider {
    getTools(): Promise<ToolSet>;
    callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}
