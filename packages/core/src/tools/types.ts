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
        /**
         * Pre-formatted one-line call detail shown in parentheses.
         * Example: `Read(/path/to/file.ts)` where argsText is `/path/to/file.ts`.
         */
        argsText?: string;
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

    /** Human-readable description of what the tool does */
    description: string;

    /** Zod schema defining the input parameters */
    inputSchema: TSchema;

    /** The actual function that executes the tool - input is validated by Zod before execution */
    execute(input: z.output<TSchema>, context: ToolExecutionContext): Promise<unknown> | unknown;

    /**
     * Optional grouped approval-related behavior.
     */
    approval?: ToolApproval<TSchema> | undefined;

    /**
     * Optional grouped UI/presentation-related behavior.
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

    // NOTE: Legacy top-level approval/presentation hooks were removed.
    // All approval and UI behavior must be expressed via `tool.approval` and `tool.presentation`.
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
    /**
     * Optional rich preview used in approval prompts.
     *
     * CLI example:
     * - `edit_file` / `write_file`: shows a diff preview
     * - `bash_exec`: shows a shell command preview
     * - `plan_review`: shows the plan as a file preview
     */
    preview?(
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ): Promise<ToolDisplayData | null> | ToolDisplayData | null;

    /**
     * Describe the one-line tool call header for timelines and approval prompts.
     *
     * CLI example:
     * - Tool message header line: `Read(src/app.ts)`
     * - Here: header.title = "Read", header.argsText = "src/app.ts"
     */
    describeHeader?(
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ):
        | Promise<ToolPresentationSnapshotV1['header'] | null>
        | ToolPresentationSnapshotV1['header']
        | null;

    /**
     * Describe structured argument presentation for this tool call.
     *
     * Not currently rendered by the Ink CLI, but intended for future "expanded transcript"
     * views (e.g. Ctrl+O to inspect call details) and WebUI.
     *
     * Example (expanded details):
     * - label: "method", display: "POST"
     * - label: "timeout", display: "30s"
     */
    describeArgs?(
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ):
        | Promise<ToolPresentationSnapshotV1['args'] | null>
        | ToolPresentationSnapshotV1['args']
        | null;

    /**
     * Describe a short post-execution summary.
     *
     * CLI example:
     * - Tool result preview line (when supported): "Wrote 3 files" or "Request failed: 401"
     *
     * Note: This does not change the tool's actual returned data; it only affects optional
     * presentation metadata.
     */
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
