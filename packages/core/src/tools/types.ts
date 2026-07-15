// ============================================================================
// SIMPLIFIED TOOL TYPES - Essential interfaces only
// ============================================================================

import type { JSONSchema7 } from 'json-schema';
import type { z, ZodTypeAny } from 'zod';
import type { ToolDisplayData } from './display-types.js';
import type { ToolActivityPresentation } from './activity.js';
import type { ToolPresentationSnapshotV1 } from './presentation-schema.js';
import type { WorkspaceContext } from '../workspace/types.js';
import type { ApprovalManager } from '../approval/manager.js';
import type { DextoAgent } from '../agent/DextoAgent.js';
import type { ToolStateStore } from '../storage/index.js';
import type { MCPManager } from '../mcp/manager.js';
import type { PromptManager } from '../prompts/prompt-manager.js';
import type { ResourceManager } from '../resources/manager.js';
import type { SearchService } from '../search/search-service.js';
import type { Logger } from '../logger/v2/types.js';
import type { HostRuntimeContext } from '../runtime/index.js';
import type { AgentRunContext } from '../runtime/run-context.js';
import type { SkillManager } from '../skills/index.js';
import type { WorkspaceManager } from '../workspace/index.js';

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
    skills: SkillManager;
    mcp: MCPManager;
    taskForker: TaskForker | null;
    workspaceManager: WorkspaceManager;
}

/**
 * Context passed to tool execution
 */
export interface ToolExecutionContextBase {
    /** Session ID if available */
    sessionId?: string | undefined;
    /** Internal run-scoped execution context for this tool invocation */
    runContext?: AgentRunContext | undefined;
    /** Workspace ID if available */
    workspaceId?: string | undefined;
    /** Workspace context if available */
    workspace?: WorkspaceContext | undefined;
    /** Abort signal for cancellation support */
    abortSignal?: AbortSignal | undefined;
    /** Unique tool call ID for tracking parallel tool calls */
    toolCallId?: string | undefined;
    /** Host-owned runtime IDs for orchestration and correlation */
    hostRuntime?: HostRuntimeContext | undefined;

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

    /** Durable state store scoped for tool-owned data. */
    toolState?: ToolStateStore | undefined;

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
    /** Optional non-execution metadata carried through the tool lifecycle */
    meta?: import('./tool-call-metadata.js').ToolCallMetadata;
    /** Whether this tool required user approval before execution */
    requireApproval?: boolean;
    /** The approval status (only present if requireApproval is true) */
    approvalStatus?: 'approved' | 'rejected';
}

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

    /**
     * Optional dynamic description for LLM tool discovery.
     * Use when the tool description depends on runtime context such as the active workspace.
     */
    getDescription?: ((context: ToolExecutionContext) => Promise<string> | string) | undefined;

    /** Zod schema defining the input parameters */
    inputSchema: TSchema;

    /** The actual function that executes the tool - input is validated by Zod before execution */
    execute(input: z.output<TSchema>, context: ToolExecutionContext): Promise<unknown> | unknown;

    /**
     * Optional per-call approval policy.
     *
     * - `false` / `null`: this tool call does not need approval.
     * - `true`: this tool call needs approval without a reusable key.
     * - `string`: this tool call needs approval scoped to an opaque key owned by the tool.
     *
     * Core stores and checks keys opaquely; tool packages decide what keys mean.
     */
    needsApproval?: ToolNeedsApproval<TSchema> | undefined;

    /**
     * Optional grouped UI/presentation-related behavior.
     */
    presentation?: ToolPresentation<TSchema> | undefined;

    /**
     * Optional aliases for this tool id.
     *
     * Used when external tool catalogs refer to tools by short names
     * (e.g. Claude Code "bash", "read", "grep"). Aliases are resolved
     * by {@link ToolManager} when applying tool approval policy lists.
     */
    aliases?: string[] | undefined;

    // NOTE: Approval policy is intentionally a simple function/bool/string.
    // Presentation-specific behavior belongs in `tool.presentation`.
}

export type ToolApprovalDecision = boolean | string | null;

export type ToolNeedsApproval<TSchema extends ZodTypeAny = ZodTypeAny> =
    | ToolApprovalDecision
    | ((
          input: z.output<TSchema>,
          context: ToolExecutionContext
      ) => Promise<ToolApprovalDecision> | ToolApprovalDecision);

export interface ToolPresentation<TSchema extends ZodTypeAny = ZodTypeAny> {
    /** Deterministic lifecycle copy and aggregation grammar for this first-party tool. */
    activity?: ToolActivityPresentation;

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

    /**
     * Override the call-time activity after execution using validated structured display data.
     * Use this when the final operation is only known from the result, such as write_file
     * resolving to either file creation or file editing.
     */
    describeResultActivity?(
        display: ToolDisplayData | undefined,
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ): Promise<ToolActivityPresentation | null> | ToolActivityPresentation | null;
}

export type { ToolActivityCategory, ToolActivityPresentation } from './activity.js';
export type { ToolPresentationSnapshotV1 } from './presentation-schema.js';

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
    callTool(
        toolName: string,
        args: Record<string, unknown>,
        context?: Pick<ToolExecutionContextBase, 'sessionId' | 'runContext'>
    ): Promise<unknown>;
}
