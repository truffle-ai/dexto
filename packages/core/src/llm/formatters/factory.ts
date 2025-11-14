import { IMessageFormatter } from './types.js';
import { VercelMessageFormatter } from './vercel.js';
import { OpenAIMessageFormatter } from './openai.js';
import { AnthropicMessageFormatter } from './anthropic.js';
import type { IDextoLogger } from '@core/logger/v2/types.js';
import type { LLMProvider, LLMRouter } from '../types.js';
import { LLMError } from '../errors.js';

/**
 * Creates a message formatter for the specified provider and router combination.
 * Each formatter handles the conversion between internal message format and
 * provider-specific message structures.
 */
export function createMessageFormatter(
    provider: LLMProvider,
    router: LLMRouter,
    logger: IDextoLogger
): IMessageFormatter {
    if (router === 'vercel') {
        return new VercelMessageFormatter(logger);
    } else if (router === 'in-built') {
        if (provider === 'openai' || provider === 'openai-compatible') {
            return new OpenAIMessageFormatter(logger);
        } else if (provider === 'anthropic') {
            return new AnthropicMessageFormatter(logger);
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
