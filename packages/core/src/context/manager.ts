import { IMessageFormatter } from '@core/llm/formatters/types.js';
import { LLMContext } from '../llm/types.js';
import { InternalMessage, ImageData, FileData } from './types.js';
import { ITokenizer } from '../llm/tokenizer/types.js';
import { ICompressionStrategy } from './compression/types.js';
import { MiddleRemovalStrategy } from './compression/middle-removal.js';
import { OldestRemovalStrategy } from './compression/oldest-removal.js';
import { logger } from '../logger/index.js';
import { eventBus } from '../events/index.js';
import {
    countMessagesTokens,
    sanitizeToolResultToContentWithBlobs,
    expandBlobReferences,
    isLikelyBase64String,
} from './utils.js';
import { DynamicContributorContext } from '../systemPrompt/types.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { IConversationHistoryProvider } from '@core/session/history/types.js';
import { ContextError } from './errors.js';
import { ValidatedLLMConfig } from '../llm/schemas.js';

// TODO: Unify LLM response handling approaches across providers
// Currently vercel vs anthropic/openai handle getting LLM responses quite differently:
// - anthropic/openai add tool responses and assistant responses using individual methods
// - vercel uses processLLMResponse and processStreamResponse
// This should be unified to make the codebase more consistent and easier to maintain
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
 * TODO: clean up tokenizer logic if we are relying primarily on LLM API to give us token count.
 * TODO: Move InternalMessage parsing logic to zod
 * Right now its weaker because it doesn't account for tools and other non-text content in the prompt.
 *
 * @template TMessage The message type for the specific LLM provider (e.g., MessageParam, ChatCompletionMessageParam, ModelMessage)
 */
export class ContextManager<TMessage = unknown> {
    /**
     * The validated LLM configuration.
     */
    private llmConfig: ValidatedLLMConfig;

    /**
     * SystemPromptManager used to generate/manage the system prompt
     */
    private systemPromptManager: SystemPromptManager;

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
     * ResourceManager for resolving blob references in message content.
     * Blob references like @blob:abc123 are resolved to actual data
     * before passing messages to the LLM formatter.
     */
    private resourceManager: import('../resources/index.js').ResourceManager;

    /**
     * Get the ResourceManager instance
     */
    public getResourceManager(): import('../resources/index.js').ResourceManager {
        return this.resourceManager;
    }

    /**
     * Process user input data - store as blob if large, otherwise return as-is.
     * Returns either the original data or a blob reference (@blob:id).
     */
    private async processUserInput(
        data: string | Uint8Array | Buffer | ArrayBuffer | URL,
        metadata: {
            mimeType: string;
            originalName?: string;
            source?: 'user' | 'system';
        }
    ): Promise<string | Uint8Array | Buffer | ArrayBuffer | URL> {
        const blobService = this.resourceManager.getBlobStore();

        // Estimate data size to decide if we should store as blob
        let shouldStoreAsBlob = false;
        let estimatedSize = 0;

        if (typeof data === 'string') {
            if (data.startsWith('data:')) {
                // Data URI - estimate base64 size
                const commaIndex = data.indexOf(',');
                if (commaIndex !== -1) {
                    const base64Data = data.substring(commaIndex + 1);
                    estimatedSize = Math.floor((base64Data.length * 3) / 4);
                }
            } else if (data.length > 100 && data.match(/^[A-Za-z0-9+/=]+$/)) {
                // Likely base64 string
                estimatedSize = Math.floor((data.length * 3) / 4);
            } else {
                estimatedSize = Buffer.byteLength(data, 'utf8');
            }
        } else if (data instanceof Buffer || data instanceof Uint8Array) {
            estimatedSize = data.length;
        } else if (data instanceof ArrayBuffer) {
            estimatedSize = data.byteLength;
        } else if (data instanceof URL) {
            // URLs are small, don't store as blob
            return data;
        }

        const isLikelyBinary =
            metadata.mimeType.startsWith('image/') ||
            metadata.mimeType.startsWith('audio/') ||
            metadata.mimeType.startsWith('video/') ||
            metadata.mimeType === 'application/pdf';

        // Store all binary attachments (images/audio/video/pdf) or anything over 5KB
        shouldStoreAsBlob = isLikelyBinary || estimatedSize > 5 * 1024;

        if (shouldStoreAsBlob) {
            try {
                const blobInput =
                    typeof data === 'string' &&
                    !data.startsWith('data:') &&
                    !isLikelyBase64String(data) &&
                    !isLikelyBinary
                        ? Buffer.from(data, 'utf-8')
                        : data;

                const blobRef = await blobService.store(blobInput, {
                    mimeType: metadata.mimeType,
                    originalName: metadata.originalName,
                    source: metadata.source || 'user',
                });

                logger.info(
                    `Stored user input as blob: ${blobRef.uri} (${estimatedSize} bytes, ${metadata.mimeType})`
                );

                // Emit event to invalidate resource cache so uploaded images appear in @ autocomplete
                eventBus.emit('dexto:resourceCacheInvalidated', {
                    resourceUri: blobRef.uri,
                    serverName: 'internal',
                    action: 'blob_stored',
                });

                return `@${blobRef.uri}`; // Return @blob:id reference for ResourceManager
            } catch (error) {
                logger.warn(`Failed to store user input as blob: ${String(error)}`);
                // Fallback to storing original data
                return data;
            }
        }

        return data;
    }

