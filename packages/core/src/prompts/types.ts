import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP-compliant prompt argument definition
 * Matches the MCP SDK's Prompt.arguments structure
 */
export interface PromptArgument {
    name: string;
    description?: string | undefined;
    required?: boolean | undefined;
}

/**
 * MCP-compliant prompt definition with Dexto extensions
 * Base structure matches MCP SDK's Prompt, extended with Claude Code compatibility fields
 */
export interface PromptDefinition {
    name: string;
    title?: string | undefined;
    description?: string | undefined;
    arguments?: PromptArgument[] | undefined;
    // Claude Code compatibility fields (Phase 1)
    /** Exclude from auto-invocation list in system prompt */
    disableModelInvocation?: boolean | undefined;
    /** Show in slash command menu (false = hidden but auto-invocable by LLM) */
    userInvocable?: boolean | undefined;
    // Per-prompt overrides (Phase 2)
    /** Tools to auto-approve when this prompt is active (additive) */
    allowedTools?: string[] | undefined;
    /** Toolkits to load when this prompt is invoked */
    toolkits?: string[] | undefined;
    /** Model to use when this prompt is invoked */
    model?: string | undefined;
    /** Execution context: 'inline' runs in current session, 'fork' spawns isolated subagent */
    context?: 'inline' | 'fork' | undefined;
    /** Agent ID from registry to use for fork execution */
    agent?: string | undefined;
}

/**
 * Enhanced prompt info with MCP-compliant structure
 *
 * ## Naming Convention
 *
 * Prompts have three name fields that serve different purposes:
 *
 * - **name**: Internal identifier used for resolution. May include prefixes like
 *   "config:namespace:id" for config prompts or just "promptName" for MCP/custom.
 *
 * - **displayName**: User-friendly base name without system prefixes. Set by providers
 *   to just the skill/prompt id (e.g., "plan" not "config:tools:plan"). For MCP and
 *   custom prompts, this equals `name` since they have no internal prefixes.
 *
 * - **commandName**: Collision-resolved slash command name computed by PromptManager.
 *   If multiple prompts share the same displayName, commandName adds a source prefix
 *   (e.g., "config:plan" vs "mcp:plan"). Otherwise, commandName equals displayName.
 *
 * UI components should use `commandName` for display and execution.
 */
export interface PromptInfo extends PromptDefinition {
    source: 'mcp' | 'config' | 'custom';
    /** Base display name set by provider (e.g., "plan"). May equal `name` for simple prompts. */
    displayName?: string | undefined;
    /** Collision-resolved command name computed by PromptManager (e.g., "plan" or "config:plan") */
    commandName?: string | undefined;
    /** Execution context: 'inline' runs in current session, 'fork' spawns isolated subagent */
    context?: 'inline' | 'fork' | undefined;
    /** Agent ID from registry to use for fork execution */
    agent?: string | undefined;
    metadata?: Record<string, unknown>;
}

/**
 * Set of prompts indexed by name
 */
export type PromptSet = Record<string, PromptInfo>;

/**
 * Result for prompt listing (pagination not currently implemented)
 */
export interface PromptListResult {
    prompts: PromptInfo[];
    nextCursor?: string | undefined;
}

/**
 * Result type for resolvePrompt including optional per-prompt overrides
 */
export interface ResolvedPromptResult {
    /** The resolved prompt text with arguments applied */
    text: string;
    /** Resource URIs referenced by the prompt */
    resources: string[];
    /** Tools to auto-approve when this prompt is active (additive) */
    allowedTools?: string[] | undefined;
    /** Toolkits to load when this prompt is invoked */
    toolkits?: string[] | undefined;
    /** Model to use when this prompt is invoked */
    model?: string | undefined;
    /** Execution context: 'inline' runs in current session, 'fork' spawns isolated subagent */
    context?: 'inline' | 'fork' | undefined;
    /** Agent ID from registry to use for fork execution */
    agent?: string | undefined;
}

/**
 * Interface for prompt providers
 */
export interface PromptProvider {
    /**
     * Get the source identifier for this provider
     */
    getSource(): string;

    /**
     * Invalidate the provider's internal cache
     */
    invalidateCache(): void;

    /**
     * List all available prompts from this provider
     */
    listPrompts(cursor?: string): Promise<PromptListResult>;

    /**
     * Get a specific prompt by name
     */
    getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult>;

    /**
     * Get prompt definition (metadata only)
     */
    getPromptDefinition(name: string): Promise<PromptDefinition | null>;
}
