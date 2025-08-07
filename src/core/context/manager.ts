import { IMessageFormatter } from '@core/llm/formatters/types.js';
import { LLMContext } from '../llm/types.js';
import { InternalMessage, ImageData, FileData } from './types.js';
import { ITokenizer } from '../llm/tokenizer/types.js';
import { ICompressionStrategy } from './compression/types.js';
import { MiddleRemovalStrategy } from './compression/middle-removal.js';
import { OldestRemovalStrategy } from './compression/oldest-removal.js';
import { logger } from '../logger/index.js';
import { getImageData, countMessagesTokens } from './utils.js';
import { DynamicContributorContext } from '../systemPrompt/types.js';
import { PromptManager } from '../systemPrompt/manager.js';
import { IConversationHistoryProvider } from '@core/session/history/types.js';
import { SessionEventBus } from '../events/index.js';
/**
 * Manages conversation history and provides message formatting capabilities for the LLM context.
 * The ContextManager is responsible for:
 * - Validating and storing conversation messages via the history provider
 * - Managing the system prompt
 * - Formatting messages for specific LLM providers through an injected formatter
 * - Optionally counting tokens using a provided tokenizer
 * - Applying compression strategies sequentially if token limits are exceeded
 * - Providing access to conversation history
 *
 * Note: All conversation history is stored and retrieved via the injected ConversationHistoryProvider.
 * The ContextManager does not maintain an internal history cache.
 * TOOD: clean up tokenizer logic if we are relying primarily on LLM API to give us token count.
 * Right now its weaker because it doesn't account for tools and other non-text content in the prompt.
 */
export class ContextManager {
    /**
     * PromptManager used to generate/manage the system prompt
     */
    private promptManager: PromptManager;

    /**
     * Event bus for session events
     */
    private sessionEventBus: SessionEventBus;

    /**
     * Formatter used to convert internal messages to LLM-specific format
     */
    private formatter: IMessageFormatter;

    /**
     * Maximum number of tokens allowed in the conversation (if specified)
     */
    private maxInputTokens: number;

    /**
     * Actual token count from the last LLM response.
     * Used for more accurate token estimation in hybrid approach.
     */
    private lastActualTokenCount: number = 0;

    /**
     * Compression threshold as a percentage of maxInputTokens.
     * When estimated tokens exceed (maxInputTokens * threshold), compression is triggered.
     */
    private compressionThreshold: number = 0.8; // 80% threshold

    /**
     * Tokenizer used for counting tokens and enabling compression (if specified)
     */
    private tokenizer: ITokenizer;

    /**
     * The sequence of compression strategies to apply when maxInputTokens is exceeded.
     * The order in this array matters, as strategies are applied sequentially until
     * the token count is within the limit.
     */
    private compressionStrategies: ICompressionStrategy[];

    private historyProvider: IConversationHistoryProvider;
    private readonly sessionId: string;

    /**
     * Creates a new ContextManager instance
     *
     * @param formatter Formatter implementation for the target LLM provider
     * @param promptManager PromptManager instance for the conversation
     * @param sessionEventBus Session-level event bus for emitting message-related events
     * @param maxInputTokens Maximum token limit for the conversation history. Triggers compression if exceeded and a tokenizer is provided.
     * @param tokenizer Tokenizer implementation used for counting tokens and enabling compression.
     * @param historyProvider Session-scoped ConversationHistoryProvider instance for managing conversation history
     * @param sessionId Unique identifier for the conversation session (readonly, for debugging)
     * @param compressionStrategies Optional array of compression strategies to apply when token limits are exceeded
     */
    constructor(
        formatter: IMessageFormatter,
        promptManager: PromptManager,
        sessionEventBus: SessionEventBus,
        maxInputTokens: number,
        tokenizer: ITokenizer,
        historyProvider: IConversationHistoryProvider,
        sessionId: string,
        compressionStrategies: ICompressionStrategy[] = [
            new MiddleRemovalStrategy(),
            new OldestRemovalStrategy(),
        ]
    ) {
        if (!formatter) throw new Error('formatter is required');
        if (!promptManager) throw new Error('promptManager is required');
        if (!sessionEventBus) throw new Error('sessionEventBus is required');
        if (!maxInputTokens) throw new Error('maxInputTokens is required');
        if (!tokenizer) throw new Error('tokenizer is required');
        if (!historyProvider) throw new Error('historyProvider is required');
        if (!sessionId) throw new Error('sessionId is required');
        if (!compressionStrategies) throw new Error('compressionStrategies is required');

        this.formatter = formatter;
        this.promptManager = promptManager;
        this.sessionEventBus = sessionEventBus;
        this.maxInputTokens = maxInputTokens;
        this.tokenizer = tokenizer;
        this.historyProvider = historyProvider;
        this.sessionId = sessionId;
        this.compressionStrategies = compressionStrategies;

        logger.debug(
            `ContextManager: Initialized for session ${sessionId} - history will be managed by ${historyProvider.constructor.name}`
        );
    }

