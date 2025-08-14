import { ContextManager } from './manager.js';
import { PromptManager } from '@core/systemPrompt/manager.js';
import { IConversationHistoryProvider } from '@core/session/history/types.js';
import { ValidatedLLMConfig } from '@core/llm/schemas.js';
import { LLMRouter } from '@core/llm/registry.js';
import { createMessageFormatter } from '@core/llm/formatters/factory.js';
import { createTokenizer } from '@core/llm/tokenizer/factory.js';
import { getEffectiveMaxInputTokens } from '@core/llm/registry.js';
import { SessionEventBus } from '@core/events/index.js';
import { logger } from '@core/logger/index.js';

/**
 * Factory function to create a ContextManager instance with the correct formatter, tokenizer, and maxInputTokens
 * based on the LLM config and router
 *
 * @template T The message type for the specific LLM provider (caller should specify this)
 * @param config LLMConfig object containing provider, model, systemPrompt, etc.
 * @param router LLMRouter flag
 * @param promptManager PromptManager instance
 * @param sessionEventBus Session-level event bus for message-related events
 * @param historyProvider ConversationHistoryProvider instance
 * @param sessionId string
 * @returns ContextManager instance with the specified message type
 * TODO: Make compression strategy also configurable
 */
export function createContextManager<T = unknown>(
    config: ValidatedLLMConfig,
    router: LLMRouter,
    promptManager: PromptManager,
    sessionEventBus: SessionEventBus,
    historyProvider: IConversationHistoryProvider,
    sessionId: string
): ContextManager<T> {
    const tokenizer = createTokenizer(config.provider, config.model);
    logger.debug(`Tokenizer created for ${config.provider}/${config.model}`);

    const formatter = createMessageFormatter(config.provider, router);
    const effectiveMaxInputTokens = getEffectiveMaxInputTokens(config);
    logger.debug(
        `Creating ContextManager for ${config.provider}/${config.model} using ${router} router with maxInputTokens: ${effectiveMaxInputTokens}`
    );
    return new ContextManager<T>(
        formatter,
        promptManager,
        sessionEventBus,
        effectiveMaxInputTokens,
        tokenizer,
        historyProvider,
        sessionId
    );
}
