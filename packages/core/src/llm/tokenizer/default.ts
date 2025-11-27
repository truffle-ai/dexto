import { ITokenizer } from './types.js';

/**
 * Placeholder tokenizer for unknown models/providers.
 * Uses conservative estimates for token counting.
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

    /**
     * Estimates token cost for images using a conservative middle-ground estimate.
     * For unknown providers, we use 1000 tokens as a reasonable default.
     * This errs on the side of triggering compression earlier rather than too late.
     * @returns Estimated token count (1000 tokens)
     */
    estimateImageTokens(_byteSize?: number): number {
        // Conservative default - better to compress early than hit context limits
        return 1000;
    }
}
