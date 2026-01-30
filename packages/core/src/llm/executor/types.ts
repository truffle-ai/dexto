import { TokenUsage } from '../types.js';
import { LLMFinishReason } from '../../events/index.js';

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
