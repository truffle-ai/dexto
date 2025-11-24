// ============================================================================
// SIMPLIFIED TOOL TYPES - Essential interfaces only
// ============================================================================

import type { JSONSchema7 } from 'json-schema';
import type { ZodSchema } from 'zod';

/**
 * Context passed to tool execution
 */
export interface ToolExecutionContext {
    /** Session ID if available */
    sessionId?: string | undefined;
}

// ============================================================================
// CORE TOOL INTERFACES
// ============================================================================

/**
 * Internal tool interface - for tools implemented within Dexto
 */
export interface InternalTool {
    /** Unique identifier for the tool */
    id: string;

    /** Human-readable description of what the tool does */
    description: string;

    /** Zod schema defining the input parameters */
    inputSchema: ZodSchema;

    /** The actual function that executes the tool - input is validated by Zod before execution */
    execute: (input: unknown, context?: ToolExecutionContext) => Promise<unknown> | unknown;
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
    data?: any;
    error?: string;
}

/**
 * Tool call representation
 */
export interface ToolCall {
    id: string;
    toolName: string;
    input: any;
    output?: any;
    error?: string;
    duration?: number;
}

/**
 * Interface for any provider of tools
 */
export interface ToolProvider {
    getTools(): Promise<ToolSet>;
    callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}