    /**
     * Returns the current token count of the conversation history.
     * @returns Promise that resolves to the number of tokens in the current history
     */
    async getTokenCount(): Promise<number> {
        const history = await this.historyProvider.getHistory();
        return countMessagesTokens(history, this.tokenizer);
    }

    /**
     * Returns the total token count that will be sent to the LLM provider,
     * including system prompt, formatted messages, and provider-specific overhead.
     * This provides a more accurate estimate than getTokenCount() alone.
     *
     * @param context The DynamicContributorContext for system prompt contributors
     * @returns Promise that resolves to the total number of tokens that will be sent to the provider
     */
    async getTotalTokenCount(context: DynamicContributorContext): Promise<number> {
        try {
            // Get system prompt
            const systemPrompt = await this.getSystemPrompt(context);

            // Get conversation history
            let history = await this.historyProvider.getHistory();

            // Count system prompt tokens
            const systemPromptTokens = this.tokenizer.countTokens(systemPrompt);

            // Compress history if it exceeds the token limit
            history = await this.compressHistoryIfNeeded(history, systemPromptTokens);

            // Count history message tokens (after compression)
            const historyTokens = countMessagesTokens(history, this.tokenizer);

            // Add a small overhead for provider-specific formatting
            // This accounts for any additional structure the formatter adds
            const formattingOverhead = Math.ceil((systemPromptTokens + historyTokens) * 0.05); // 5% overhead

            const totalTokens = systemPromptTokens + historyTokens + formattingOverhead;

            logger.debug(
                `Token breakdown - System: ${systemPromptTokens}, History: ${historyTokens}, Overhead: ${formattingOverhead}, Total: ${totalTokens}`
            );

            return totalTokens;
        } catch (error) {
            logger.error('Error calculating total token count:', error);
            // Fallback to history-only count
            return this.getTokenCount();
        }
    }

    /**
     * Returns the configured maximum number of input tokens for the conversation.
     */
    getMaxInputTokens(): number {
        return this.maxInputTokens;
    }

    /**
     * Updates the ContextManager configuration when LLM config changes.
     * This is called when DextoAgent.switchLLM() updates the LLM configuration.
     *
     * @param newMaxInputTokens New maximum token limit
     * @param newTokenizer Optional new tokenizer if provider changed
     * @param newFormatter Optional new formatter if provider/router changed
     */
    updateConfig(
        newMaxInputTokens: number,
        newTokenizer?: ITokenizer,
        newFormatter?: IMessageFormatter
    ): void {
        const oldMaxInputTokens = this.maxInputTokens;
        this.maxInputTokens = newMaxInputTokens;

        if (newTokenizer) {
            this.tokenizer = newTokenizer;
        }

        if (newFormatter) {
            this.formatter = newFormatter;
        }

        logger.debug(
            `ContextManager config updated: maxInputTokens ${oldMaxInputTokens} -> ${newMaxInputTokens}`
        );
    }

    /**
     * Updates the actual token count from the last LLM response.
     * This enables hybrid token counting for more accurate estimates.
     *
     * @param actualTokens The actual token count reported by the LLM provider
     */
    updateActualTokenCount(actualTokens: number): void {
        this.lastActualTokenCount = actualTokens;
        logger.debug(`Updated actual token count to: ${actualTokens}`);
    }

