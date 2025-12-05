export interface ITokenizer {
    /**
     * Counts the number of tokens in the provided text according
     * to the specific LLM provider's tokenization rules
     * @param text Text content to count tokens for
     * @returns Number of tokens in the text
     */
    countTokens(text: string): number;

    /**
     * Gets the name of the LLM provider this tokenizer is for
     * @returns Provider name (e.g., "openai", "anthropic")
     */
    getProviderName(): string;

    /**
     * Estimates token cost for an image based on provider's vision model pricing.
     * Different providers charge very differently for images:
     * - Claude: ~1000-2000+ tokens based on image dimensions
     * - GPT-4 Vision: 85-765 tokens (tile-based system)
     * - Gemini: 258 tokens flat per image
     *
     * @param byteSize Optional byte size of the image (if known)
     * @returns Estimated token count for the image
     */
    estimateImageTokens(byteSize?: number): number;
}

export class TokenizationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TokenizationError';
    }
}
