import type { SessionEventBus } from '../events/index.js';
import type { QueuedMessage, CoalescedMessage } from './types.js';
import type { ContentPart } from '../context/types.js';
import type { IDextoLogger } from '../logger/v2/types.js';

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
    private queue: QueuedMessage[] = [];

    constructor(
        private eventBus: SessionEventBus,
        private logger: IDextoLogger
    ) {}

    /**
     * Add a message to the queue.
     * Called by API endpoint - returns immediately with queue position.
     *
     * @param message The user message to queue
     * @returns Queue position and message ID
     */
    enqueue(message: UserMessageInput): { queued: true; position: number; id: string } {
        const queuedMsg: QueuedMessage = {
            id: generateId(),
            content: message.content,
            queuedAt: Date.now(),
            ...(message.metadata !== undefined && { metadata: message.metadata }),
            ...(message.kind !== undefined && { kind: message.kind }),
        };

        this.queue.push(queuedMsg);

        this.logger.debug(`Message queued: ${queuedMsg.id}, position: ${this.queue.length}`);

        this.eventBus.emit('message:queued', {
            position: this.queue.length,
            id: queuedMsg.id,
        });

        return {
            queued: true,
            position: this.queue.length,
            id: queuedMsg.id,
        };
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
     * [1]: stop
     *
     * [2]: try X instead
     *
     * [3]: also check Y
     * ```
     *
     * @returns Coalesced message or null if queue is empty
     */
    dequeueAll(): CoalescedMessage | null {
        if (this.queue.length === 0) return null;

        const messages = [...this.queue];
        this.queue = [];

        const combined = this.coalesce(messages);

        this.logger.debug(
            `Dequeued ${messages.length} message(s): ${messages.map((m) => m.id).join(', ')}`
        );

        this.eventBus.emit('message:dequeued', {
            count: messages.length,
            ids: messages.map((m) => m.id),
            coalesced: messages.length > 1,
            content: combined.combinedContent,
            messages,
        });

        return combined;
    }

    /**
     * Coalesce multiple messages into one (multimodal-aware).
     * Strategy: Combine with numbered separators, preserve all media.
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

        // Multiple messages - combine with numbered prefixes
        const combinedContent: ContentPart[] = [];

        for (const [i, msg] of messages.entries()) {
            // Add prefix based on message count
            const prefix = messages.length === 2 ? (i === 0 ? 'First' : 'Also') : `[${i + 1}]`;

            // Start with prefix text
            let prefixText = `${prefix}: `;

            // Process content parts
            for (const part of msg.content) {
                if (part.type === 'text') {
                    // Combine prefix with first text part for cleaner output
                    if (prefixText) {
                        combinedContent.push({ type: 'text', text: prefixText + part.text });
                        prefixText = '';
                    } else {
                        combinedContent.push(part);
                    }
                } else {
                    // If we haven't added prefix yet (message started with media), add it first
                    if (prefixText) {
                        combinedContent.push({ type: 'text', text: prefixText });
                        prefixText = '';
                    }
                    // Images, files, and other media are added as-is
                    combinedContent.push(part);
                }
            }

            // If the message only had media (no text), prefix was already added
            // If message was empty, add just the prefix
            if (prefixText && msg.content.length === 0) {
                combinedContent.push({ type: 'text', text: prefixText + '[empty message]' });
            }

            // Add separator between messages (not after last one)
            if (i < messages.length - 1) {
                combinedContent.push({ type: 'text', text: '\n\n' });
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
        return this.queue.length > 0;
    }

    /**
     * Get the number of pending messages.
     */
    pendingCount(): number {
        return this.queue.length;
    }

    /**
     * Clear all pending messages without processing.
     * Used during cleanup/abort.
     */
    clear(): void {
        this.queue = [];
    }

    /**
     * Get all queued messages (for UI display).
     * Returns a shallow copy to prevent external mutation.
     */
    getAll(): QueuedMessage[] {
        return [...this.queue];
    }

    /**
     * Get a single queued message by ID.
     */
    get(id: string): QueuedMessage | undefined {
        return this.queue.find((m) => m.id === id);
    }

    /**
     * Remove a single queued message by ID.
     * @returns true if message was found and removed; false otherwise
     */
    remove(id: string): boolean {
        const index = this.queue.findIndex((m) => m.id === id);
        if (index === -1) {
            this.logger.debug(`Remove failed: message ${id} not found in queue`);
            return false;
        }

        this.queue.splice(index, 1);
        this.logger.debug(`Message removed: ${id}, remaining: ${this.queue.length}`);
        this.eventBus.emit('message:removed', { id });
        return true;
    }
}