    /**
     * Estimates if new input would trigger compression using hybrid approach.
     * Combines actual tokens from last response with estimated tokens for new input.
     *
     * @param newInputTokens Estimated tokens for the new user input
     * @returns True if compression should be triggered
     */
    shouldCompress(newInputTokens: number): boolean {
        const estimatedTotal = this.lastActualTokenCount + newInputTokens;
        const compressionTrigger = this.maxInputTokens * this.compressionThreshold;

        logger.debug(
            `Compression check: actual=${this.lastActualTokenCount}, newInput=${newInputTokens}, total=${estimatedTotal}, trigger=${compressionTrigger}`
        );

        return estimatedTotal > compressionTrigger;
    }

    /**
     * Assembles and returns the current system prompt by invoking the PromptManager.
     */
    async getSystemPrompt(context: DynamicContributorContext): Promise<string> {
        const prompt = await this.promptManager.build(context);
        logger.debug(`[SystemPrompt] Built system prompt:\n${prompt}`);
        return prompt;
    }

    /**
     * Gets the raw conversation history
     * Returns a defensive copy to prevent modification
     *
     * @returns Promise that resolves to a read-only copy of the conversation history
     */
    async getHistory(): Promise<Readonly<InternalMessage[]>> {
        const history = await this.historyProvider.getHistory();
        return [...history];
    }

