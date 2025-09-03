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
}

export class TokenizationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TokenizationError';
    }
}
