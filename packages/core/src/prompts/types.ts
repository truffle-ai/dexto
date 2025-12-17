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
 * MCP-compliant prompt definition
 * Matches the MCP SDK's Prompt structure
 */
export interface PromptDefinition {
    name: string;
    title?: string | undefined;
    description?: string | undefined;
    arguments?: PromptArgument[] | undefined;
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
