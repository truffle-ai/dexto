import { ITokenizer } from './types.js';
import { OpenAITokenizer } from './openai.js';
import { AnthropicTokenizer } from './anthropic.js';
import { GoogleTokenizer } from './google.js';
import { DefaultTokenizer } from './default.js';
import { LLMProvider } from '../registry.js';

/**
 * Creates the appropriate tokenizer for the specified provider and model
 * @param provider The LLM provider name (case-insensitive)
 * @param model The specific model name (used by some tokenizers)
 * @returns An appropriate tokenizer implementation, or DefaultTokenizer if no specific implementation exists
 */
export function createTokenizer(provider: LLMProvider, model: string): ITokenizer {
    switch (provider) {
        case 'openai':
            // OpenAI tokenizer might depend on the specific model
            return new OpenAITokenizer(model);
        case 'anthropic':
            // Anthropic tokenizer approximation doesn't depend on model currently
            return new AnthropicTokenizer();
        case 'google':
            return new GoogleTokenizer(model);
        // Add cases for other providers here
        default:
            return new DefaultTokenizer();
    }
}
