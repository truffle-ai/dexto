import type { SessionEventBus } from '../events/index.js';
import { cloneCoalescedMessage, cloneQueuedMessage, cloneQueuedMessages } from './queue-clone.js';
import type { QueuedMessage, CoalescedMessage } from './types.js';
import type { ContentPart } from '../context/types.js';
import type { Logger } from '../logger/v2/types.js';
import type { SessionMessageQueueStore } from '../storage/message-queue/types.js';

type MessageQueueBackingStore = SessionMessageQueueStore;

class EphemeralMessageQueueStore implements MessageQueueBackingStore {
    private queue: QueuedMessage[] = [];

    async list(input: { sessionId: string }): Promise<QueuedMessage[]> {
        void input;
        return cloneQueuedMessages(this.queue);
    }

    async append(input: {
        sessionId: string;
        message: QueuedMessage;
    }): Promise<{ position: number }> {
        void input.sessionId;
        this.queue = [...this.queue, cloneQueuedMessage(input.message)];
        return { position: this.queue.length };
    }

    async takeAll(input: { sessionId: string }): Promise<QueuedMessage[]> {
        void input.sessionId;
        const messages = cloneQueuedMessages(this.queue);
        this.queue = [];
        return messages;
    }

    async remove(input: { sessionId: string; id: string }): Promise<boolean> {
        void input.sessionId;
        const previousLength = this.queue.length;
        this.queue = this.queue.filter((message) => message.id !== input.id);
        return this.queue.length !== previousLength;
    }

    async clear(input: { sessionId: string }): Promise<void> {
        void input.sessionId;
        this.queue = [];
    }
}

/**
 * Generates a unique ID for queued messages.
 */
function generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Input for enqueuing a user message to the queue.
 * (Not to be confused with UserMessage from context/types.ts which represents
 * a message in conversation history)
 */
export interface UserMessageInput {
    /** Multimodal content array (text, images, files, etc.) */
    content: ContentPart[];
    /** Optional metadata to attach to the message */
    metadata?: Record<string, unknown>;
    /** Optional kind of queued message */
    kind?: 'default' | 'background';
}

/**
 * MessageQueueService handles queuing of user messages during agent execution.
 *
 * Key features:
 * - Accepts messages when the agent is busy executing tools
 * - Coalesces multiple queued messages into a single injection
 * - Supports multimodal content (text, images, files)
 *
 * This enables user guidance where users can send
 * mid-task instructions like "stop" or "try a different approach".
 *
 * @example
 * ```typescript
 * // In API handler - queue message if agent is busy
 * if (agent.isBusy()) {
 *   return messageQueue.enqueue({ content: [{ type: 'text', text: 'stop' }] });
 * }
 *
 * // In TurnExecutor - check for queued messages
 * const coalesced = messageQueue.dequeueAll();
 * if (coalesced) {
 *   await contextManager.addMessage({
 *     role: 'user',
 *     content: coalesced.combinedContent,
 *   });
 * }
 * ```
 */
export class MessageQueueService {
    private queueSnapshot: QueuedMessage[] = [];
    private mutationLock: Promise<void> = Promise.resolve();
    private initialized = false;
    private initializationPromise: Promise<void> | null = null;

    static createEphemeral(
        eventBus: SessionEventBus,
        logger: Logger,
        sessionId: string,
        queueKind: 'steer' | 'follow-up' = 'steer'
    ): MessageQueueService {
        return new MessageQueueService(
            eventBus,
            logger,
            sessionId,
            new EphemeralMessageQueueStore(),
            queueKind
        );
    }

    constructor(
        private eventBus: SessionEventBus,
        private logger: Logger,
        private sessionId: string,
        private store: MessageQueueBackingStore,
        private queueKind: 'steer' | 'follow-up' = 'steer'
    ) {}

    async initialize(): Promise<void> {
        this.initializationPromise ??= this.runWithMutationLock(async () => {
            if (this.initialized) {
                return;
            }

            this.queueSnapshot = await this.store.list({ sessionId: this.sessionId });
            if (this.queueSnapshot.length > 0) {
                this.logger.debug(
                    `Restored ${this.queueSnapshot.length} queued message(s) for session ${this.sessionId}`
                );
            }

            this.initialized = true;
        }).catch((error) => {
            this.initializationPromise = null;
            throw error;
        });

        await this.initializationPromise;
    }

    private async refreshFromStore(): Promise<void> {
        this.queueSnapshot = await this.store.list({ sessionId: this.sessionId });
    }

    private runWithMutationLock<T>(fn: () => Promise<T>): Promise<T> {
        const currentResult = this.mutationLock.catch(() => {}).then(() => fn());
        this.mutationLock = currentResult.then(
            () => undefined,
            () => undefined
        );
        return currentResult;
    }

    /**
     * Add a message to the queue.
     * Called by API endpoint - returns immediately with queue position.
     *
     * @param message The user message to queue
     * @returns Queue position and message ID
     */
    async enqueue(
        message: UserMessageInput
    ): Promise<{ queued: true; position: number; id: string }> {
        return await this.runWithMutationLock(async () => {
            const queuedMsg: QueuedMessage = {
                id: generateId(),
                content: message.content,
                queuedAt: Date.now(),
                ...(message.metadata !== undefined && {
                    metadata: message.metadata,
                }),
                ...(message.kind !== undefined && { kind: message.kind }),
            };
            const copiedQueuedMsg = cloneQueuedMessage(queuedMsg);

            const { position } = await this.store.append({
                sessionId: this.sessionId,
                message: copiedQueuedMsg,
            });
            await this.refreshFromStore();

            this.logger.debug(`Message queued: ${queuedMsg.id}, position: ${position}`);

            this.eventBus.emit('message:queued', {
                position,
                id: queuedMsg.id,
                queue: this.queueKind,
            });

            return {
                queued: true,
                position,
                id: queuedMsg.id,
            };
        });
    }

