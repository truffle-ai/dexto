import { ITokenizer, TokenizationError } from './types.js';
import { encoding_for_model, get_encoding, Tiktoken, TiktokenModel } from 'tiktoken';
import { logger } from '../../logger/index.js';

// Fallback encoding name if model is not supported by tiktoken
const FALLBACK_ENCODING = 'cl100k_base'; // Encoding used by GPT-4, GPT-3.5 Turbo, GPT-4o etc.

/**
 * Tokenizer for OpenAI models using the tiktoken library.
 * Attempts to use the specific model's encoding, falls back to a common base encoding ('cl100k_base')
 * for unknown or custom model names (often used with custom baseURLs).
 */
export class OpenAITokenizer implements ITokenizer {
    private modelName: string; // Store original model name for context/logging
    private encoding: Tiktoken; // Tiktoken encoding instance

    /**
     * Initializes the tokenizer for a specific OpenAI model or compatible model.
     * @param model The OpenAI model name (e.g., 'gpt-4o') or a custom model name.
     * @throws TokenizationError if tiktoken initialization fails for both specific model and fallback.
     */
    constructor(model: string) {
        this.modelName = model;
        try {
            // 1. Try to get encoding for the specific model name
            this.encoding = encoding_for_model(model as TiktokenModel);
            logger.debug(`Initialized tiktoken with specific encoding for model: ${model}`);
        } catch (error) {
            // 2. If specific model encoding fails, fall back to cl100k_base
            logger.warn(
                `Could not get specific encoding for model '${this.modelName}'. Falling back to '${FALLBACK_ENCODING}'. Error: ${error instanceof Error ? error.message : String(error)}`
            );
            try {
                this.encoding = get_encoding(FALLBACK_ENCODING);
                logger.debug(`Initialized tiktoken with fallback encoding: ${FALLBACK_ENCODING}`);
            } catch (fallbackError) {
                // 3. If fallback also fails (very unlikely), then throw
                logger.error(
                    `Failed to initialize tiktoken with specific model '${this.modelName}' or fallback '${FALLBACK_ENCODING}'.`,
                    fallbackError
                );
                throw new TokenizationError(
                    `Failed to initialize tiktoken for model '${this.modelName}' using specific or fallback encoding ('${FALLBACK_ENCODING}'): ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
                );
            }
        }
    }

    /**
     * Counts the tokens in the text using the determined encoding.
     * @param text Text content to count tokens for
     * @returns Number of tokens
     * @throws TokenizationError if encoding fails during counting.
     */
    countTokens(text: string): number {
        if (!text) return 0;
        try {
            const tokens = this.encoding.encode(text);
            return tokens.length;
        } catch (error) {
            logger.error(
                `Tiktoken encoding failed for model ${this.modelName} (using encoding: ${this.encoding.name}):`,
                error
            );
            throw new TokenizationError(
                `Encoding failed for text snippet using model ${this.modelName}.`
            );
        }
    }

    /**
     * Cleans up the tiktoken encoding instance when done.
     * Recommended by tiktoken library.
     */
    free(): void {
        if (this.encoding) {
            this.encoding.free();
        }
    }

    getProviderName(): string {
        return 'openai';
    }
}
