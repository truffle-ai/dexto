import type { ValidatedLLMConfig } from '../llm/schemas.js';
import type { Logger } from '../logger/v2/types.js';
import type { SessionManager } from '../session/index.js';
import type { MCPManager } from '../mcp/manager.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { AgentEventBus } from '../events/index.js';
import type { StorageManager } from '../storage/index.js';

/**
 * Extension point names - fixed for MVP
 * These are the 4 hook sites from PR #385 converted to generic plugin extension points
 */
export type ExtensionPoint =
    | 'beforeLLMRequest'
    | 'beforeToolCall'
    | 'afterToolResult'
    | 'beforeResponse';

/**
 * Plugin result - what plugins return from extension point methods
 */
export interface PluginResult {
    /** Did plugin execute successfully? */
    ok: boolean;

    /** Partial modifications to apply to payload */
    modify?: Record<string, unknown>;

    /** Should execution stop? (Only respected if plugin is blocking) */
    cancel?: boolean;

    /** User-facing message (shown when cancelled) */
    message?: string;

    /** Notices for logging/events */
    notices?: PluginNotice[];
}

/**
 * Plugin notice - for logging and user feedback
 */
export interface PluginNotice {
    kind: 'allow' | 'block' | 'warn' | 'info';
    code?: string;
    message: string;
    details?: Record<string, unknown>;
}

/**
 * Execution context passed to every plugin method
 * Contains runtime state and read-only access to agent services
 */
export interface PluginExecutionContext {
    /** Current session ID */
    sessionId?: string | undefined;

    /** User ID (set by application layer via AsyncLocalStorage) */
    userId?: string | undefined;

    /** Tenant ID (set by application layer for multi-tenant deployments via AsyncLocalStorage) */
    tenantId?: string | undefined;

    /** Current LLM configuration */
    llmConfig: ValidatedLLMConfig;

    /** Logger scoped to this plugin execution */
    logger: Logger;

    /** Abort signal for cancellation */
    abortSignal?: AbortSignal | undefined;

    /** Reference to agent services (read-only access) */
    agent: {
        readonly sessionManager: SessionManager;
        readonly mcpManager: MCPManager;
        readonly toolManager: ToolManager;
        readonly stateManager: AgentStateManager;
        readonly agentEventBus: AgentEventBus;
        readonly storageManager: StorageManager;
    };
}

/**
 * Payload for beforeLLMRequest extension point
 */
export interface BeforeLLMRequestPayload {
    text: string;
    imageData?: { image: string; mimeType: string };
    fileData?: { data: string; mimeType: string; filename?: string };
    sessionId?: string;
}

/**
 * Payload for beforeToolCall extension point
 */
export interface BeforeToolCallPayload {
    toolName: string;
    args: Record<string, unknown>;
    sessionId?: string;
    callId?: string;
}

/**
 * Payload for afterToolResult extension point
 */
export interface AfterToolResultPayload {
    toolName: string;
    result: unknown;
    success: boolean;
    sessionId?: string;
    callId?: string;
}

/**
 * Payload for beforeResponse extension point
 */
export interface BeforeResponsePayload {
    content: string;
    reasoning?: string;
    provider: string;
    model?: string;
    tokenUsage?: { input: number; output: number };
    sessionId?: string;
}

/**
 * Main plugin type - implement any subset of these methods
 * All methods are optional - plugin must implement at least one extension point
 */
export type Plugin = {
    /** Called once at plugin initialization (before agent starts) */
    initialize?(config: Record<string, unknown>): Promise<void>;

    /** Extension point: before LLM request */
    beforeLLMRequest?(
        payload: BeforeLLMRequestPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult>;

    /** Extension point: before tool call */
    beforeToolCall?(
        payload: BeforeToolCallPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult>;

    /** Extension point: after tool result */
    afterToolResult?(
        payload: AfterToolResultPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult>;

    /** Extension point: before response */
    beforeResponse?(
        payload: BeforeResponsePayload,
        context: PluginExecutionContext
    ): Promise<PluginResult>;

    /** Called when agent shuts down (cleanup) */
    cleanup?(): Promise<void>;
};

/**
 * Plugin configuration from YAML (custom plugins)
 */
export interface PluginConfig {
    name: string;
    module: string;
    enabled: boolean;
    blocking: boolean;
    priority: number;
    config?: Record<string, unknown> | undefined;
}

/**
 * Loaded plugin with its configuration
 * Internal type used by PluginManager
 */
export interface LoadedPlugin {
    plugin: Plugin;
    config: PluginConfig;
}