    /**
     * Dequeue ALL pending messages and coalesce into single injection.
     * Called by executor between steps.
     *
     * Multiple queued messages become ONE combined message to the LLM.
     *
     * @example
     * If 3 messages are queued: "stop", "try X instead", "also check Y"
     * They become:
     * ```
     * Additional user input received:
     *
     * - stop
     *
     * - try X instead
     *
     * - also check Y
     * ```
     *
     * @returns Coalesced message or null if queue is empty
     */
    async dequeueAll(): Promise<CoalescedMessage | null> {
        return await this.runWithMutationLock(async () => {
            const messages = await this.store.takeAll({ sessionId: this.sessionId });
            this.queueSnapshot = [];
            if (messages.length === 0) return null;

            const combined = this.coalesce(messages);

            this.logger.debug(
                `Dequeued ${messages.length} message(s): ${messages.map((m) => m.id).join(', ')}`
            );

            this.eventBus.emit('message:dequeued', {
                count: messages.length,
                ids: messages.map((m) => m.id),
                queue: this.queueKind,
                coalesced: messages.length > 1,
                content: cloneCoalescedMessage(combined).combinedContent,
                messages: cloneQueuedMessages(messages),
            });

            return combined;
        });
    }

    /**
     * Coalesce multiple messages into one (multimodal-aware).
     * Strategy: Combine with per-kind formatting, preserve all media.
     */
    private coalesce(messages: QueuedMessage[]): CoalescedMessage {
        // Single message - return as-is
        if (messages.length === 1) {
            const firstMsg = messages[0];
            if (!firstMsg) {
                // This should never happen since we check length === 1, but satisfies TypeScript
                throw new Error('Unexpected empty messages array');
            }
            return {
                messages,
                combinedContent: firstMsg.content,
                firstQueuedAt: firstMsg.queuedAt,
                lastQueuedAt: firstMsg.queuedAt,
            };
        }

        const combinedContent: ContentPart[] = [];
        let hasEntries = false;
        let inUserSection = false;

        for (const msg of messages) {
            const isUserMessage = msg.kind !== 'background';

            if (isUserMessage && !inUserSection) {
                if (hasEntries) {
                    combinedContent.push({ type: 'text', text: '\n\n' });
                }
                combinedContent.push({ type: 'text', text: 'Additional user input received:' });
                combinedContent.push({ type: 'text', text: '\n\n' });
                inUserSection = true;
                hasEntries = false;
            }

            let prefixText = isUserMessage ? '- ' : '';

            if (hasEntries && !isUserMessage) {
                combinedContent.push({ type: 'text', text: '\n\n' });
                inUserSection = false;
            } else if (hasEntries && isUserMessage) {
                prefixText = `\n\n${prefixText}`;
            }

            const entryStartIndex = combinedContent.length;
            for (const part of msg.content) {
                if (part.type === 'text') {
                    if (prefixText) {
                        combinedContent.push({ type: 'text', text: prefixText + part.text });
                        prefixText = '';
                    } else {
                        combinedContent.push(part);
                    }
                } else {
                    if (prefixText) {
                        combinedContent.push({ type: 'text', text: prefixText });
                        prefixText = '';
                    }
                    combinedContent.push(part);
                }
            }

            if (prefixText && msg.content.length === 0) {
                combinedContent.push({ type: 'text', text: prefixText + '[empty message]' });
            }

            if (combinedContent.length > entryStartIndex) {
                hasEntries = true;
            }
        }

        // Get first and last messages - safe because we checked length > 1 above
        const firstMessage = messages[0];
        const lastMessage = messages[messages.length - 1];
        if (!firstMessage || !lastMessage) {
            throw new Error('Unexpected undefined message in non-empty array');
        }

        return {
            messages,
            combinedContent,
            firstQueuedAt: firstMessage.queuedAt,
            lastQueuedAt: lastMessage.queuedAt,
        };
    }

    /**
     * Check if there are pending messages in the queue.
     */
    hasPending(): boolean {
        return this.queueSnapshot.length > 0;
    }

    async refresh(): Promise<void> {
        await this.runWithMutationLock(async () => {
            await this.refreshFromStore();
        });
    }

    /**
     * Get the number of pending messages.
     */
    pendingCount(): number {
        return this.queueSnapshot.length;
    }

    /**
     * Clear all pending messages without processing.
     * Used during cleanup/abort.
     */
    async clear(): Promise<void> {
        await this.runWithMutationLock(async () => {
            await this.store.clear({ sessionId: this.sessionId });
            this.queueSnapshot = [];
        });
    }

    /**
     * Get all queued messages (for UI display).
     * Returns defensive copies to prevent external mutation.
     */
    getAll(): QueuedMessage[] {
        return cloneQueuedMessages(this.queueSnapshot);
    }

    /**
     * Get a single queued message by ID.
     */
    get(id: string): QueuedMessage | undefined {
        const message = this.queueSnapshot.find((m) => m.id === id);
        return message ? cloneQueuedMessage(message) : undefined;
    }

    /**
     * Remove a single queued message by ID.
     * @returns true if message was found and removed; false otherwise
     */
    async remove(id: string): Promise<boolean> {
        return await this.runWithMutationLock(async () => {
            const removed = await this.store.remove({ sessionId: this.sessionId, id });
            if (!removed) {
                this.logger.debug(`Remove failed: message ${id} not found in queue`);
                return false;
            }

            await this.refreshFromStore();

            this.logger.debug(`Message removed: ${id}, remaining: ${this.queueSnapshot.length}`);
            this.eventBus.emit('message:removed', { id, queue: this.queueKind });
            return true;
        });
    }
}
