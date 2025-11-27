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
     * Parses raw LLM response into an array of InternalMessage objects.
     */
    parseResponse(response: unknown): InternalMessage[];

    /**
     * Optional method for handling system prompt separately.
     * Some LLM providers (like Anthropic) don't include the system prompt in the
     * messages array but pass it as a separate parameter.
     *
     * @param systemPrompt The system prompt to format
     * @returns The formatted system prompt or null/undefined if not needed
     */
    formatSystemPrompt?(systemPrompt: string | null): string | null | undefined;

    /**
     * Optional method for parsing streaming LLM responses into InternalMessage objects.
     *
     * @param response The streaming response from the LLM provider
     * @returns Promise that resolves to an array of InternalMessage objects
     */
    parseStreamResponse?(response: unknown): Promise<InternalMessage[]>;

    /**
     * Optional method for parsing raw provider-specific messages into InternalMessage objects.
     * Used for mid-loop compression in multi-step tool calling (e.g., Vercel SDK's prepareStep).
     * Unlike parseResponse, this works directly on message arrays without needing a response wrapper.
     *
     * @param messages The raw provider-specific messages to parse
     * @returns Array of InternalMessage objects (excluding system messages which are handled separately)
     */
    parseMessages?(messages: unknown[]): InternalMessage[];
}
