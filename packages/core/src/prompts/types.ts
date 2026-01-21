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
    /** Tools allowed when this prompt is active (overrides global policies) */
    allowedTools?: string[] | undefined;
    /** Model to use when this prompt is invoked */
    model?: string | undefined;
}

/**
 * Enhanced prompt info with MCP-compliant structure
 */
export interface PromptInfo extends PromptDefinition {
    source: 'mcp' | 'config' | 'custom';
    /** User-friendly display name without namespace prefix (e.g., "quick-start" instead of "config:quick-start") */
    displayName?: string | undefined;
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
    /** Tools allowed when this prompt is active (overrides global policies) */
    allowedTools?: string[] | undefined;
    /** Model to use when this prompt is invoked */
    model?: string | undefined;
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
