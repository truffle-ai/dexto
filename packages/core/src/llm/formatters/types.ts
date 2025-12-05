import { InternalMessage } from '@core/context/types.js';
import { LLMContext } from '../types.js';

/**
 * Interface for converting internal message format to LLM provider-specific formats.
 * Each LLM provider requires a different message structure, and the formatter's job
 * is to handle these conversions while maintaining a consistent internal representation.
 *
 * TODO (Type Safety): Make this interface generic to avoid type casting
 *   Currently returns `unknown[]` which requires casting in ContextManager.
 *   Refactor to: `IMessageFormatter<TMessage>` where:
 *   - `format()` returns `TMessage[]`
 *   - `parseMessages()` takes `TMessage[]`
 *   - VercelMessageFormatter implements IMessageFormatter<ModelMessage>
 *   - AnthropicMessageFormatter implements IMessageFormatter<MessageParam>
 *   - OpenAIMessageFormatter implements IMessageFormatter<ChatCompletionMessageParam>
 *   This would provide full type safety through ContextManager<TMessage>.
 */
export interface IMessageFormatter {
    /**
     * Formats the internal message history for a specific LLM provider API.
     * Transforms our standardized internal message format into the specific structure
     * required by the target LLM API.
     *
     * @param history The raw internal message history (read-only to prevent modifications)
     * @param systemPrompt The system prompt, if any
     * @param context Optional context containing model information for capability-based filtering
     * @returns The message history structured for the target API (provider-specific type)
     */
    format(
        history: Readonly<InternalMessage[]>,
        context: LLMContext,
        systemPrompt?: string | null
    ): unknown[];

    /**
     * Optional method for handling system prompt separately.
     * Some LLM providers (like Anthropic) don't include the system prompt in the
     * messages array but pass it as a separate parameter.
     *
     * @param systemPrompt The system prompt to format
     * @returns The formatted system prompt or null/undefined if not needed
     */
    formatSystemPrompt?(systemPrompt: string | null): string | null | undefined;
}
