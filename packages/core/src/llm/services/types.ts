import { LanguageModel } from 'ai';
import { ToolSet } from '../../tools/types.js';
import { ImageData, FileData } from '../../context/types.js';
import type { LLMProvider, LLMRouter } from '../types.js';
import type { ContextManager } from '../../context/manager.js';

/**
 * Core interface for LLM service implementations
 */
export interface ILLMService {
    /**
     * Process a user's task (e.g., text input, potentially with image or file data)
     * and return the final AI response.
     * Handles potential tool calls and conversation management internally.
     *
     * @param textInput The primary text input from the user.
     * @param options Options object with signal for cancellation. Always passed from chat session.
     * @param imageData Optional image data associated with the user input.
     * @param fileData Optional file data associated with the user input.
     * @param stream Optional flag to enable streaming response.
     * @returns A promise that resolves with the final text response from the AI.
     * @deprecated Use streamTask() for streaming, or use this without stream flag for non-streaming
     */
    completeTask(
        textInput: string,
        options: { signal?: AbortSignal },
        imageData?: ImageData,
        fileData?: FileData,
        stream?: boolean
    ): Promise<string>;

    /**
     * Stream a user's task and yield events as they occur.
     * This is the preferred method for streaming responses.
     *
     * TODO: Implement this method in all LLM services to move away from EventBus side effects.
     * Currently, DextoAgent aggregates EventBus events into AsyncIterator at the top level.
     * Future refactor should push AsyncIterator down to LLM service level for cleaner architecture.
     *
     * @param textInput The primary text input from the user.
     * @param options Options object with signal for cancellation.
     * @param imageData Optional image data associated with the user input.
     * @param fileData Optional file data associated with the user input.
     * @returns An async iterator that yields LLMStreamEvent objects
     */
    streamTask?(
        textInput: string,
        options: { signal?: AbortSignal },
        imageData?: ImageData,
        fileData?: FileData
    ): AsyncIterator<LLMStreamEvent>;

    // Get all available tools
    getAllTools(): Promise<ToolSet>;

    // Get configuration information about the LLM service
    getConfig(): LLMServiceConfig;

    // Get the context manager for external access (e.g., for history retrieval)
    // Returns ContextManager<unknown> since external users don't need specific type
    getContextManager(): ContextManager<unknown>;
}

/**
 * Configuration object returned by LLMService.getConfig()
 */
export type LLMServiceConfig = {
    router: LLMRouter;
    provider: LLMProvider;
    model: LanguageModel;
    configuredMaxInputTokens?: number | null;
    modelMaxInputTokens?: number | null;
};

/**
 * Token usage statistics from LLM
 */
export interface LLMTokenUsage {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    totalTokens: number;
}

/**
 * Tool call from LLM
 */
export interface LLMToolCall {
    toolName: string;
    args: Record<string, any>;
    callId: string;
}

/**
 * Tool result to send back to LLM
 */
export interface LLMToolResult {
    callId: string;
    success: boolean;
    result: any;
    error?: string;
}

/**
 * Stream event types emitted by streamTask()
 */
export type LLMStreamEvent =
    | LLMThinkingEvent
    | LLMContentChunkEvent
    | LLMToolUseEvent
    | LLMToolResultEvent
    | LLMCompleteEvent
    | LLMErrorEvent;

/**
 * LLM is thinking/processing
 */
export interface LLMThinkingEvent {
    type: 'thinking';
}

/**
 * Content chunk from LLM
 */
export interface LLMContentChunkEvent {
    type: 'content-chunk';
    delta: string;
    chunkType: 'text' | 'reasoning';
    isComplete?: boolean;
}

/**
 * LLM requested a tool call
 */
export interface LLMToolUseEvent {
    type: 'tool-use';
    toolName: string;
    args: Record<string, any>;
    callId: string;
}

/**
 * Tool execution result (sent back to LLM)
 */
export interface LLMToolResultEvent {
    type: 'tool-result';
    callId: string;
    success: boolean;
    result: any;
    error?: string;
}

/**
 * LLM response complete
 */
export interface LLMCompleteEvent {
    type: 'complete';
    content: string;
    reasoning?: string;
    usage: LLMTokenUsage;
    toolCalls: LLMToolCall[];
}

/**
 * Error during LLM processing
 */
export interface LLMErrorEvent {
    type: 'error';
    error: Error;
    recoverable: boolean;
    context?: string;
}
