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
    sessionId?: string | undefined;
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
    messageId: string;
}

/**
 * Options for stream() method (same as generate)
 */
export interface StreamOptions extends GenerateOptions {
    // Same options, but behavior is streaming
}

/**
 * Stream event types for agent.stream() AsyncIterator
 */
export type StreamEvent =
    | MessageStartEvent
    | ThinkingEvent
    | ContentChunkEvent
    | ToolUseEvent
    | ToolResultEvent
    | ApprovalRequestEvent
    | ApprovalResponseEvent
    | MessageCompleteEvent
    | ErrorEvent;

/**
 * Message stream started
 */
export interface MessageStartEvent {
    type: 'message-start';
    messageId: string;
    sessionId: string;
    timestamp: number;
}

/**
 * Agent is thinking (before generating content)
 */
export interface ThinkingEvent {
    type: 'thinking';
}

/**
 * Content chunk received from LLM
 */
export interface ContentChunkEvent {
    type: 'content-chunk';
    delta: string; // Incremental text chunk
    chunkType: 'text' | 'reasoning'; // Regular text or extended thinking
    isComplete?: boolean | undefined; // If true, this is the last chunk of this type
}

/**
 * Tool call requested by LLM
 */
export interface ToolUseEvent {
    type: 'tool-use';
    toolName: string;
    args: Record<string, any>;
    callId: string;
}

/**
 * Tool execution result
 */
export interface ToolResultEvent {
    type: 'tool-result';
    callId: string;
    success: boolean;
    result: any;
    error?: string;
}

/**
 * Approval requested (Human-in-the-loop)
 */
export interface ApprovalRequestEvent {
    type: 'approval-request';
    approvalId: string;
    approvalType: string; // e.g. 'tool_confirmation', 'command_confirmation', 'elicitation'
    timestamp: string;
    metadata?: Record<string, any>;
    sessionId: string;
}

/**
 * Approval response received/processed
 */
export interface ApprovalResponseEvent {
    type: 'approval-response';
    approvalId: string;
    status: 'approved' | 'denied';
    sessionId: string;
}

/**
 * Message generation complete
 */
export interface MessageCompleteEvent {
    type: 'message-complete';
    messageId: string;
    content: string; // Full content
    reasoning?: string | undefined; // Full reasoning (if applicable)
    usage: LLMTokenUsage;
    toolCalls: AgentToolCall[];
}

/**
 * Error during message processing
 */
export interface ErrorEvent {
    type: 'error';
    error: Error;
    recoverable: boolean; // If true, stream may continue; if false, stream is terminated
    context?: string | undefined; // Additional context about where error occurred
}
