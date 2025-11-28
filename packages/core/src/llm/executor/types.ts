/**
 * Types for the new execution loop architecture.
 *
 * Part of context management refactor v2.
 * @see /complete-context-management-plan.md
 */

import type { InternalMessage } from '../../context/types.js';
import type { ITokenizer } from '../tokenizer/types.js';

// ============================================================================
// Compression Strategy Types
// ============================================================================

/**
 * Defines when a compression strategy should be triggered.
 */
export type CompressionTrigger =
    | { type: 'overflow' } // Trigger after actual overflow detected from API response
    | { type: 'threshold'; percentage: number } // Trigger at percentage of context window
    | { type: 'manual' }; // Only trigger on explicit request

/**
 * New compression strategy interface with trigger configuration.
 * Replaces the old ICompressionStrategy from compression/types.ts.
 */
export interface ICompressionStrategy {
    /** Unique name for logging and config */
    readonly name: string;

    /** When this strategy should be triggered */
    readonly trigger: CompressionTrigger;

    /**
     * Compress the provided message history.
     *
     * @param history The current conversation history.
     * @param tokenizer The tokenizer used to calculate message tokens.
     * @param maxInputTokens The maximum number of tokens allowed in the history.
     * @returns The compressed message history (may be async for LLM-based strategies).
     */
    compress(
        history: InternalMessage[],
        tokenizer: ITokenizer,
        maxInputTokens: number
    ): InternalMessage[] | Promise<InternalMessage[]>;

    /**
     * Optional validation that compression was effective.
     * Returns true if compression is considered successful.
     *
     * @param beforeTokens Token count before compression
     * @param afterTokens Token count after compression
     */
    validate?(beforeTokens: number, afterTokens: number): boolean;
}

// ============================================================================
// Message Queue Types (Multimodal Support)
// ============================================================================

/**
 * Content part for queued user messages.
 * Supports text, images, and files.
 */
export type UserMessageContentPart =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string | Uint8Array; mediaType?: string }
    | { type: 'file'; data: string | Uint8Array; mediaType: string; filename?: string };

/**
 * A message waiting in the queue to be injected into the conversation.
 */
export interface QueuedMessage {
    /** Unique identifier for this queued message */
    id: string;

    /** Multimodal content parts (text, images, files) */
    content: UserMessageContentPart[];

    /** Timestamp when the message was queued */
    queuedAt: number;

    /** Optional metadata from the original request */
    metadata?: Record<string, unknown>;
}

/**
 * Result of coalescing multiple queued messages into one.
 */
export interface CoalescedMessage {
    /** Original messages that were coalesced */
    messages: QueuedMessage[];

    /** Combined content with numbered separators */
    combinedContent: UserMessageContentPart[];

    /** Timestamp of the first queued message */
    firstQueuedAt: number;

    /** Timestamp of the last queued message */
    lastQueuedAt: number;
}

// ============================================================================
// TurnExecutor Types
// ============================================================================

/**
 * Configuration for TurnExecutor.
 */
export interface TurnExecutorConfig {
    /** Maximum number of steps (LLM calls) per turn */
    maxSteps: number;

    /** Maximum characters per tool output (truncation limit) */
    maxToolOutputChars: number;

    /** Per-tool output limits (overrides maxToolOutputChars) */
    toolOutputLimits?: Record<string, number>;
}

/**
 * Result of a single turn execution.
 */
export interface TurnResult {
    /** Final text response from the LLM */
    text: string;

    /** Optional reasoning text (if model supports it) */
    reasoning?: string;

    /** How the turn ended */
    finishReason: 'stop' | 'tool-calls' | 'max-steps' | 'abort' | 'error';

    /** Token usage for this turn */
    usage: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens?: number;
        totalTokens: number;
    };

    /** Number of steps executed */
    stepsExecuted: number;

    /** Whether compression was triggered during this turn */
    compressionTriggered: boolean;
}

// ============================================================================
// Tool Result Extensions
// ============================================================================

/**
 * Extended tool result metadata for pruning support.
 * When compactedAt is set, the tool output should be replaced with a placeholder.
 */
export interface ToolResultMetadata {
    /** Timestamp when the tool output was compacted (pruned) */
    compactedAt?: number;
}
