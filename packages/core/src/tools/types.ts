// ============================================================================
// SIMPLIFIED TOOL TYPES - Essential interfaces only
// ============================================================================

import type { JSONSchema7 } from 'json-schema';
import type { z, ZodTypeAny } from 'zod';
import type { ToolDisplayData } from './display-types.js';
import type { WorkspaceContext } from '../workspace/types.js';
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

// TODO: Revisit where delegation ("task forking") belongs.
// Today `TaskForker` is a core-owned capability exposed via ToolExecutionContext.services so tool
// packs can delegate work without depending on `@dexto/agent-management` (which provides the impl).
// Alternatives: move delegation-only tools to a host tool pack, or surface taskForker as a
// first-class ToolExecutionContext field rather than inside `services`.
export type TaskForkOptions = Parameters<TaskForker['fork']>[0];

export interface ToolServices {
    approval: ApprovalManager;
    search: SearchService;
    resources: ResourceManager;
    prompts: PromptManager;
    mcp: MCPManager;
    taskForker: TaskForker | null;
}

/**
 * Context passed to tool execution
 */
export interface ToolExecutionContextBase {
    /** Session ID if available */
    sessionId?: string | undefined;
    /** Workspace ID if available */
    workspaceId?: string | undefined;
    /** Workspace context if available */
    workspace?: WorkspaceContext | undefined;
    /** Abort signal for cancellation support */
    abortSignal?: AbortSignal | undefined;
    /** Unique tool call ID for tracking parallel tool calls */
    toolCallId?: string | undefined;

    /**
     * Logger scoped to the tool execution.
     */
    logger: Logger;
}

export interface ToolExecutionContext extends ToolExecutionContextBase {
    /**
     * Runtime agent reference (DI refactor: provided by ToolManager on each execute()).
     */
    agent?: DextoAgent | undefined;

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
     * Runtime services available to tools. These are injected at execution time (not factory time)
     * to avoid init ordering cycles.
     */
    services?: ToolServices | undefined;
}

/**
 * Result of tool execution, including approval metadata
 */
export interface ToolExecutionResult {
    /** The actual result data from tool execution */
    result: unknown;
    /** Optional display name for the tool (UI convenience) */
    toolDisplayName?: string;
    /** Optional UI-agnostic presentation snapshot for this call/result */
    presentationSnapshot?: ToolPresentationSnapshotV1;
    /** Whether this tool required user approval before execution */
    requireApproval?: boolean;
    /** The approval status (only present if requireApproval is true) */
    approvalStatus?: 'approved' | 'rejected';
}

// =========================================================================
// PRESENTATION SNAPSHOT (UI-AGNOSTIC)
// =========================================================================

/**
 * UI-agnostic, runtime-computed presentation snapshot for tool calls/approvals/results.
 *
 * This is intended to decouple UIs (CLI/WebUI) from tool-specific heuristics (toolName parsing,
 * hardcoded argument omission, etc.). It must remain:
 * - JSON-serializable (plain objects/arrays/strings/numbers/booleans/null)
 * - Optional everywhere (UIs MUST fall back to generic defaults when absent)
 * - Forward-compatible (UIs MUST ignore unknown fields)
 *
 * SECURITY: Do not include secrets (tokens, full file contents, credentials). Prefer previews via
 * {@link ToolDisplayData} for large content and rely on UIs to render those previews.
 */
export type ToolPresentationSnapshotV1 = {
    version: 1;

    /** Optional source information (prevents UIs from parsing tool ids like `mcp--server--tool`). */
    source?: {
        type: 'local' | 'mcp';
        mcpServerName?: string;
    };

    /** Optional one-line identity of the call (used for headers/timelines). */
    header?: {
        title?: string;
        primaryText?: string;
        secondaryText?: string;
    };

    /** Compact semantic tags. Use sparingly to avoid UI noise. */
    chips?: Array<{
        kind: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
        text: string;
    }>;

    /** Human-facing argument presentation. Prefer `display` over leaking raw values. */
    args?: {
        summary?: Array<{
            label: string;
            display: string;
            kind?: 'path' | 'command' | 'url' | 'text' | 'json';
            sensitive?: boolean;
        }>;

        groups?: Array<{
            id: string;
            label: string;
            collapsedByDefault?: boolean;
            items: Array<{
                label: string;
                display: string;
                kind?: 'path' | 'command' | 'url' | 'text' | 'json';
                sensitive?: boolean;
            }>;
        }>;
    };

    /** Optional capabilities that UIs may use to enable modes without toolName branching. */
    capabilities?: string[];

    /** Optional approval UX hints. If absent, UIs use their existing generic approval flows. */
    approval?: {
        actions?: Array<
            | {
                  id: string;
                  label: string;
                  kind?: 'primary' | 'secondary' | 'danger';
                  responseData?: Record<string, unknown>;
                  uiEffects?: UiEffect[];
              }
            | {
                  id: string;
                  label: string;
                  kind?: 'danger';
                  denyWithFeedback?: {
                      placeholder?: string;
                      messageTemplate?: string;
                  };
              }
        >;
    };

    /** Optional post-result presentation and UI effects. */
    result?: {
        summaryText?: string;
        uiEffects?: UiEffect[];
    };
};

