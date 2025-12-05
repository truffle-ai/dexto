import { ITokenizer, TokenizationError } from './types.js';
import type { Tiktoken, TiktokenModel } from 'tiktoken';
import { createRequire } from 'module';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';

// Fallback encoding name if model is not supported by tiktoken
const FALLBACK_ENCODING = 'cl100k_base'; // Encoding used by GPT-4, GPT-3.5 Turbo, GPT-4o etc.

/**
 * Tokenizer for OpenAI models using the tiktoken library.
 *
 * TODO: Make tiktoken an optional peer dependency to reduce package size by ~23MB
 * tiktoken includes WASM binaries (5.3MB) and encoder data files (16MB).
 * It's only needed for accurate pre-request token estimation for OpenAI models.
 * - All providers return actual token counts in API responses
 * - Anthropic/Google/others already use simple text.length/4 approximation
 * - Consider falling back to DefaultTokenizer if tiktoken is not installed
 * See: packages/core/src/llm/tokenizer/factory.ts
 * Attempts to use the specific model's encoding, falls back to a common base encoding ('cl100k_base')
 * for unknown or custom model names (often used with custom baseURLs).
 */
export class OpenAITokenizer implements ITokenizer {
    private modelName: string; // Store original model name for context/logging
    private encoding: Tiktoken; // Tiktoken encoding instance
    private logger: IDextoLogger;

    /**
     * Initializes the tokenizer for a specific OpenAI model or compatible model.
     * @param model The OpenAI model name (e.g., 'gpt-5') or a custom model name.
     * @param logger The logger instance for logging.
     * @throws TokenizationError if tiktoken initialization fails for both specific model and fallback.
     */
    constructor(model: string, logger: IDextoLogger) {
        this.modelName = model;
        this.logger = logger.createChild(DextoLogComponent.LLM);
        try {
            // 1. Try to get encoding for the specific model name
            const { encoding_for_model } = loadTiktoken();
            this.encoding = encoding_for_model(model as TiktokenModel);
            this.logger.debug(`Initialized tiktoken with specific encoding for model: ${model}`);
        } catch (error) {
            // 2. If specific model encoding fails, fall back to cl100k_base
            this.logger.warn(
                `Could not get specific encoding for model '${this.modelName}'. Falling back to '${FALLBACK_ENCODING}'. Error: ${error instanceof Error ? error.message : String(error)}`
            );
            try {
                const { get_encoding } = loadTiktoken();
                this.encoding = get_encoding(FALLBACK_ENCODING);
                this.logger.debug(
                    `Initialized tiktoken with fallback encoding: ${FALLBACK_ENCODING}`
                );
            } catch (fallbackError) {
                // 3. If fallback also fails (very unlikely), then throw
                this.logger.error(
                    `Failed to initialize tiktoken with specific model '${this.modelName}' or fallback '${FALLBACK_ENCODING}'.`,
                    {
                        error:
                            fallbackError instanceof Error
                                ? fallbackError.message
                                : String(fallbackError),
                    }
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
            this.logger.error(
                `Tiktoken encoding failed for model ${this.modelName} (using encoding: ${this.encoding.name}):`,
                { error: error instanceof Error ? error.message : String(error) }
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

    /**
     * Estimates token cost for images in GPT-4 Vision models.
     * OpenAI uses a tile-based system:
     * - Low detail mode: 85 tokens flat
     * - High detail mode: 85 base + 170 tokens per 512x512 tile
     *
     * For a typical 1024x1024 image in high detail: 85 + (4 tiles × 170) = 765 tokens
     * Without dimension info, we estimate based on file size as a proxy for complexity.
     * @param byteSize Optional byte size of the image
     * @returns Estimated token count
     */
    estimateImageTokens(byteSize?: number): number {
        // GPT-4 Vision pricing:
        // - Low detail: 85 tokens
        // - High detail: 85 + 170 * tiles
        // Assume high detail mode and estimate tiles from file size
        if (byteSize && byteSize < 50000) {
            // Small image (<50KB) - likely low detail or few tiles
            return 256; // ~85 + 1 tile
        }
        // Default: assume medium-sized image with ~4 tiles
        return 765; // 85 + (4 * 170)
    }
}

// Lazy-load tiktoken at runtime to avoid SSR bundlers eagerly bundling the wasm-dependent module.
// This stays synchronous via Node's createRequire so our tokenizer API remains sync.
let _tiktoken: any | null = null;
function loadTiktoken(): typeof import('tiktoken') {
    if (_tiktoken) return _tiktoken as typeof import('tiktoken');
    const req = createRequire(import.meta.url);
    _tiktoken = req('tiktoken');
    return _tiktoken as typeof import('tiktoken');
}
