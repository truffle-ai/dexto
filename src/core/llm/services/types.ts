import { LanguageModel } from 'ai';
import { ToolSet } from '../../tools/types.js';
import { ImageData, FileData } from '../../context/types.js';
import { LLMProvider, LLMRouter } from '../registry.js';
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
     */
    completeTask(
        textInput: string,
        options: { signal?: AbortSignal },
        imageData?: ImageData,
        fileData?: FileData,
        stream?: boolean
    ): Promise<string>;

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
