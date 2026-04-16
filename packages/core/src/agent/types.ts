/**
 * Type definitions for DextoAgent generate() and stream() APIs
 *
 * Re-uses existing types from context, llm/services, and events to avoid duplication.
 */

import type { ContentPart } from '../context/types.js';
import type { LLMTokenUsage } from '../llm/services/types.js';
import type { LLMProvider, LLMPricingStatus } from '../llm/types.js';
import type { HostRuntimeContext } from '../runtime/index.js';

/**
 * Re-export content part types for API consumers
 */
export type {
    ContentPart,
    TextPart,
    ImagePart,
    FilePart,
    ImageData,
    FileData,
} from '../context/types.js';
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
 * Content input for generate() and stream() methods.
 * Can be a simple string (for text-only messages) or an array of ContentPart (for multimodal).
 *
 * @example
 * ```typescript
 * // Simple text
 * agent.generate('What is 2+2?', sessionId);
 *
 * // Multimodal with image
 * agent.generate([
 *     { type: 'text', text: 'Describe this image' },
 *     { type: 'image', image: base64Data, mimeType: 'image/png' }
 * ], sessionId);
 * ```
 */
export type ContentInput = string | ContentPart[];

/**
 * Host-owned execution-scoped correlation IDs for a single generate/stream invocation.
 *
 * These values should be supplied by the host per run/attempt and are intentionally
 * separate from agent/session configuration.
 */
export type AgentExecutionContext = HostRuntimeContext;

/**
 * Options for generate() and stream() methods
 */
export interface GenerateOptions {
    /** AbortSignal for cancellation */
    signal?: AbortSignal;
    /** Optional signal to stop streaming to the caller without cancelling the run itself */
    disconnectSignal?: AbortSignal;
    /** Optional host-owned execution context for this single invocation */
    executionContext?: AgentExecutionContext;
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
    messageId?: string;
    usageScopeId?: string;
    provider?: LLMProvider;
    model?: string;
    estimatedCost?: number;
    pricingStatus?: LLMPricingStatus;
    hostRuntime?: HostRuntimeContext;
}

/**
 * Options for stream() method (same as generate)
 *
 * Note: stream() now returns core StreamingEvent types directly from the event system.
 * See packages/core/src/events/index.ts for event definitions.
 */
export type StreamOptions = GenerateOptions;
