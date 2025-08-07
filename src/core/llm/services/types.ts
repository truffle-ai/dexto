import { LanguageModelV1 } from 'ai';
import { ToolSet } from '../../tools/types.js';
import { ImageData, FileData } from '../../context/types.js';
import { LLMProvider, LLMRouter } from '../registry.js';

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
     * @param imageData Optional image data associated with the user input.
     * @param fileData Optional file data associated with the user input.
     * @returns A promise that resolves with the final text response from the AI.
     */
    completeTask(
        textInput: string,
        imageData?: ImageData,
        fileData?: FileData,
        stream?: boolean
    ): Promise<string>;

    // Get all available tools
    getAllTools(): Promise<ToolSet>;

    // Get configuration information about the LLM service
    getConfig(): LLMServiceConfig;
}

/**
 * Configuration object returned by LLMService.getConfig()
 */
export type LLMServiceConfig = {
    router: LLMRouter;
    provider: LLMProvider;
    model: string | LanguageModelV1;
    configuredMaxInputTokens?: number | null;
    modelMaxInputTokens?: number | null;
};
