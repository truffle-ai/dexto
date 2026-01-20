import type { InternalMessage } from '../../context/types.js';
import { TokenUsage } from '../types.js';
import { LLMFinishReason } from '../../events/index.js';

/**
 * Data captured during context compaction for session-native continuation.
 * This is passed through the call chain so the new session can be created
 * with the summary and preserved messages.
 */
export interface CompactionData {
    /** The generated summary text */
    summaryText: string;
    /** Messages preserved (not summarized) - typically last N turns */
    preservedMessages: InternalMessage[];
    /** Number of messages that were summarized */
    summarizedCount: number;
    /** Timestamp of first summarized message */
    originalFirstTimestamp?: number;
    /** Timestamp of last summarized message */
    originalLastTimestamp?: number;
}

export interface ExecutorResult {
    /**
     * The accumulated text from assistant responses.
     * TODO: Some LLMs are multimodal and can generate non-text content (images, audio, etc.).
     * Consider extending this to support multimodal output in the future.
     */
    text: string;
    /** Number of steps executed */
    stepCount: number;
    /** Token usage from the last step */
    usage: TokenUsage | null;
    /** Reason the execution finished */
    finishReason: LLMFinishReason;
    /**
     * Set to true if context compaction occurred during this turn.
     * Caller can use this to trigger session-native continuation (create new session).
     */
    didCompact: boolean;
    /**
     * Compaction data when didCompact is true.
     * Contains the summary text and preserved messages for creating the continuation session.
     */
    compaction?: CompactionData;
}

export interface StreamProcessorResult {
    /**
     * The accumulated text from text-delta events.
     * TODO: Some LLMs are multimodal and can generate non-text content (images, audio, etc.).
     * Consider extending this to support multimodal output in the future.
     */
    text: string;
    finishReason: LLMFinishReason;
    usage: TokenUsage;
}
