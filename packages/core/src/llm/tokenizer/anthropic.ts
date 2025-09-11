import { ITokenizer } from './types.js';

/**
 * Placeholder tokenizer for Anthropic models.
 * Uses a rough approximation based on character count.
 * TODO: IMPORTANT: This is not accurate and should be replaced
 * with a better implementation or official library when available.
 */
export class AnthropicTokenizer implements ITokenizer {
    /**
     * TODO: Replace with a better implementation for anthropic
     * Approximates token count for Anthropic models.
     * Assumes roughly 4 characters per token.
     * @param text Text content to count tokens for
     * @returns Approximate number of tokens
     */
    countTokens(text: string): number {
        if (!text) return 0;
        // Rough approximation: Claude models average ~4 chars/token
        return Math.ceil(text.length / 4);
    }

    getProviderName(): string {
        return 'anthropic';
    }
}
