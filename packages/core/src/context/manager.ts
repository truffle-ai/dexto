import { randomUUID } from 'crypto';
import { IMessageFormatter } from '@core/llm/formatters/types.js';
import { LLMContext } from '../llm/types.js';
import { InternalMessage, ImageData, FileData } from './types.js';
import { ITokenizer } from '../llm/tokenizer/types.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { eventBus } from '../events/index.js';
import {
    countMessagesTokens,
    expandBlobReferences,
    isLikelyBase64String,
    filterCompacted,
} from './utils.js';
import type { SanitizedToolResult } from './types.js';
import { DynamicContributorContext } from '../systemPrompt/types.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { IConversationHistoryProvider } from '@core/session/history/types.js';
import { ContextError } from './errors.js';
import { ValidatedLLMConfig } from '../llm/schemas.js';

//  Simplify this class - review what can be deleted once TurnExecutor is integrated/openai/anthropic llm services are deprecated.
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
     * Tokenizer used for counting tokens (used by TurnExecutor for compression)
     */
    private tokenizer: ITokenizer;

    /**
     * @deprecated Used by anthropic.ts and openai.ts. Will be removed when those
     * services are migrated to TurnExecutor.
     */
    private lastActualTokenCount: number = 0;

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
     * @param maxInputTokens Maximum token limit for the conversation history.
     * @param tokenizer Tokenizer implementation used for counting tokens.
     * @param historyProvider Session-scoped ConversationHistoryProvider instance for managing conversation history
     * @param sessionId Unique identifier for the conversation session (readonly, for debugging)
     * @param resourceManager ResourceManager for resolving blob references in messages
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
        logger: IDextoLogger
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
     * Returns the configured maximum number of input tokens for the conversation.
     */
    getMaxInputTokens(): number {
        return this.maxInputTokens;
    }

    /**
     * Returns the tokenizer used for token estimation.
     */
    getTokenizer(): ITokenizer {
        return this.tokenizer;
    }

    /**
     * Updates the actual token count from the last LLM response.
     *
     * @deprecated Used by anthropic.ts and openai.ts. Will be removed when those
     * services are migrated to TurnExecutor (which tracks tokens via TokenUsage).
     *
     * @param actualTokens The actual token count reported by the LLM provider
     */
    updateActualTokenCount(actualTokens: number): void {
        this.lastActualTokenCount = actualTokens;
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
     * Appends text to an existing assistant message.
     * Used for streaming responses.
     */
    async appendAssistantText(messageId: string, text: string): Promise<void> {
        const history = await this.historyProvider.getHistory();
        const messageIndex = history.findIndex((m) => m.id === messageId);

        if (messageIndex === -1) {
            throw ContextError.messageNotFound(messageId);
        }

        const message = history[messageIndex];
        if (!message) {
            throw ContextError.messageNotFound(messageId);
        }

        if (message.role !== 'assistant') {
            throw ContextError.messageNotAssistant(messageId);
        }

        // Append text
        if (typeof message.content === 'string') {
            message.content += text;
        } else if (message.content === null) {
            message.content = text;
        } else {
            // Should not happen for assistant messages unless we support multimodal assistant output
            throw ContextError.assistantContentNotString();
        }

        await this.historyProvider.updateMessage(message);
    }

    /**
     * Adds a tool call to an existing assistant message.
     * Used for streaming responses.
     */
    async addToolCall(
        messageId: string,
        toolCall: NonNullable<InternalMessage['toolCalls']>[number]
    ): Promise<void> {
        const history = await this.historyProvider.getHistory();
        const messageIndex = history.findIndex((m) => m.id === messageId);

        if (messageIndex === -1) {
            throw ContextError.messageNotFound(messageId);
        }

        const message = history[messageIndex];
        if (!message) {
            throw ContextError.messageNotFound(messageId);
        }

        if (message.role !== 'assistant') {
            throw ContextError.messageNotAssistant(messageId);
        }

        if (!message.toolCalls) {
            message.toolCalls = [];
        }

        message.toolCalls.push(toolCall);
        await this.historyProvider.updateMessage(message);
    }

    /**
     * Updates an existing assistant message with new properties.
     * Used for finalizing streaming responses (e.g. adding token usage).
     */
    async updateAssistantMessage(
        messageId: string,
        updates: Partial<InternalMessage>
    ): Promise<void> {
        const history = await this.historyProvider.getHistory();
        const messageIndex = history.findIndex((m) => m.id === messageId);

        if (messageIndex === -1) {
            throw ContextError.messageNotFound(messageId);
        }

        const message = history[messageIndex];
        if (!message) {
            throw ContextError.messageNotFound(messageId);
        }

        if (message.role !== 'assistant') {
            throw ContextError.messageNotAssistant(messageId);
        }

        Object.assign(message, updates);
        await this.historyProvider.updateMessage(message);
    }

    /**
     * Marks tool messages as compacted (pruned).
     * Sets the compactedAt timestamp - content transformation happens at format time
     * in getFormattedMessagesWithCompression(). Original content is preserved in
     * storage for debugging/audit.
     *
     * Used by TurnExecutor's pruneOldToolOutputs() to reclaim token space
     * by marking old tool outputs that are no longer needed for context.
     *
     * @param messageIds Array of message IDs to mark as compacted
     * @returns Number of messages successfully marked
     */
    async markMessagesAsCompacted(messageIds: string[]): Promise<number> {
        if (messageIds.length === 0) {
            return 0;
        }

        const history = await this.historyProvider.getHistory();
        const timestamp = Date.now();
        let markedCount = 0;

        for (const messageId of messageIds) {
            const message = history.find((m) => m.id === messageId);

            if (!message) {
                this.logger.warn(`markMessagesAsCompacted: Message ${messageId} not found`);
                continue;
            }

            if (message.role !== 'tool') {
                this.logger.warn(
                    `markMessagesAsCompacted: Message ${messageId} is not a tool message (role=${message.role})`
                );
                continue;
            }

            if (message.compactedAt) {
                // Already compacted, skip
                continue;
            }

            message.compactedAt = timestamp;
            await this.historyProvider.updateMessage(message);
            markedCount++;
        }

        if (markedCount > 0) {
            this.logger.debug(
                `markMessagesAsCompacted: Marked ${markedCount} messages as compacted`
            );
        }

        return markedCount;
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
                // System messages should be handled via SystemPromptManager, not added to history
                this.logger.warn(
                    'ContextManager: Adding system message directly to history. Use SystemPromptManager instead.'
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

        this.logger.debug(
            `ContextManager: Adding message to history provider: ${JSON.stringify(message, null, 2)}`
        );

        // Save to history provider
        await this.historyProvider.saveMessage(message);

        // Get updated history for logging
        const history = await this.historyProvider.getHistory();
        this.logger.debug(`ContextManager: History now contains ${history.length} messages`);

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
     * Adds a tool result message to the conversation.
     * The result must already be sanitized - this method only persists it.
     *
     * @param toolCallId ID of the tool call this result is responding to
     * @param name Name of the tool that executed
     * @param sanitizedResult The already-sanitized result to store
     * @throws Error if required parameters are missing
     */
    async addToolResult(
        toolCallId: string,
        name: string,
        sanitizedResult: SanitizedToolResult
    ): Promise<void> {
        if (!toolCallId || !name) {
            throw ContextError.toolCallIdNameRequired();
        }

        const summary = sanitizedResult.content
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
            content: sanitizedResult.content,
            toolCallId,
            name,
        });
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
     * 2. Get history and filter (exclude pre-summary messages)
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

        // Step 2: Get history and filter (exclude pre-summary messages)
        const fullHistory = await this.historyProvider.getHistory();
        let history = filterCompacted(fullHistory);

        // Log if filtering occurred
        if (history.length < fullHistory.length) {
            this.logger.debug(
                `filterCompacted: Reduced history from ${fullHistory.length} to ${history.length} messages (summary present)`
            );
        }

        // Step 3: Transform compacted tool messages (respects compactedAt marker)
        // Original content is preserved in storage, placeholder sent to LLM
        const compactedCount = history.filter((m) => m.role === 'tool' && m.compactedAt).length;
        if (compactedCount > 0) {
            history = history.map((msg) => {
                if (msg.role === 'tool' && msg.compactedAt) {
                    return { ...msg, content: '[Old tool result content cleared]' };
                }
                return msg;
            });
            this.logger.debug(
                `Transformed ${compactedCount} compacted tool messages to placeholders`
            );
        }

        // Step 4: Format messages with filtered and transformed history
        const formattedMessages = await this.getFormattedMessages(
            contributorContext,
            llmContext,
            systemPrompt,
            history
        ); // Type cast happens here via TMessage generic

        // TODO: Remove token estimation - TurnExecutor uses actual API tokens for overflow detection
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
}