    /**
     * Creates a new ContextManager instance
     * @param llmConfig The validated LLM configuration.
     * @param formatter Formatter implementation for the target LLM provider
     * @param systemPromptManager SystemPromptManager instance for the conversation
     * @param maxInputTokens Maximum token limit for the conversation history. Triggers compression if exceeded and a tokenizer is provided.
     * @param tokenizer Tokenizer implementation used for counting tokens and enabling compression.
     * @param historyProvider Session-scoped ConversationHistoryProvider instance for managing conversation history
     * @param sessionId Unique identifier for the conversation session (readonly, for debugging)
     * @param compressionStrategies Optional array of compression strategies to apply when token limits are exceeded
     * @param resourceManager Optional ResourceManager for resolving blob references in messages
     */
    constructor(
        llmConfig: ValidatedLLMConfig,
        formatter: IMessageFormatter,
        systemPromptManager: SystemPromptManager,
        maxInputTokens: number,
        tokenizer: ITokenizer,
        historyProvider: IConversationHistoryProvider,
        sessionId: string,
        resourceManager: import('../resources/index.js').ResourceManager,
        compressionStrategies: ICompressionStrategy[] = [
            new MiddleRemovalStrategy(),
            new OldestRemovalStrategy(),
        ]
    ) {
        this.llmConfig = llmConfig;
        this.formatter = formatter;
        this.systemPromptManager = systemPromptManager;
        this.maxInputTokens = maxInputTokens;
        this.tokenizer = tokenizer;
        this.historyProvider = historyProvider;
        this.sessionId = sessionId;
        this.compressionStrategies = compressionStrategies;
        this.resourceManager = resourceManager;

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
     * Assembles and returns the current system prompt by invoking the SystemPromptManager.
     */
    async getSystemPrompt(context: DynamicContributorContext): Promise<string> {
        const prompt = await this.systemPromptManager.build(context);
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
        switch (message.role) {
            case 'user':
                if (
                    // Allow array content for user messages
                    !(Array.isArray(message.content) && message.content.length > 0) &&
                    (typeof message.content !== 'string' || message.content.trim() === '')
                ) {
                    throw ContextError.userMessageContentInvalid();
                }
                // Optional: Add validation for the structure of array parts if needed
                break;

            case 'assistant':
                // Content can be null if toolCalls are present, but one must exist
                if (
                    message.content === null &&
                    (!message.toolCalls || message.toolCalls.length === 0)
                ) {
                    throw ContextError.assistantMessageContentOrToolsRequired();
                }
                if (message.toolCalls) {
                    if (
                        !Array.isArray(message.toolCalls) ||
                        message.toolCalls.some(
                            (tc) => !tc.id || !tc.function?.name || !tc.function?.arguments
                        )
                    ) {
                        throw ContextError.assistantMessageToolCallsInvalid();
                    }
                }

                // Enrich assistant messages with LLM config metadata
                message.provider = this.llmConfig.provider;
                message.router = this.llmConfig.router;
                message.model = this.llmConfig.model;
                break;

            case 'tool':
                if (!message.toolCallId || !message.name || message.content === null) {
                    throw ContextError.toolMessageFieldsMissing();
                }
                break;

            case 'system':
                // System messages should ideally be handled via setSystemPrompt
                logger.warn(
                    'ContextManager: Adding system message directly to history. Use setSystemPrompt instead.'
                );
                if (typeof message.content !== 'string' || message.content.trim() === '') {
                    throw ContextError.systemMessageContentInvalid();
                }
                break;
        }

        logger.debug(
            `ContextManager: Adding message to history provider: ${JSON.stringify(message, null, 2)}`
        );

        // Save to history provider
        await this.historyProvider.saveMessage(message);

        // Get updated history for logging
        const history = await this.historyProvider.getHistory();
        logger.debug(`ContextManager: History now contains ${history.length} messages`);

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
            throw ContextError.userMessageContentEmpty();
        }

        // If text is empty but we have attachments, use a placeholder
        const finalTextContent = textContent.trim() || (imageData || fileData ? '' : textContent);

        // Build message parts array to support multiple attachment types
        const messageParts: InternalMessage['content'] = [];

        // Add text if present
        if (finalTextContent) {
            messageParts.push({ type: 'text' as const, text: finalTextContent });
        }

        // Add image if present - store as blob if large
        if (imageData) {
            const processedImage = await this.processUserInput(imageData.image, {
                mimeType: imageData.mimeType || 'image/jpeg',
                source: 'user',
            });

            messageParts.push({
                type: 'image' as const,
                image: processedImage,
                mimeType: imageData.mimeType || 'image/jpeg',
            });
        }

        // Add file if present - store as blob if large
        if (fileData) {
            const metadata: {
                mimeType: string;
                originalName?: string;
                source?: 'user' | 'system';
            } = {
                mimeType: fileData.mimeType,
                source: 'user',
            };
            if (fileData.filename) {
                metadata.originalName = fileData.filename;
            }

            const processedData = await this.processUserInput(fileData.data, metadata);

            messageParts.push({
                type: 'file' as const,
                data: processedData,
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
     * @param metadata Optional metadata including token usage, reasoning, and model info
     * @throws Error if neither content nor toolCalls are provided
     */
    async addAssistantMessage(
        content: string | null,
        toolCalls?: InternalMessage['toolCalls'],
        metadata?: {
            tokenUsage?: InternalMessage['tokenUsage'];
            reasoning?: string;
        }
    ): Promise<void> {
        // Validate that either content or toolCalls is provided
        if (content === null && (!toolCalls || toolCalls.length === 0)) {
            throw ContextError.assistantMessageContentOrToolsRequired();
        }
        // Further validation happens within addMessage
        // addMessage will populate llm config metadata also
        await this.addMessage({
            role: 'assistant' as const,
            content,
            ...(toolCalls && toolCalls.length > 0 && { toolCalls }),
            ...(metadata?.tokenUsage && { tokenUsage: metadata.tokenUsage }),
            ...(metadata?.reasoning && { reasoning: metadata.reasoning }),
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
    async addToolResult(toolCallId: string, name: string, result: unknown): Promise<void> {
        if (!toolCallId || !name) {
            throw ContextError.toolCallIdNameRequired();
        }
        // Sanitize tool result to avoid adding non-text data as raw text
        // and to convert media/data-uris/base64 to structured parts.
        // Automatically store large media as blobs using the blob service.
        const blobService = this.resourceManager.getBlobStore();
        const content = await sanitizeToolResultToContentWithBlobs(result, blobService, {
            toolName: name,
            toolCallId,
        });

        // Log what we are storing (brief)
        if (typeof content === 'string') {
            const preview = content.slice(0, 200);
            logger.debug(
                `ContextManager: Storing tool result (text) for ${name} (len=${content.length}): ${preview}${
                    content.length > 200 ? '...' : ''
                }`
            );
        } else if (Array.isArray(content)) {
            const summary = content
                .map((p) =>
                    p.type === 'text'
                        ? `text(${p.text.length})`
                        : p.type === 'image'
                          ? `image(${p.mimeType || 'image'})`
                          : `file(${p.mimeType || 'file'})`
                )
                .join(', ');
            logger.debug(`ContextManager: Storing tool result (parts) for ${name}: [${summary}]`);
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
    ): Promise<TMessage[]> {
        // TMessage type is provided by the service that instantiates ContextManager
        // Use provided history or fetch from provider
        let messageHistory: InternalMessage[] =
            history ?? (await this.historyProvider.getHistory());

        // Resolve blob references using resource manager
        logger.debug('Resolving blob references in message history before formatting');
        messageHistory = await Promise.all(
            messageHistory.map(async (message) => {
                const expandedContent = await expandBlobReferences(
                    message.content,
                    this.resourceManager
                );
                return { ...message, content: expandedContent };
            })
        );

        // Use pre-computed system prompt if provided
        const prompt = systemPrompt ?? (await this.getSystemPrompt(contributorContext));
        return this.formatter.format([...messageHistory], llmContext, prompt) as TMessage[];
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
        formattedMessages: TMessage[];
        systemPrompt: string;
        tokensUsed: number;
    }> {
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
        ); // Type cast happens here via TMessage generic

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
        const systemPrompt = await this.getSystemPrompt(context);
        return this.formatter.formatSystemPrompt?.(systemPrompt);
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
    async processLLMStreamResponse(response: unknown): Promise<void> {
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
    async processLLMResponse(response: unknown): Promise<void> {
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
