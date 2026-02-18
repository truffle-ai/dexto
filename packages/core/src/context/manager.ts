import { randomUUID } from 'crypto';
import { VercelMessageFormatter } from '../llm/formatters/vercel.js';
import { LLMContext } from '../llm/types.js';
import type { InternalMessage, AssistantMessage, ToolCall } from './types.js';
import { isSystemMessage, isUserMessage, isAssistantMessage, isToolMessage } from './types.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import {
    expandBlobReferences,
    isLikelyBase64String,
    filterCompacted,
    estimateContextTokens,
    estimateMessagesTokens,
} from './utils.js';
import type { SanitizedToolResult } from './types.js';
import { DynamicContributorContext } from '../systemPrompt/types.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import type { ConversationHistoryProvider } from '../session/history/types.js';
import { ContextError } from './errors.js';
import { ValidatedLLMConfig } from '../llm/schemas.js';

/**
 * Manages conversation history and provides message formatting capabilities for the LLM context.
 * The ContextManager is responsible for:
 * - Validating and storing conversation messages via the history provider
 * - Managing the system prompt
 * - Formatting messages for specific LLM providers through an injected formatter
 * - Providing access to conversation history
 *
 * Note: All conversation history is stored and retrieved via the injected ConversationHistoryProvider.
 * The ContextManager does not maintain an internal history cache.
 * Token counting is handled by the LLM API response, not local estimation.
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
    private formatter: VercelMessageFormatter;

    /**
     * Maximum number of tokens allowed in the conversation (if specified)
     */
    private maxInputTokens: number;

    /**
     * Last known actual input token count from the LLM API response.
     * Updated after each LLM call. Used by /context for accurate reporting.
     */
    private lastActualInputTokens: number | null = null;

    /**
     * Last known actual output token count from the LLM API response.
     * Updated after each LLM call. Used in the context estimation formula:
     * estimatedNextInput = lastInputTokens + lastOutputTokens + newMessagesEstimate
     */
    private lastActualOutputTokens: number | null = null;

    /**
     * Message count at the time of the last LLM call.
     * Used to identify which messages are "new" since the last call.
     * Messages after this index are estimated with length/4 heuristic.
     */
    private lastCallMessageCount: number | null = null;

    private historyProvider: ConversationHistoryProvider;
    private readonly sessionId: string;

    /**
     * ResourceManager for resolving blob references in message content.
     * Blob references like @blob:abc123 are resolved to actual data
     * before passing messages to the LLM formatter.
     */
    private resourceManager: import('../resources/index.js').ResourceManager;

    private logger: Logger;

    /**
     * Creates a new ContextManager instance
     * @param llmConfig The validated LLM configuration.
     * @param formatter Formatter implementation for the target LLM provider
     * @param systemPromptManager SystemPromptManager instance for the conversation
     * @param maxInputTokens Maximum token limit for the conversation history.
     * @param historyProvider Session-scoped ConversationHistoryProvider instance for managing conversation history
     * @param sessionId Unique identifier for the conversation session (readonly, for debugging)
     * @param resourceManager ResourceManager for resolving blob references in messages
     * @param logger Logger instance for logging
     */
    constructor(
        llmConfig: ValidatedLLMConfig,
        formatter: VercelMessageFormatter,
        systemPromptManager: SystemPromptManager,
        maxInputTokens: number,
        historyProvider: ConversationHistoryProvider,
        sessionId: string,
        resourceManager: import('../resources/index.js').ResourceManager,
        logger: Logger
    ) {
        this.llmConfig = llmConfig;
        this.formatter = formatter;
        this.systemPromptManager = systemPromptManager;
        this.maxInputTokens = maxInputTokens;
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
                this.resourceManager.emitCacheInvalidated({
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
     * Returns the last known actual input token count from the LLM API.
     * Returns null if no LLM call has been made yet.
     */
    getLastActualInputTokens(): number | null {
        return this.lastActualInputTokens;
    }

    /**
     * Updates the last known actual input token count.
     * Called after each LLM response with the actual usage from the API.
     */
    setLastActualInputTokens(tokens: number): void {
        this.lastActualInputTokens = tokens;
        this.logger.debug(`Updated lastActualInputTokens: ${tokens}`);
    }

    /**
     * Returns the last known actual output token count from the LLM API.
     * Returns null if no LLM call has been made yet.
     */
    getLastActualOutputTokens(): number | null {
        return this.lastActualOutputTokens;
    }

    /**
     * Updates the last known actual output token count.
     * Called after each LLM response with the actual usage from the API.
     */
    setLastActualOutputTokens(tokens: number): void {
        this.lastActualOutputTokens = tokens;
        this.logger.debug(`Updated lastActualOutputTokens: ${tokens}`);
    }

    /**
     * Returns the message count at the time of the last LLM call.
     * Returns null if no LLM call has been made yet.
     */
    getLastCallMessageCount(): number | null {
        return this.lastCallMessageCount;
    }

    /**
     * Records the current message count after an LLM call completes.
     * This marks the boundary for "new messages" calculation.
     */
    async recordLastCallMessageCount(): Promise<void> {
        const history = await this.historyProvider.getHistory();
        this.lastCallMessageCount = history.length;
        this.logger.debug(`Recorded lastCallMessageCount: ${this.lastCallMessageCount}`);
    }

    /**
     * Resets the actual token tracking state.
     * Called after compaction since the context has fundamentally changed.
     */
    resetActualTokenTracking(): void {
        this.lastActualInputTokens = null;
        this.lastActualOutputTokens = null;
        this.lastCallMessageCount = null;
        this.logger.debug('Reset actual token tracking state (after compaction)');
    }

    // ============= HISTORY PREPARATION =============

    /**
     * Placeholder text used when tool outputs are pruned.
     * Shared constant to ensure consistency between preparation and estimation.
     */
    private static readonly PRUNED_TOOL_PLACEHOLDER = '[Old tool result content cleared]';

    /**
     * Prepares conversation history for LLM consumption.
     * This is the single source of truth for history transformation logic.
     *
     * Transformations applied:
     * 1. filterCompacted - Remove pre-summary messages (messages before the most recent summary)
     * 2. Transform pruned tool messages - Replace compactedAt messages with placeholder text
     *
     * Used by both:
     * - getFormattedMessagesForLLM() - For actual LLM calls
     * - getContextTokenEstimate() - For /context command estimation
     *
     * @returns Prepared history and statistics about the transformations
     */
    async prepareHistory(): Promise<{
        preparedHistory: InternalMessage[];
        stats: {
            /** Total messages in raw history */
            originalCount: number;
            /** Messages after filterCompacted (removed pre-summary) */
            filteredCount: number;
            /** Messages with compactedAt that were transformed to placeholders */
            prunedToolCount: number;
        };
    }> {
        const fullHistory = await this.historyProvider.getHistory();
        const originalCount = fullHistory.length;

        // Step 1: Filter compacted (remove pre-summary messages)
        let history = filterCompacted(fullHistory);
        const filteredCount = history.length;

        if (filteredCount < originalCount) {
            this.logger.debug(
                `prepareHistory: filterCompacted reduced from ${originalCount} to ${filteredCount} messages`
            );
        }

        // Step 2: Transform compacted tool messages to placeholders
        // Original content is preserved in storage, placeholder sent to LLM
        let prunedToolCount = 0;
        history = history.map((msg) => {
            if (msg.role === 'tool' && msg.compactedAt) {
                prunedToolCount++;
                return {
                    ...msg,
                    content: [
                        { type: 'text' as const, text: ContextManager.PRUNED_TOOL_PLACEHOLDER },
                    ],
                };
            }
            return msg;
        });

        if (prunedToolCount > 0) {
            this.logger.debug(
                `prepareHistory: Transformed ${prunedToolCount} pruned tool messages to placeholders`
            );
        }

        return {
            preparedHistory: history,
            stats: {
                originalCount,
                filteredCount,
                prunedToolCount,
            },
        };
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
     * Flush any pending history updates to durable storage.
     * Should be called at turn boundaries (after streaming completes, on cancel, on error).
     * This ensures all message updates are persisted before returning control to the caller.
     */
    async flush(): Promise<void> {
        await this.historyProvider.flush();
    }

    /**
     * Clears the context window without deleting history.
     *
     * This adds a "context clear" marker to the conversation history. When the
     * context is loaded for LLM via getFormattedMessagesWithCompression(),
     * filterCompacted() excludes all messages before this marker.
     *
     * The full history remains in the database for review via /resume or session history.
     */
    async clearContext(): Promise<void> {
        const clearMarker: InternalMessage = {
            id: `clear-${Date.now()}`,
            role: 'assistant',
            content: [{ type: 'text', text: '[Context cleared]' }],
            timestamp: Date.now(),
            metadata: {
                isSummary: true,
                clearedAt: Date.now(),
            },
        };

        await this.addMessage(clearMarker);
        this.resetActualTokenTracking();
        this.logger.debug(`Context cleared for session: ${this.sessionId}`);
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

        // Append text to content array
        if (message.content === null) {
            message.content = [{ type: 'text', text }];
        } else if (Array.isArray(message.content)) {
            // Find last text part and append, or add new text part
            const lastPart = message.content[message.content.length - 1];
            if (lastPart && lastPart.type === 'text') {
                lastPart.text += text;
            } else {
                message.content.push({ type: 'text', text });
            }
        }

        await this.historyProvider.updateMessage(message);
    }

    /**
     * Adds a tool call to an existing assistant message.
     * Used for streaming responses.
     */
    async addToolCall(messageId: string, toolCall: ToolCall): Promise<void> {
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
                // User messages must have non-empty content array
                if (!Array.isArray(message.content) || message.content.length === 0) {
                    throw ContextError.userMessageContentInvalid();
                }
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
                message.model = this.llmConfig.model;
                break;

            case 'tool':
                if (!message.toolCallId || !message.name || message.content === null) {
                    throw ContextError.toolMessageFieldsMissing();
                }
                break;

            case 'system': {
                // System messages should be handled via SystemPromptManager, not added to history
                this.logger.warn(
                    'ContextManager: Adding system message directly to history. Use SystemPromptManager instead.'
                );
                // Extract text from content array for validation
                const textContent = message.content
                    ?.filter((p): p is import('./types.js').TextPart => p.type === 'text')
                    .map((p) => p.text)
                    .join('');
                if (!textContent || textContent.trim() === '') {
                    throw ContextError.systemMessageContentInvalid();
                }
                break;
            }
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
     * Adds a user message to the conversation.
     * Supports multiple images and files via ContentPart[].
     *
     * @param content Array of content parts (text, images, files)
     * @throws Error if content is empty or invalid
     */
    async addUserMessage(content: import('./types.js').ContentPart[]): Promise<void> {
        if (!Array.isArray(content) || content.length === 0) {
            throw ContextError.userMessageContentEmpty();
        }

        // Validate at least one text part or attachment exists
        const hasText = content.some((p) => p.type === 'text' && p.text.trim() !== '');
        const hasAttachment = content.some((p) => p.type === 'image' || p.type === 'file');

        if (!hasText && !hasAttachment) {
            throw ContextError.userMessageContentEmpty();
        }

        // Process all parts, storing large attachments as blobs
        const processedParts: InternalMessage['content'] = [];

        for (const part of content) {
            if (part.type === 'text') {
                if (part.text.trim()) {
                    processedParts.push({ type: 'text', text: part.text });
                }
            } else if (part.type === 'image') {
                const processedImage = await this.processUserInput(part.image, {
                    mimeType: part.mimeType || 'image/jpeg',
                    source: 'user',
                });

                processedParts.push({
                    type: 'image',
                    image: processedImage,
                    mimeType: part.mimeType || 'image/jpeg',
                });
            } else if (part.type === 'file') {
                const metadata: {
                    mimeType: string;
                    originalName?: string;
                    source?: 'user' | 'system';
                } = {
                    mimeType: part.mimeType,
                    source: 'user',
                };
                if (part.filename) {
                    metadata.originalName = part.filename;
                }

                const processedData = await this.processUserInput(part.data, metadata);

                processedParts.push({
                    type: 'file',
                    data: processedData,
                    mimeType: part.mimeType,
                    ...(part.filename && { filename: part.filename }),
                });
            }
        }

        // Count parts for logging
        const textParts = processedParts.filter((p) => p.type === 'text');
        const imageParts = processedParts.filter((p) => p.type === 'image');
        const fileParts = processedParts.filter((p) => p.type === 'file');

        this.logger.info('User message received', {
            textParts: textParts.length,
            imageParts: imageParts.length,
            fileParts: fileParts.length,
            totalParts: processedParts.length,
        });

        await this.addMessage({ role: 'user', content: processedParts });
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
        toolCalls?: AssistantMessage['toolCalls'],
        metadata?: {
            tokenUsage?: AssistantMessage['tokenUsage'];
            reasoning?: string;
        }
    ): Promise<void> {
        // Validate that either content or toolCalls is provided
        if (content === null && (!toolCalls || toolCalls.length === 0)) {
            throw ContextError.assistantMessageContentOrToolsRequired();
        }
        // Convert string content to content array
        const contentArray: InternalMessage['content'] =
            content !== null ? [{ type: 'text', text: content }] : null;
        // Further validation happens within addMessage
        // addMessage will populate llm config metadata also
        await this.addMessage({
            role: 'assistant' as const,
            content: contentArray,
            ...(toolCalls && toolCalls.length > 0 && { toolCalls }),
            ...(metadata?.tokenUsage && { tokenUsage: metadata.tokenUsage }),
            ...(metadata?.reasoning && { reasoning: metadata.reasoning }),
        });
    }

    /**
     * Adds a tool result message to the conversation.
     * The result must already be sanitized - this method only persists it.
     *
     * Success status is read from sanitizedResult.meta.success (single source of truth).
     *
     * @param toolCallId ID of the tool call this result is responding to
     * @param name Name of the tool that executed
     * @param sanitizedResult The already-sanitized result to store (includes success in meta)
     * @param metadata Optional approval-related metadata
     * @throws Error if required parameters are missing
     */
    async addToolResult(
        toolCallId: string,
        name: string,
        sanitizedResult: SanitizedToolResult,
        metadata?: {
            requireApproval?: boolean;
            approvalStatus?: 'approved' | 'rejected';
            toolDisplayName?: string;
        }
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
            ...(metadata?.toolDisplayName !== undefined && {
                toolDisplayName: metadata.toolDisplayName,
            }),
            // Success status comes from sanitizedResult.meta (single source of truth)
            success: sanitizedResult.meta.success,
            // Persist display data for rich rendering on session resume
            ...(sanitizedResult.meta.display !== undefined && {
                displayData: sanitizedResult.meta.display,
            }),
            // Persist approval metadata for frontend display after reload
            ...(metadata?.requireApproval !== undefined && {
                requireApproval: metadata.requireApproval,
            }),
            ...(metadata?.approvalStatus !== undefined && {
                approvalStatus: metadata.approvalStatus,
            }),
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
                const { getSupportedFileTypesForModel } = await import('../llm/registry/index.js');
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
        // Only user and tool messages can contain blob references (images, files)
        // System and assistant messages have string-only content - no blob expansion needed
        this.logger.debug('Resolving blob references in message history before formatting');
        messageHistory = await Promise.all(
            messageHistory.map(async (message): Promise<InternalMessage> => {
                if (isSystemMessage(message) || isAssistantMessage(message)) {
                    // System/assistant messages have string content, no blob refs
                    return message;
                }
                if (isUserMessage(message)) {
                    const expandedContent = await expandBlobReferences(
                        message.content,
                        this.resourceManager,
                        this.logger,
                        allowedMediaTypes
                    );
                    return { ...message, content: expandedContent };
                }
                if (isToolMessage(message)) {
                    const expandedContent = await expandBlobReferences(
                        message.content,
                        this.resourceManager,
                        this.logger,
                        allowedMediaTypes
                    );
                    return { ...message, content: expandedContent };
                }
                // Should never reach here, but TypeScript needs exhaustive check
                return message;
            })
        );

        // Use pre-computed system prompt if provided
        const prompt = systemPrompt ?? (await this.getSystemPrompt(contributorContext));
        return this.formatter.format([...messageHistory], llmContext, prompt) as TMessage[];
    }

    /**
     * Gets the conversation ready for LLM consumption with proper flow:
     * 1. Get system prompt
     * 2. Prepare history (filter + transform pruned messages)
     * 3. Format messages for LLM API
     *
     * @param contributorContext The DynamicContributorContext for system prompt contributors and formatting
     * @param llmContext The llmContext for the formatter to decide which messages to include based on the model's capabilities
     * @returns Object containing formatted messages, system prompt, and prepared history
     */
    async getFormattedMessagesForLLM(
        contributorContext: DynamicContributorContext,
        llmContext: LLMContext
    ): Promise<{
        formattedMessages: TMessage[];
        systemPrompt: string;
        preparedHistory: InternalMessage[];
    }> {
        // Step 1: Get system prompt
        const systemPrompt = await this.getSystemPrompt(contributorContext);

        // Step 2: Prepare history (single source of truth for transformations)
        const { preparedHistory } = await this.prepareHistory();

        // Step 3: Format messages with prepared history
        const formattedMessages = await this.getFormattedMessages(
            contributorContext,
            llmContext,
            systemPrompt,
            preparedHistory
        );

        return {
            formattedMessages,
            systemPrompt,
            preparedHistory,
        };
    }

    /**
     * Estimates context token usage for the /context command and compaction decisions.
     * Uses the same prepareHistory() logic as getFormattedMessagesForLLM() to ensure consistency.
     *
     * When actuals are available from previous LLM calls:
     *   estimatedNextInput = lastInputTokens + lastOutputTokens + newMessagesEstimate
     *
     * This formula is more accurate because:
     * - lastInputTokens: exactly what the API processed (ground truth)
     * - lastOutputTokens: exactly what the LLM returned (ground truth)
     * - newMessagesEstimate: only estimate the delta (tool results, new user messages)
     *
     * When no LLM call has been made yet (or after compaction), falls back to pure estimation.
     *
     * @param contributorContext Context for building the system prompt
     * @param tools Tool definitions to include in the estimate
     * @returns Token estimates with breakdown and comparison to actual (if available)
     */
    async getContextTokenEstimate(
        contributorContext: DynamicContributorContext,
        tools: Record<string, { name?: string; description?: string; parameters?: unknown }>
    ): Promise<{
        /** Total estimated tokens */
        estimated: number;
        /** Last actual token count from LLM API (null if no calls made yet) */
        actual: number | null;
        /** Breakdown by category */
        breakdown: {
            systemPrompt: number;
            tools: {
                total: number;
                perTool: Array<{ name: string; tokens: number }>;
            };
            messages: number;
        };
        /** Preparation stats */
        stats: {
            originalMessageCount: number;
            filteredMessageCount: number;
            prunedToolCount: number;
        };
        /** Calculation basis for debugging/display */
        calculationBasis?: {
            /** Whether we used the actual-based formula or pure estimation */
            method: 'actuals' | 'estimate';
            /** Last actual input tokens from API (if method is 'actuals') */
            lastInputTokens?: number;
            /** Last actual output tokens from API (if method is 'actuals') */
            lastOutputTokens?: number;
            /** Estimated tokens for new messages since last call (if method is 'actuals') */
            newMessagesEstimate?: number;
        };
    }> {
        // Step 1: Get system prompt (same as LLM preparation)
        const systemPrompt = await this.getSystemPrompt(contributorContext);

        // Step 2: Prepare history (same as LLM preparation - single source of truth)
        const { preparedHistory, stats } = await this.prepareHistory();

        // Step 3: Calculate tokens using Phase 4 formula when actuals are available
        // Formula: estimatedNextInput = lastInputTokens + lastOutputTokens + newMessagesEstimate
        const lastInput = this.lastActualInputTokens;
        const lastOutput = this.lastActualOutputTokens;
        const lastMsgCount = this.lastCallMessageCount;
        const currentHistory = await this.historyProvider.getHistory();

        // Get pure estimate as fallback and for breakdown calculation
        const pureEstimate = estimateContextTokens(systemPrompt, preparedHistory, tools);

        let total: number;
        let calculationBasis: {
            method: 'actuals' | 'estimate';
            lastInputTokens?: number;
            lastOutputTokens?: number;
            newMessagesEstimate?: number;
        };

        // Use actuals-based formula if we have all the required values
        if (lastInput !== null && lastOutput !== null && lastMsgCount !== null) {
            // Calculate estimate for messages added AFTER the last LLM call
            // These are: tool results from the last assistant's tool calls + any new user messages
            const newMessages = currentHistory.slice(lastMsgCount);
            const newMessagesEstimate = estimateMessagesTokens(newMessages);

            // Apply the formula
            total = lastInput + lastOutput + newMessagesEstimate;

            calculationBasis = {
                method: 'actuals',
                lastInputTokens: lastInput,
                lastOutputTokens: lastOutput,
                newMessagesEstimate,
            };

            this.logger.info(
                `Context estimate (actuals-based): lastInput=${lastInput}, lastOutput=${lastOutput}, ` +
                    `newMsgs=${newMessagesEstimate} (${newMessages.length} messages), total=${total}`
            );
        } else {
            // Fallback to pure estimation when no actuals available
            total = pureEstimate.total;

            calculationBasis = {
                method: 'estimate',
            };

            this.logger.debug(
                `Context estimate (pure estimate): total=${total} (no actuals available yet)`
            );
        }

        // Step 4: Calculate breakdown for display
        // System and tools are always estimated. Messages is back-calculated so numbers add up.
        const systemPromptTokens = pureEstimate.breakdown.systemPrompt;
        const toolsTokens = pureEstimate.breakdown.tools;

        // Back-calculate messages so: systemPrompt + tools + messages = total
        const messagesDisplay = Math.max(0, total - systemPromptTokens - toolsTokens.total);

        // Log calibration info when we have actuals to compare against pure estimate
        if (lastInput !== null) {
            const pureTotal = pureEstimate.total;
            const diff = pureTotal - lastInput;
            const diffPercent = lastInput > 0 ? ((diff / lastInput) * 100).toFixed(1) : '0.0';
            this.logger.info(
                `Context token calibration: pureEstimate=${pureTotal}, lastActual=${lastInput}, ` +
                    `diff=${diff} (${diffPercent}%)`
            );
        }

        return {
            estimated: total,
            actual: lastInput,
            breakdown: {
                systemPrompt: systemPromptTokens,
                tools: toolsTokens,
                messages: messagesDisplay,
            },
            stats: {
                originalMessageCount: stats.originalCount,
                filteredMessageCount: stats.filteredCount,
                prunedToolCount: stats.prunedToolCount,
            },
            calculationBasis,
        };
    }

    /**
     * Estimates the next input token count using actual token data from the previous LLM call.
     * This is a lightweight version for compaction pre-checks that only returns the total.
     *
     * ## Formula (when actuals are available):
     *   estimatedNextInput = lastInputTokens + lastOutputTokens + newMessagesEstimate
     *
     * ## Why this formula works:
     *
     * Consider two consecutive LLM calls:
     *
     * ```
     * Call N:
     *   Input sent: system + tools + [user1]           = lastInput tokens
     *   Output received: assistant response            = lastOutput tokens
     *
     * Call N+1:
     *   Input will be: system + tools + [user1, assistant1, user2, ...]
     *                ≈ lastInput + assistant1_as_input + new_messages
     *                ≈ lastInput + lastOutput + newMessagesEstimate
     * ```
     *
     * The assistant's response (lastOutput) becomes part of the next input as conversation
     * history. Text tokenizes similarly whether sent as input or received as output.
     *
     * ## No double-counting:
     *
     * The assistant message is added to history DURING streaming (before this method runs),
     * and recordLastCallMessageCount() captures the count INCLUDING that message.
     * Therefore, newMessages = history.slice(lastMsgCount) EXCLUDES the assistant message,
     * so lastOutput and newMessages don't overlap.
     *
     * ## Pruning caveat:
     *
     * If tool output pruning occurs between calls, lastInput may be stale (higher than
     * actual). This causes OVERESTIMATION, which is SAFE - we'd trigger compaction
     * earlier rather than risk context overflow.
     *
     * @param systemPrompt The system prompt string
     * @param preparedHistory Message history AFTER filterCompacted and pruning
     * @param tools Tool definitions
     * @returns Estimated total input tokens for the next LLM call
     */
    async getEstimatedNextInputTokens(
        systemPrompt: string,
        preparedHistory: readonly InternalMessage[],
        tools: Record<string, { name?: string; description?: string; parameters?: unknown }>
    ): Promise<number> {
        const lastInput = this.lastActualInputTokens;
        const lastOutput = this.lastActualOutputTokens;
        const lastMsgCount = this.lastCallMessageCount;
        const currentHistory = await this.historyProvider.getHistory();

        // Use actuals-based formula if we have all the required values
        if (lastInput !== null && lastOutput !== null && lastMsgCount !== null) {
            const newMessages = currentHistory.slice(lastMsgCount);
            const newMessagesEstimate = estimateMessagesTokens(newMessages);
            const total = lastInput + lastOutput + newMessagesEstimate;

            this.logger.debug(
                `Estimated next input (actuals-based): ${lastInput} + ${lastOutput} + ${newMessagesEstimate} = ${total}`
            );
            return total;
        }

        // Fallback to pure estimation
        const pureEstimate = estimateContextTokens(systemPrompt, preparedHistory, tools);
        this.logger.debug(`Estimated next input (pure estimate): ${pureEstimate.total}`);
        return pureEstimate.total;
    }

    /**
     * Gets the system prompt formatted for the target LLM provider
     * Some providers handle system prompts differently
     *
     * @returns Formatted system prompt or null/undefined based on formatter implementation
     * @throws Error if formatting fails
     */
    async getFormattedSystemPrompt(
        _context: DynamicContributorContext
    ): Promise<string | null | undefined> {
        // Vercel formatter handles system prompts in the messages array, not separately
        return this.formatter.formatSystemPrompt?.();
    }

    /**
     * Resets the conversation history
     * Does not reset the system prompt
     */
    async resetConversation(): Promise<void> {
        // Clear persisted history
        await this.historyProvider.clearHistory();
        this.resetActualTokenTracking();
        this.logger.debug(
            `ContextManager: Conversation history cleared for session ${this.sessionId}`
        );
    }
}
