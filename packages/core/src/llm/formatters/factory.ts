import { IMessageFormatter } from './types.js';
import { VercelMessageFormatter } from './vercel.js';
import { OpenAIMessageFormatter } from './openai.js';
import { AnthropicMessageFormatter } from './anthropic.js';
import { logger } from '@core/logger/index.js';
import type { LLMProvider, LLMRouter } from '../types.js';
import { LLMError } from '../errors.js';

/**
 * Creates a message formatter for the specified provider and router combination.
 * Each formatter handles the conversion between internal message format and
 * provider-specific message structures.
 */
export function createMessageFormatter(
    provider: LLMProvider,
    router: LLMRouter
): IMessageFormatter {
    if (router === 'vercel') {
        return new VercelMessageFormatter();
    } else if (router === 'in-built') {
        if (provider === 'openai' || provider === 'openai-compatible') {
            return new OpenAIMessageFormatter();
        } else if (provider === 'anthropic') {
            return new AnthropicMessageFormatter();
        } else {
            logger.error(
                `Provider '${provider}' supported by registry but not configured for 'default' router message formatting.`
            );
            throw LLMError.unsupportedRouter(router, provider);
        }
    } else {
        // Unreachable
        logger.error(`Unsupported LLM router specified: ${router}`);
        throw LLMError.unsupportedRouter(router, provider);
    }
}
