import { ITokenizer } from './types.js';
import { GoogleTokenizer } from './google.js';
import { DefaultTokenizer } from './default.js';
import type { LLMProvider } from '../types.js';

/**
 * Creates the appropriate tokenizer for the specified provider and model.
 * Most providers use the DefaultTokenizer which provides conservative estimates.
 *
 * @param provider The LLM provider name (case-insensitive)
 * @param model The specific model name (used by some tokenizers)
 * @returns An appropriate tokenizer implementation
 */
export function createTokenizer(provider: LLMProvider, model: string): ITokenizer {
    switch (provider) {
        case 'google':
            return new GoogleTokenizer(model);
        default:
            return new DefaultTokenizer();
    }
}
