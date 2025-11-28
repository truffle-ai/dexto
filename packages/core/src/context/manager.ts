import { randomUUID } from 'crypto';
import { IMessageFormatter } from '@core/llm/formatters/types.js';
import { LLMContext } from '../llm/types.js';
import { InternalMessage, ImageData, FileData } from './types.js';
import { ITokenizer } from '../llm/tokenizer/types.js';
import type { ICompressionStrategy } from '../llm/executor/types.js';
import { MiddleRemovalStrategy } from '../llm/executor/strategies/middle-removal.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { eventBus } from '../events/index.js';
import {
    countMessagesTokens,
    sanitizeToolResult,
    expandBlobReferences,
    isLikelyBase64String,
} from './utils.js';
import type { SanitizedToolResult } from './types.js';
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
     * This is the REAL token count from the API - far more accurate than our estimates.
     */
    private lastActualTokenCount: number = 0;

    /**
     * Message count that corresponds to lastActualTokenCount.
     * Used to identify which messages are "new" since we got the actual count.
     * In tool loops: actualTokens came from step N, new messages are for step N+1.
     */
    private lastActualTokenMessageCount: number = 0;

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

    private logger: IDextoLogger;

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
     * @param logger Logger instance for logging
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
        logger: IDextoLogger,
        compressionStrategies: ICompressionStrategy[] = []
    ) {
        this.llmConfig = llmConfig;
        this.formatter = formatter;
        this.systemPromptManager = systemPromptManager;
        this.maxInputTokens = maxInputTokens;
        this.tokenizer = tokenizer;
        this.historyProvider = historyProvider;
        this.sessionId = sessionId;
        this.resourceManager = resourceManager;
        this.logger = logger.createChild(DextoLogComponent.CONTEXT);

        // Use MiddleRemovalStrategy as default if no strategies provided
        this.compressionStrategies =
            compressionStrategies.length > 0
                ? compressionStrategies
                : [new MiddleRemovalStrategy({}, logger)];

        this.logger.debug(
            `ContextManager: Initialized for session ${sessionId} - history will be managed by ${historyProvider.constructor.name}`
        );
    }

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

                this.logger.info(
                    `Stored user input as blob: ${blobRef.uri} (${estimatedSize} bytes, ${metadata.mimeType})`
                );

                // Emit event to invalidate resource cache so uploaded images appear in @ autocomplete
                eventBus.emit('resource:cache-invalidated', {
                    resourceUri: blobRef.uri,
                    serverName: 'internal',
                    action: 'blob_stored',
                });

                return `@${blobRef.uri}`; // Return @blob:id reference for ResourceManager
            } catch (error) {
                this.logger.warn(`Failed to store user input as blob: ${String(error)}`);
                // Fallback to storing original data
                return data;
            }
        }

        return data;
    }

    /**
     * Returns the current token count of the conversation history.
     * @returns Promise that resolves to the number of tokens in the current history
     */
    async getTokenCount(): Promise<number> {
        const history = await this.historyProvider.getHistory();
        return countMessagesTokens(history, this.tokenizer, undefined, this.logger);
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
            const historyTokens = countMessagesTokens(
                history,
                this.tokenizer,
                undefined,
                this.logger
            );

            // Add a small overhead for provider-specific formatting
            // This accounts for any additional structure the formatter adds
            const formattingOverhead = Math.ceil((systemPromptTokens + historyTokens) * 0.05); // 5% overhead

            const totalTokens = systemPromptTokens + historyTokens + formattingOverhead;

            this.logger.debug(
                `Token breakdown - System: ${systemPromptTokens}, History: ${historyTokens}, Overhead: ${formattingOverhead}, Total: ${totalTokens}`
            );

            return totalTokens;
        } catch (error) {
            this.logger.error(
                `Error calculating total token count: ${error instanceof Error ? error.message : String(error)}`,
                { error }
            );
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

        this.logger.debug(
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
        this.logger.debug(`Updated actual token count to: ${actualTokens}`);
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

        this.logger.debug(
            `Compression check: actual=${this.lastActualTokenCount}, newInput=${newInputTokens}, total=${estimatedTotal}, trigger=${compressionTrigger}`
        );

        return estimatedTotal > compressionTrigger;
    }

    /**
     * Assembles and returns the current system prompt by invoking the SystemPromptManager.
     */
    async getSystemPrompt(context: DynamicContributorContext): Promise<string> {
        const prompt = await this.systemPromptManager.build(context);
        this.logger.debug(`[SystemPrompt] Built system prompt:\n${prompt}`);
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
                this.logger.warn(
                    'ContextManager: Adding system message directly to history. Use setSystemPrompt instead.'
                );
                if (typeof message.content !== 'string' || message.content.trim() === '') {
                    throw ContextError.systemMessageContentInvalid();
                }
                break;
        }

        // Generate ID and timestamp if not provided
        if (!message.id) {
            message.id = randomUUID();
        }
        if (!message.timestamp) {
            message.timestamp = Date.now();
        }

        // Concise log for debugging message order
        const msgSummary = this.summarizeMessage(message);
        this.logger.debug(`ContextManager: +${msgSummary}`);

        // Save to history provider
        await this.historyProvider.saveMessage(message);

        // Log concise history summary showing message order
        const history = await this.historyProvider.getHistory();
        const historySummary = history
            .map((m, i) => `${i + 1}.${this.summarizeMessage(m)}`)
            .join(' → ');
        this.logger.debug(`ContextManager: History[${history.length}]: ${historySummary}`);

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
        this.logger.debug(
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
    async addToolResult(
        toolCallId: string,
        name: string,
        result: unknown,
        options?: { success?: boolean }
    ): Promise<SanitizedToolResult> {
        if (!toolCallId || !name) {
            throw ContextError.toolCallIdNameRequired();
        }
        const blobService = this.resourceManager.getBlobStore();
        const sanitizeOptions: {
            blobStore?: import('../storage/blob/types.js').BlobStore;
            toolName: string;
            toolCallId: string;
            success?: boolean;
        } = {
            blobStore: blobService,
            toolName: name,
            toolCallId,
        };
        if (options?.success !== undefined) {
            sanitizeOptions.success = options.success;
        }

        const sanitized = await sanitizeToolResult(result, sanitizeOptions, this.logger);

        const summary = sanitized.content
            .map((p) =>
                p.type === 'text'
                    ? `text(${p.text.length})`
                    : p.type === 'image'
                      ? `image(${p.mimeType || 'image'})`
                      : p.type === 'ui-resource'
                        ? `ui-resource(${p.uri})`
                        : `file(${p.mimeType || 'file'})`
            )
            .join(', ');
        this.logger.debug(`ContextManager: Storing tool result (parts) for ${name}: [${summary}]`);

        await this.addMessage({
            role: 'tool',
            content: sanitized.content,
            toolCallId,
            name,
        });

        return sanitized;
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

        // Determine allowed media types for expansion
        // Priority: User-specified config > Model capabilities from registry
        let allowedMediaTypes: string[] | undefined = this.llmConfig.allowedMediaTypes;
        if (!allowedMediaTypes) {
            // Fall back to model capabilities from registry
            try {
                const { getSupportedFileTypesForModel } = await import('../llm/registry.js');
                const { fileTypesToMimePatterns } = await import('./utils.js');
                const supportedFileTypes = getSupportedFileTypesForModel(
                    llmContext.provider,
                    llmContext.model
                );
                allowedMediaTypes = fileTypesToMimePatterns(supportedFileTypes, this.logger);
                this.logger.debug(
                    `Using model capabilities for media filtering: ${allowedMediaTypes.join(', ')}`
                );
            } catch (error) {
                this.logger.warn(
                    `Could not determine model capabilities, allowing all media types: ${String(error)}`
                );
                // If we can't determine capabilities, allow everything
                allowedMediaTypes = undefined;
            }
        } else {
            this.logger.debug(
                `Using user-configured allowedMediaTypes: ${allowedMediaTypes.join(', ')}`
            );
        }

        // Resolve blob references using resource manager with filtering
        this.logger.debug('Resolving blob references in message history before formatting');
        messageHistory = await Promise.all(
            messageHistory.map(async (message) => {
                const expandedContent = await expandBlobReferences(
                    message.content,
                    this.resourceManager,
                    this.logger,
                    allowedMediaTypes
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
        const historyTokens = countMessagesTokens(history, this.tokenizer, undefined, this.logger);
        const formattingOverhead = Math.ceil((systemPromptTokens + historyTokens) * 0.05);
        const tokensUsed = systemPromptTokens + historyTokens + formattingOverhead;

        this.logger.debug(
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
        this.logger.debug(
            `ContextManager: Conversation history cleared for session ${this.sessionId}`
        );
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
        let currentTotalTokens: number = countMessagesTokens(
            history,
            this.tokenizer,
            undefined,
            this.logger
        );
        currentTotalTokens += systemPromptTokens;

        this.logger.debug(`ContextManager: Checking if history compression is needed.`);
        this.logger.debug(
            `History tokens: ${countMessagesTokens(history, this.tokenizer, undefined, this.logger)}, System prompt tokens: ${systemPromptTokens}, Total: ${currentTotalTokens}`
        );

        // If counting failed or we are within limits, do nothing
        if (currentTotalTokens <= this.maxInputTokens) {
            this.logger.debug(
                `ContextManager: History compression not needed. Total token count: ${currentTotalTokens}, Max tokens: ${this.maxInputTokens}`
            );
            return history;
        }

        this.logger.info(
            `ContextManager: History exceeds token limit (${currentTotalTokens} > ${this.maxInputTokens}). Applying compression strategies sequentially.`
        );

        const initialLength = history.length;
        let workingHistory = [...history];

        // Calculate target tokens for history (leave room for system prompt)
        const targetHistoryTokens = this.maxInputTokens - systemPromptTokens;

        // Iterate through the configured compression strategies sequentially
        for (const strategy of this.compressionStrategies) {
            const strategyName = strategy.constructor.name; // Get the class name for logging
            this.logger.debug(`ContextManager: Applying ${strategyName}...`);

            try {
                // Pass a copy of the history to avoid potential side effects within the strategy
                // The strategy should return the new, potentially compressed, history
                // Note: await handles both sync and async strategies
                workingHistory = await strategy.compress(
                    [...workingHistory],
                    this.tokenizer,
                    targetHistoryTokens // Use target tokens that account for system prompt
                );
            } catch (error) {
                this.logger.error(
                    `ContextManager: Error applying ${strategyName}: ${error instanceof Error ? error.message : String(error)}`,
                    { error }
                );
                // Decide if we should stop or try the next strategy. Let's stop for now.
                break;
            }

            // Recalculate tokens after applying the strategy
            const historyTokens = countMessagesTokens(
                workingHistory,
                this.tokenizer,
                undefined,
                this.logger
            );
            currentTotalTokens = historyTokens + systemPromptTokens;
            const messagesRemoved = initialLength - workingHistory.length;

            // If counting failed or we are now within limits, stop applying strategies
            if (currentTotalTokens <= this.maxInputTokens) {
                this.logger.debug(
                    `ContextManager: Compression successful after ${strategyName}. New total count: ${currentTotalTokens}, messages removed: ${messagesRemoved}`
                );
                break;
            }
        }

        return workingHistory;
    }

    /**
     * Result of mid-loop compression including metadata for event emission
     */
    public static readonly NO_COMPRESSION = Symbol('NO_COMPRESSION');

    /**
     * Compresses provider-specific messages mid-loop during multi-step tool calling.
     * Used by Vercel SDK's prepareStep callback to prevent context overflow during tool loops.
     *
     * Flow:
     * 1. Extract system prompt from messages (if present)
     * 2. Parse remaining messages to InternalMessage[]
     * 3. Compress if over token limit
     * 4. Format back to provider-specific format
     * 5. Re-add system prompt
     *
     * @param messages Provider-specific messages (e.g., ModelMessage[] for Vercel)
     * @param llmContext Context with provider/model info for formatting
     * @returns Object with compressed messages and metadata, or null if no compression needed
     */
    compressMessagesForPrepareStep(
        messages: TMessage[],
        llmContext: import('../llm/types.js').LLMContext
    ): {
        messages: TMessage[];
        compressed: boolean;
        metadata?: {
            originalTokens: number;
            compressedTokens: number;
            originalMessages: number;
            compressedMessages: number;
            strategy: string;
        };
    } {
        // Check if formatter supports parseMessages (currently only Vercel)
        if (!this.formatter.parseMessages) {
            this.logger.debug(
                'ContextManager: Formatter does not support parseMessages, skipping mid-loop compression'
            );
            return { messages, compressed: false };
        }

        // Extract system message if present (always first in Vercel format)
        const rawMessages = messages as unknown[];
        let systemPrompt: string | null = null;
        let messagesToParse = rawMessages;

        if (rawMessages.length > 0) {
            const firstMsg = rawMessages[0] as { role?: string; content?: unknown };
            if (firstMsg.role === 'system' && typeof firstMsg.content === 'string') {
                systemPrompt = firstMsg.content;
                messagesToParse = rawMessages.slice(1);
            }
        }

        // Parse to InternalMessage[]
        const internalMessages = this.formatter.parseMessages(messagesToParse);
        const currentMessageCount = internalMessages.length;

        // Calculate tokens using HYBRID approach:
        // - If we have actual tokens from previous step, use that + estimate only NEW messages
        // - This is far more accurate than re-estimating everything (especially for images!)
        const systemPromptTokens = systemPrompt ? this.tokenizer.countTokens(systemPrompt) : 0;
        let totalTokens: number;
        let estimationMethod: string;

        if (
            this.lastActualTokenCount > 0 &&
            currentMessageCount > this.lastActualTokenMessageCount
        ) {
            // HYBRID: Use actual count from API + estimate only new messages
            // lastActualTokenCount already includes system prompt from previous step
            const newMessages = internalMessages.slice(this.lastActualTokenMessageCount);
            const newTokens = countMessagesTokens(
                newMessages,
                this.tokenizer,
                undefined,
                this.logger
            );
            totalTokens = this.lastActualTokenCount + newTokens;
            estimationMethod = 'hybrid';

            this.logger.debug(
                `ContextManager prepareStep (hybrid): prevActual=${this.lastActualTokenCount}, ` +
                    `newMsgs=${newMessages.length}, newTokens=${newTokens}, total=${totalTokens}, max=${this.maxInputTokens}`
            );
        } else if (
            this.lastActualTokenCount > 0 &&
            currentMessageCount === this.lastActualTokenMessageCount
        ) {
            // Same messages as before - use actual count directly
            totalTokens = this.lastActualTokenCount;
            estimationMethod = 'actual';

            this.logger.debug(
                `ContextManager prepareStep (actual): ${totalTokens}, max=${this.maxInputTokens}`
            );
        } else {
            // Fallback: Full estimation (first step or after compression reset)
            const historyTokens = countMessagesTokens(
                internalMessages,
                this.tokenizer,
                undefined,
                this.logger
            );
            totalTokens = systemPromptTokens + historyTokens;
            estimationMethod = 'full-estimate';

            this.logger.debug(
                `ContextManager prepareStep (full): system=${systemPromptTokens}, history=${historyTokens}, total=${totalTokens}, max=${this.maxInputTokens}`
            );
        }

        // Update message count tracking for next iteration
        // This count will correspond to the next actual token count we receive
        this.lastActualTokenMessageCount = currentMessageCount;

        // Check if compression is needed (using threshold)
        const compressionTrigger = this.maxInputTokens * this.compressionThreshold;
        if (totalTokens <= compressionTrigger) {
            this.logger.debug(
                `ContextManager prepareStep: No compression needed (${totalTokens} <= ${compressionTrigger}) [${estimationMethod}]`
            );
            return { messages, compressed: false };
        }

        // Apply compression
        this.logger.info(
            `ContextManager prepareStep: Compressing mid-loop (${totalTokens} > ${compressionTrigger}) [${estimationMethod}]`
        );
        const { history: compressedHistory, strategyUsed } = this.compressHistorySync(
            internalMessages,
            systemPromptTokens
        );

        // Format back to provider-specific format
        const formattedMessages = this.formatter.format(
            compressedHistory,
            llmContext,
            systemPrompt
        ) as TMessage[];

        const newHistoryTokens = countMessagesTokens(
            compressedHistory,
            this.tokenizer,
            undefined,
            this.logger
        );
        this.logger.info(
            `ContextManager prepareStep: Compressed from ${internalMessages.length} to ${compressedHistory.length} messages (${totalTokens} -> ${systemPromptTokens + newHistoryTokens} tokens)`
        );

        // Reset tracking after compression - we don't have accurate actual counts anymore
        // Next step will get fresh actual counts from the API
        this.lastActualTokenCount = 0;
        this.lastActualTokenMessageCount = 0;

        return {
            messages: formattedMessages,
            compressed: true,
            metadata: {
                originalTokens: totalTokens,
                compressedTokens: systemPromptTokens + newHistoryTokens,
                originalMessages: internalMessages.length,
                compressedMessages: compressedHistory.length,
                strategy: strategyUsed,
            },
        };
    }

    /**
     * Synchronous version of compressHistoryIfNeeded for use in prepareStep callback.
     * Note: prepareStep in Vercel SDK is synchronous, so we can't use async compression strategies.
     *
     * @param history The conversation history to compress
     * @param systemPromptTokens Token count of system prompt
     * @returns Object with compressed history and strategy name that succeeded
     */
    private compressHistorySync(
        history: InternalMessage[],
        systemPromptTokens: number
    ): { history: InternalMessage[]; strategyUsed: string } {
        let currentTotalTokens = countMessagesTokens(
            history,
            this.tokenizer,
            undefined,
            this.logger
        );
        currentTotalTokens += systemPromptTokens;

        if (currentTotalTokens <= this.maxInputTokens) {
            return { history, strategyUsed: 'none' };
        }

        const initialLength = history.length;
        let workingHistory = [...history];
        const targetHistoryTokens = this.maxInputTokens - systemPromptTokens;
        let lastSuccessfulStrategy = 'unknown';

        for (const strategy of this.compressionStrategies) {
            const strategyName = strategy.constructor.name;
            this.logger.debug(`ContextManager prepareStep: Applying ${strategyName}...`);

            try {
                const result = strategy.compress(
                    [...workingHistory],
                    this.tokenizer,
                    targetHistoryTokens
                );
                // prepareStep callback must be synchronous, so async strategies cannot be used here
                if (result instanceof Promise) {
                    this.logger.warn(
                        `ContextManager prepareStep: Strategy ${strategyName} returned a Promise but prepareStep is synchronous. Skipping.`
                    );
                    continue;
                }
                workingHistory = result;
                lastSuccessfulStrategy = strategyName;
            } catch (error) {
                this.logger.error(
                    `ContextManager prepareStep: Error applying ${strategyName}: ${error instanceof Error ? error.message : String(error)}`
                );
                break;
            }

            const historyTokens = countMessagesTokens(
                workingHistory,
                this.tokenizer,
                undefined,
                this.logger
            );
            currentTotalTokens = historyTokens + systemPromptTokens;
            const messagesRemoved = initialLength - workingHistory.length;

            if (currentTotalTokens <= this.maxInputTokens) {
                this.logger.debug(
                    `ContextManager prepareStep: Compression successful after ${strategyName}. New total: ${currentTotalTokens}, removed: ${messagesRemoved}`
                );
                break;
            }
        }

        return { history: workingHistory, strategyUsed: lastSuccessfulStrategy };
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
                    this.logger.error(
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
                this.logger.error(
                    `ContextManager: Failed to process LLM response message for session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
                );
                // Continue processing other messages rather than failing completely
            }
        }
    }

    /**
     * Creates a concise summary of a message for debugging logs.
     * Shows role and key identifiers without message content.
     *
     * Examples:
     * - user
     * - asst
     * - asst(tool:get_screen,press_button)
     * - tool:get_screen
     */
    private summarizeMessage(message: InternalMessage): string {
        switch (message.role) {
            case 'user':
                return 'user';
            case 'assistant': {
                if (message.toolCalls && message.toolCalls.length > 0) {
                    const toolNames = message.toolCalls.map((tc) => tc.function.name).join(',');
                    return `asst(tool:${toolNames})`;
                }
                return 'asst';
            }
            case 'tool':
                return `tool:${message.name || 'unknown'}`;
            case 'system':
                return 'system';
            default:
                return `unknown(${message.role})`;
        }
    }
}