/**
 * Optional, UI-local side effects driven by tool approvals/results.
 *
 * UIs MAY ignore these. They are intended to replace toolName-based UI logic (plan mode, accept
 * edits mode, etc.) with declarative data.
 */
export type UiEffect =
    | {
          type: 'setFlag';
          flag: 'autoApproveEdits' | 'planModeActive' | 'planModeInitialized';
          value: boolean;
      }
    | {
          type: 'toast';
          kind: 'info' | 'warning' | 'success' | 'error';
          message: string;
      };

// ============================================================================
// CORE TOOL INTERFACES
// ============================================================================

/**
 * Tool interface - for tools implemented within Dexto
 */
export interface Tool<TSchema extends ZodTypeAny = ZodTypeAny> {
    /** Unique identifier for the tool */
    id: string;

    /**
     * Short, user-facing name for this tool (UI convenience).
     * Defaults to a title-cased version of {@link id} when omitted.
     */
    displayName?: string | undefined;

    /** Human-readable description of what the tool does */
    description: string;

    /** Zod schema defining the input parameters */
    inputSchema: TSchema;

    /** The actual function that executes the tool - input is validated by Zod before execution */
    execute(input: z.output<TSchema>, context: ToolExecutionContext): Promise<unknown> | unknown;

    /**
     * Optional preview generator for approval UI.
     * Called before requesting user approval to generate display data (e.g., diff preview).
     * Returns null if no preview is available.
     */
    generatePreview?(
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ): Promise<ToolDisplayData | null>;

    /**
     * Optional grouped approval-related behavior.
     *
     * Prefer these nested fields over legacy top-level approval hooks.
     * Legacy hooks remain supported temporarily for compatibility.
     */
    approval?: ToolApproval<TSchema> | undefined;

    /**
     * Optional grouped UI/presentation-related behavior.
     *
     * Prefer these nested fields over legacy top-level presentation hooks.
     * Legacy hooks remain supported temporarily for compatibility.
     */
    presentation?: ToolPresentation<TSchema> | undefined;

    /**
     * Optional aliases for this tool id.
     *
     * Used to support external prompt/skill ecosystems that refer to tools by short names
     * (e.g. Claude Code "bash", "read", "grep" in allowed-tools). Aliases are resolved
     * by {@link ToolManager} when applying session auto-approve lists.
     */
    aliases?: string[] | undefined;

    /**
     * Optional pattern key generator for approval memory.
     *
     * If provided, ToolManager will:
     * - Skip confirmation when the pattern key is covered by previously approved patterns.
     * - Offer suggested patterns (if {@link suggestApprovalPatterns} is provided) in the approval UI.
     *
     * Return null to disable pattern approvals for the given input (e.g. dangerous commands).
     */
    getApprovalPatternKey?(input: z.output<TSchema>): string | null;

    /**
     * Optional pattern suggestions for the approval UI.
     *
     * Returned patterns are shown as quick "remember pattern" options.
     */
    suggestApprovalPatterns?(input: z.output<TSchema>): string[];

    /**
     * Optional custom approval override.
     * If present and returns non-null, this approval request is used instead of
     * the default tool confirmation. Allows tools to request specialized approval
     * flows (e.g., directory access approval for file tools).
     *
     * @param input The validated input arguments for the tool
     * @returns ApprovalRequestDetails for custom approval, or null to use default tool confirmation
     *
     * @example
     * ```typescript
     * // File tool requesting directory access approval for external paths
     * getApprovalOverride: async (input) => {
     *   const filePath = (input as {file_path: string}).file_path;
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
    getApprovalOverride?(
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ): Promise<ApprovalRequestDetails | null> | ApprovalRequestDetails | null;

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
    onApprovalGranted?(
        response: ApprovalResponse,
        context: ToolExecutionContext,
        approvalRequest: ApprovalRequestDetails
    ): void;
}

export interface ToolApproval<TSchema extends ZodTypeAny = ZodTypeAny> {
    override?(
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ): Promise<ApprovalRequestDetails | null> | ApprovalRequestDetails | null;

    onGranted?(
        response: ApprovalResponse,
        context: ToolExecutionContext,
        approvalRequest: ApprovalRequestDetails
    ): Promise<void> | void;

    patternKey?(input: z.output<TSchema>): string | null;

    suggestPatterns?(input: z.output<TSchema>): string[];
}

export interface ToolPresentation<TSchema extends ZodTypeAny = ZodTypeAny> {
    displayName?: string;

    preview?(
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ): Promise<ToolDisplayData | null> | ToolDisplayData | null;

    describeCall?(
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ): Promise<ToolPresentationSnapshotV1 | null> | ToolPresentationSnapshotV1 | null;

    describeResult?(
        result: unknown,
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ):
        | Promise<ToolPresentationSnapshotV1['result'] | null>
        | ToolPresentationSnapshotV1['result']
        | null;
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
        _meta?: Record<string, unknown>;
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
