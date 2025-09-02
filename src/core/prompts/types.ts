import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Represents a prompt with metadata
 */
export interface PromptInfo {
    name: string;
    description?: string;
    source: 'mcp' | 'internal';
    metadata?: Record<string, unknown>;
}

/**
 * Set of prompts indexed by name
 */
export type PromptSet = Record<string, PromptInfo>;

/**
 * Interface for prompt providers
 */
export interface PromptProvider {
    /**
     * Get the source identifier for this provider
     */
    getSource(): string;

    /**
     * List all available prompts from this provider
     */
    listPrompts(): Promise<PromptInfo[]>;

    /**
     * Get a specific prompt by name
     */
    getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult>;

    /**
     * Check if a prompt exists
     */
    hasPrompt(name: string): Promise<boolean>;
}
