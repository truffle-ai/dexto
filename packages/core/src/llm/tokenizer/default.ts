import { ITokenizer } from './types.js';

/**
 * Placeholder tokenizer for unknown models
 */
export class DefaultTokenizer implements ITokenizer {
    /**
     * Assumes roughly 4 characters per token.
     * @param text Text content to count tokens for
     * @returns Approximate number of tokens
     */
    countTokens(text: string): number {
        if (!text) return 0;
        return Math.ceil(text.length / 4);
    }

    getProviderName(): string {
        return 'default';
    }
}