    /**
     * Adds a message to the conversation history.
     * Performs validation based on message role and required fields.
     * Note: Compression based on token limits is applied lazily when calling `getFormattedMessages`, not immediately upon adding.
     *
     * @param message The message to add to the history
     * @throws Error if message validation fails
     */
    async addMessage(message: InternalMessage): Promise<void> {
        // Validation based on role
        if (!message.role) {
            throw new Error('ContextManager: Message must have a role.');
        }

        switch (message.role) {
            case 'user':
                if (
                    // Allow array content for user messages
                    !(Array.isArray(message.content) && message.content.length > 0) &&
                    (typeof message.content !== 'string' || message.content.trim() === '')
                ) {
                    throw new Error(
                        'ContextManager: User message content should be a non-empty string or a non-empty array of parts.'
                    );
                }
                // Optional: Add validation for the structure of array parts if needed
                break;
            case 'assistant':
                // Content can be null if toolCalls are present, but one must exist
                if (
                    message.content === null &&
                    (!message.toolCalls || message.toolCalls.length === 0)
                ) {
                    throw new Error(
                        'ContextManager: Assistant message must have content or toolCalls.'
                    );
                }
                if (message.toolCalls) {
                    if (
                        !Array.isArray(message.toolCalls) ||
                        message.toolCalls.some(
                            (tc) => !tc.id || !tc.function?.name || !tc.function?.arguments
                        )
                    ) {
                        throw new Error(
                            'ContextManager: Invalid toolCalls structure in assistant message.'
                        );
                    }
                }
                break;
            case 'tool':
                if (!message.toolCallId || !message.name || message.content === null) {
                    throw new Error(
                        'ContextManager: Tool message missing required fields (toolCallId, name, content).'
                    );
                }
                break;
            case 'system':
                // System messages should ideally be handled via setSystemPrompt
                logger.warn(
                    'ContextManager: Adding system message directly to history. Use setSystemPrompt instead.'
                );
                if (typeof message.content !== 'string' || message.content.trim() === '') {
                    throw new Error(
                        'ContextManager: System message content must be a non-empty string.'
                    );
                }
                break;
            default:
                throw new Error(`ContextManager: Unknown message role: ${(message as any).role}`);
        }

        logger.debug(
            `ContextManager: Adding message to history provider: ${JSON.stringify(message, null, 2)}`
        );

        try {
            // Save to history provider
            await this.historyProvider.saveMessage(message);

            // Get updated history for logging
            const history = await this.historyProvider.getHistory();
            logger.debug(`ContextManager: History now contains ${history.length} messages`);
        } catch (error) {
            logger.error(
                `ContextManager: Failed to save message for session ${this.sessionId}:`,
                error
            );
            throw new Error(
                `Failed to save message: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        // Note: Compression is currently handled lazily in getFormattedMessages
    }

    /**
     * Adds a user message to the conversation
     * Can include image data for multimodal input
     *
     * @param textContent The user message content
     * @param imageData Optional image data for multimodal input
     * @param fileData Optional file data for file input
     * @throws Error if content is empty or not a string
     */
    async addUserMessage(
        textContent: string,
        imageData?: ImageData,
        fileData?: FileData
    ): Promise<void> {
        // Allow empty text if we have image or file data
        if (
            typeof textContent !== 'string' ||
            (textContent.trim() === '' && !imageData && !fileData)
        ) {
            throw new Error(
                'addUserMessage: Content must be a non-empty string or have imageData/fileData.'
            );
        }

        // If text is empty but we have attachments, use a placeholder
        const finalTextContent = textContent.trim() || (imageData || fileData ? '' : textContent);

        // Build message parts array to support multiple attachment types
        const messageParts: InternalMessage['content'] = [];

        // Add text if present
        if (finalTextContent) {
            messageParts.push({ type: 'text' as const, text: finalTextContent });
        }

        // Add image if present
        if (imageData) {
            messageParts.push({
                type: 'image' as const,
                image: imageData.image,
                mimeType: imageData.mimeType || 'image/jpeg',
            });
        }

        // Add file if present
        if (fileData) {
            messageParts.push({
                type: 'file' as const,
                data: fileData.data,
                mimeType: fileData.mimeType,
                ...(fileData.filename && { filename: fileData.filename }),
            });
        }

        // Fallback to text-only if no parts were added
        if (messageParts.length === 0) {
            messageParts.push({ type: 'text' as const, text: finalTextContent });
        }
        logger.debug(
            `ContextManager: Adding user message: ${JSON.stringify(messageParts, null, 2)}`
        );
        await this.addMessage({ role: 'user', content: messageParts });
    }

    /**
     * Adds an assistant message to the conversation
     * Can include tool calls if the assistant is requesting tool execution
     *
     * @param content The assistant's response text (can be null if only tool calls)
     * @param toolCalls Optional tool calls requested by the assistant
     * @throws Error if neither content nor toolCalls are provided
     */
    async addAssistantMessage(
        content: string | null,
        toolCalls?: InternalMessage['toolCalls']
    ): Promise<void> {
        // Validate that either content or toolCalls is provided
        if (content === null && (!toolCalls || toolCalls.length === 0)) {
            throw new Error('addAssistantMessage: Must provide content or toolCalls.');
        }
        // Further validation happens within addMessage
        await this.addMessage({
            role: 'assistant' as const,
            content,
            ...(toolCalls && toolCalls.length > 0 && { toolCalls }),
        });
    }

    /**
     * Adds a tool result message to the conversation
     *
     * @param toolCallId ID of the tool call this result is responding to
     * @param name Name of the tool that executed
     * @param result The result returned by the tool
     * @throws Error if required parameters are missing
     */
    async addToolResult(toolCallId: string, name: string, result: any): Promise<void> {
        if (!toolCallId || !name) {
            throw new Error('addToolResult: toolCallId and name are required.');
        }

        // Simplest image detection: if result has an 'image' field, treat as ImagePart
        let content: InternalMessage['content'];
        if (result && typeof result === 'object' && 'image' in result) {
            // Use shared helper to get base64/URL
            const imagePart = result as {
                image: string | Uint8Array | Buffer | ArrayBuffer | URL;
                mimeType?: string;
            };
            content = [
                {
                    type: 'image',
                    image: getImageData(imagePart),
                    mimeType: imagePart.mimeType || 'image/jpeg',
                },
            ];
        } else if (typeof result === 'string') {
            content = result;
        } else if (Array.isArray(result)) {
            // Assume array of parts already
            content = result;
        } else {
            // Fallback: stringify all other values
            content = JSON.stringify(result ?? '');
        }

        await this.addMessage({ role: 'tool', content, toolCallId, name });
    }

    /**
     * Sets the system prompt for the conversation
     *
     * @param prompt The system prompt text
     */
    setSystemPrompt(_prompt: string): void {
        // This method is no longer used with systemPromptContributors
    }

    /**
     * Gets the conversation history formatted for the target LLM provider.
     * Applies compression strategies sequentially if the manager is configured with a `maxInputTokens` limit
     * and a `tokenizer`, and the current token count exceeds the limit. Compression happens *before* formatting.
     * Uses the injected formatter to convert internal messages (potentially compressed) to the provider's format.
     *
     * @param contributorContext The DynamicContributorContext for system prompt contributors and formatting
     * @param llmContext The llmContext for the formatter to decide which messages to include based on the model's capabilities
     * @param systemPrompt (Optional) Precomputed system prompt string. If provided, it will be used instead of recomputing the system prompt. Useful for avoiding duplicate computation when both the formatted messages and the raw system prompt are needed in the same request.
     * @param history (Optional) Pre-fetched and potentially compressed history. If not provided, will fetch from history provider.
     * @returns Formatted messages ready to send to the LLM provider API
     * @throws Error if formatting or compression fails critically
     */
    async getFormattedMessages(
        contributorContext: DynamicContributorContext,
        llmContext: LLMContext,
        systemPrompt?: string | undefined,
        history?: InternalMessage[]
    ): Promise<any[]> {
        // Use provided history or fetch from provider
        let messageHistory: InternalMessage[];
        try {
            messageHistory = history ?? (await this.historyProvider.getHistory());
        } catch (error) {
            logger.error(
                `ContextManager: Failed to get history for session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw new Error(
                `Failed to get conversation history: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        try {
            // Use pre-computed system prompt if provided
            const prompt = systemPrompt ?? (await this.getSystemPrompt(contributorContext));
            return this.formatter.format([...messageHistory], llmContext, prompt);
        } catch (error) {
            logger.error(
                `Error formatting messages: ${error instanceof Error ? error.message : String(error)}`
            );
            throw new Error(
                `Failed to format messages: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Gets the conversation ready for LLM consumption with proper flow:
     * 1. Get system prompt
     * 2. Get history and compress if needed
     * 3. Format messages
     * This method implements the correct ordering to avoid circular dependencies.
     *
     * @param contributorContext The DynamicContributorContext for system prompt contributors and formatting
     * @param llmContext The llmContext for the formatter to decide which messages to include based on the model's capabilities
     * @returns Object containing formatted messages and system prompt
     */
    async getFormattedMessagesWithCompression(
        contributorContext: DynamicContributorContext,
        llmContext: LLMContext
    ): Promise<{
        // TODO: fix this type
        formattedMessages: any[];
        systemPrompt: string;
        tokensUsed: number;
    }> {
        try {
            // Step 1: Get system prompt
            const systemPrompt = await this.getSystemPrompt(contributorContext);
            const systemPromptTokens = this.tokenizer.countTokens(systemPrompt);

            // Step 2: Get history and compress if needed
            let history = await this.historyProvider.getHistory();
            history = await this.compressHistoryIfNeeded(history, systemPromptTokens);

            // Step 3: Format messages with compressed history
            const formattedMessages = await this.getFormattedMessages(
                contributorContext,
                llmContext,
                systemPrompt,
                history
            );

            // Calculate final token usage
            const historyTokens = countMessagesTokens(history, this.tokenizer);
            const formattingOverhead = Math.ceil((systemPromptTokens + historyTokens) * 0.05);
            const tokensUsed = systemPromptTokens + historyTokens + formattingOverhead;

            logger.debug(
                `Final token breakdown - System: ${systemPromptTokens}, History: ${historyTokens}, Overhead: ${formattingOverhead}, Total: ${tokensUsed}`
            );

            return {
                formattedMessages,
                systemPrompt,
                tokensUsed,
            };
        } catch (error) {
            logger.error('Error in getFormattedMessagesWithCompression:', error);
            throw new Error(
                `Failed to get formatted messages with compression: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Gets the system prompt formatted for the target LLM provider
     * Some providers handle system prompts differently
     *
     * @returns Formatted system prompt or null/undefined based on formatter implementation
     * @throws Error if formatting fails
     */
    async getFormattedSystemPrompt(
        context: DynamicContributorContext
    ): Promise<string | null | undefined> {
        try {
            const systemPrompt = await this.getSystemPrompt(context);
            return this.formatter.formatSystemPrompt?.(systemPrompt);
        } catch (error) {
            console.error('Error getting formatted system prompt:', error);
            throw new Error(`Failed to get formatted system prompt: ${error}`);
        }
    }

    /**
     * Resets the conversation history
     * Does not reset the system prompt
     */
    async resetConversation(): Promise<void> {
        // Clear persisted history
        await this.historyProvider.clearHistory();
        logger.debug(`ContextManager: Conversation history cleared for session ${this.sessionId}`);
    }

    /**
     * Checks if history compression is needed based on token count and applies strategies.
     *
     * @param history The conversation history to potentially compress
     * @param systemPromptTokens The actual token count of the system prompt
     * @returns The potentially compressed history
     */
    async compressHistoryIfNeeded(
        history: InternalMessage[],
        systemPromptTokens: number
    ): Promise<InternalMessage[]> {
        let currentTotalTokens: number = countMessagesTokens(history, this.tokenizer);
        currentTotalTokens += systemPromptTokens;

        logger.debug(`ContextManager: Checking if history compression is needed.`);
        logger.debug(
            `History tokens: ${countMessagesTokens(history, this.tokenizer)}, System prompt tokens: ${systemPromptTokens}, Total: ${currentTotalTokens}`
        );

        // If counting failed or we are within limits, do nothing
        if (currentTotalTokens <= this.maxInputTokens) {
            logger.debug(
                `ContextManager: History compression not needed. Total token count: ${currentTotalTokens}, Max tokens: ${this.maxInputTokens}`
            );
            return history;
        }

        logger.info(
            `ContextManager: History exceeds token limit (${currentTotalTokens} > ${this.maxInputTokens}). Applying compression strategies sequentially.`
        );

        const initialLength = history.length;
        let workingHistory = [...history];

        // Calculate target tokens for history (leave room for system prompt)
        const targetHistoryTokens = this.maxInputTokens - systemPromptTokens;

        // Iterate through the configured compression strategies sequentially
        for (const strategy of this.compressionStrategies) {
            const strategyName = strategy.constructor.name; // Get the class name for logging
            logger.debug(`ContextManager: Applying ${strategyName}...`);

            try {
                // Pass a copy of the history to avoid potential side effects within the strategy
                // The strategy should return the new, potentially compressed, history
                workingHistory = strategy.compress(
                    [...workingHistory],
                    this.tokenizer,
                    targetHistoryTokens // Use target tokens that account for system prompt
                );
            } catch (error) {
                logger.error(`ContextManager: Error applying ${strategyName}:`, error);
                // Decide if we should stop or try the next strategy. Let's stop for now.
                break;
            }

            // Recalculate tokens after applying the strategy
            const historyTokens = countMessagesTokens(workingHistory, this.tokenizer);
            currentTotalTokens = historyTokens + systemPromptTokens;
            const messagesRemoved = initialLength - workingHistory.length;

            // If counting failed or we are now within limits, stop applying strategies
            if (currentTotalTokens <= this.maxInputTokens) {
                logger.debug(
                    `ContextManager: Compression successful after ${strategyName}. New total count: ${currentTotalTokens}, messages removed: ${messagesRemoved}`
                );
                break;
            }
        }

        return workingHistory;
    }

    /**
     * Parses a raw LLM stream response, converts it into internal messages and adds them to the history.
     *
     * @param response The stream response from the LLM provider
     */
    async processLLMStreamResponse(response: any): Promise<void> {
        // Use type-safe access to parseStreamResponse method
        if (this.formatter.parseStreamResponse) {
            const msgs = (await this.formatter.parseStreamResponse(response)) ?? [];
            for (const msg of msgs) {
                try {
                    await this.addMessage(msg);
                } catch (error) {
                    logger.error(
                        `ContextManager: Failed to process LLM stream response message for session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
                    );
                    // Continue processing other messages rather than failing completely
                }
            }
        } else {
            // Fallback to regular processing
            await this.processLLMResponse(response);
        }
    }

    /**
     * Parses a raw LLM response, converts it into internal messages and adds them to the history.
     *
     * @param response The response from the LLM provider
     */
    async processLLMResponse(response: any): Promise<void> {
        const msgs = this.formatter.parseResponse(response) ?? [];
        for (const msg of msgs) {
            try {
                await this.addMessage(msg);
            } catch (error) {
                logger.error(
                    `ContextManager: Failed to process LLM response message for session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
                );
                // Continue processing other messages rather than failing completely
            }
        }
    }
}
