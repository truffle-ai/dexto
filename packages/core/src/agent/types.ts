/**
 * Type definitions for DextoAgent generate() and stream() APIs
 *
 * Re-uses existing types from context, llm/services, and events to avoid duplication.
 */

import type { ImageData, FileData } from '../context/types.js';
import type { LLMTokenUsage } from '../llm/services/types.js';

/**
 * Re-export existing types for convenience
 */
export type { ImageData as ImageInput, FileData as FileInput } from '../context/types.js';
export type { LLMTokenUsage as TokenUsage } from '../llm/services/types.js';

/**
 * Tool call information for agent streaming
 * Simplified version of tools/types.ts ToolCall for streaming context
 */
export interface AgentToolCall {
    toolName: string;
    args: Record<string, any>;
    callId: string;
    result?:
        | {
              success: boolean;
              data: any;
          }
        | undefined;
}

/**
 * Options for generate() method
 */
export interface GenerateOptions {
    sessionId: string;
    imageData?: ImageData | undefined;
    fileData?: FileData | undefined;
    signal?: AbortSignal | undefined; // For cancellation
}

/**
 * Complete response from generate() method
 */
export interface GenerateResponse {
    content: string;
    reasoning?: string | undefined; // Extended thinking for o1/o3 models
    usage: LLMTokenUsage;
    toolCalls: AgentToolCall[];
    sessionId: string;
}

/**
 * Options for stream() method (same as generate)
 *
 * Note: stream() now returns core StreamingEvent types directly from the event system.
 * See packages/core/src/events/index.ts for event definitions.
 */
export interface StreamOptions extends GenerateOptions {
    // Same options, but behavior is streaming
}
