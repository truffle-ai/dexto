import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP-compliant prompt argument definition
 */
export interface PromptArgument {
    name: string;
    description?: string;
    // Optional to accommodate providers that omit it; treat as false when missing
    required?: boolean;
}

/**
 * MCP-compliant prompt definition
 */
export interface PromptDefinition {
    name: string;
    title?: string | undefined;
    description?: string | undefined;
    arguments?: PromptArgument[] | undefined;
}

/**
 * Content types for prompt messages as per MCP spec
 */
export type PromptContentType = 'text' | 'image' | 'audio' | 'resource';

/**
 * Base content interface for prompt messages
 */
export interface PromptContent {
    type: PromptContentType;
}

/**
 * Text content for prompt messages
 */
export interface TextContent extends PromptContent {
    type: 'text';
    text: string;
}

/**
 * Image content for prompt messages
 */
export interface ImageContent extends PromptContent {
    type: 'image';
    data: string; // base64-encoded image data
    mimeType: string;
}

/**
 * Audio content for prompt messages
 */
export interface AudioContent extends PromptContent {
    type: 'audio';
    data: string; // base64-encoded audio data
    mimeType: string;
}

/**
 * Embedded resource content for prompt messages
 */
export interface ResourceContent extends PromptContent {
    type: 'resource';
    resource: {
        uri: string;
        name: string;
        title?: string;
        mimeType: string;
        text?: string;
        data?: string; // base64-encoded blob data
    };
}

/**
 * Union type for all content types
 */
export type PromptMessageContent = TextContent | ImageContent | AudioContent | ResourceContent;

/**
 * Prompt message structure as per MCP spec
 */
export interface PromptMessage {
    role: 'user' | 'assistant';
    content: PromptMessageContent;
}

/**
 * Enhanced prompt info with MCP-compliant structure
 */
export interface PromptInfo extends PromptDefinition {
    source: 'mcp' | 'internal' | 'starter';
    metadata?: Record<string, unknown>;
}

/**
 * Set of prompts indexed by name
 */
export type PromptSet = Record<string, PromptInfo>;

/**
 * Pagination support for prompt listing
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
     * List all available prompts from this provider with pagination support
     */
    listPrompts(cursor?: string): Promise<PromptListResult>;

    /**
     * Get a specific prompt by name
     */
    getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult>;

    /**
     * Check if a prompt exists
     */
    hasPrompt(name: string): Promise<boolean>;

    /**
     * Get prompt definition (metadata only)
     */
    getPromptDefinition(name: string): Promise<PromptDefinition | null>;
}
