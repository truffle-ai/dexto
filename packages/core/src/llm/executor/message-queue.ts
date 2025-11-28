/**
 * MessageQueueService - Handles mid-loop message injection for the TurnExecutor.
 *
 * When a user sends a new message while the agent is mid-turn (e.g., executing tools),
 * the message is queued and injected at the next step boundary.
 *
 * Multiple queued messages are coalesced into a single combined message to avoid
 * fragmented conversation context.
 *
 * @see /complete-context-management-plan.md
 */

import { randomUUID } from 'crypto';
import type { QueuedMessage, CoalescedMessage, UserMessageContentPart } from './types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import { eventBus } from '../../events/index.js';

export interface MessageQueueServiceOptions {
    sessionId: string;
    logger: IDextoLogger;
}

/**
 * Service for queueing and coalescing user messages during agent execution.
 *
 * Usage:
 * - API layer calls `enqueue()` when a new message arrives during execution
 * - TurnExecutor calls `dequeueAll()` between steps to inject pending messages
 * - Multiple messages are coalesced into one to maintain coherent context
 */
export class MessageQueueService {
    private queue: QueuedMessage[] = [];
    private readonly sessionId: string;
    private readonly logger: IDextoLogger;

    constructor(options: MessageQueueServiceOptions) {
        this.sessionId = options.sessionId;
        this.logger = options.logger.createChild(DextoLogComponent.CONTEXT);
    }

    /**
     * Queue a new message for injection at the next step boundary.
     * Called by API layer when a message arrives during execution.
     *
     * @param content Multimodal content parts (text, images, files)
     * @param metadata Optional metadata from the request
     * @returns Position in queue and message ID
     */
    enqueue(
        content: UserMessageContentPart[],
        metadata?: Record<string, unknown>
    ): { queued: true; position: number; id: string } {
        const queuedMsg: QueuedMessage = {
            id: randomUUID(),
            content,
            queuedAt: Date.now(),
            ...(metadata !== undefined && { metadata }),
        };

        this.queue.push(queuedMsg);

        const position = this.queue.length;
        this.logger.debug(`MessageQueue: Enqueued message ${queuedMsg.id} at position ${position}`);

        eventBus.emit('message:queued', {
            position,
            id: queuedMsg.id,
            sessionId: this.sessionId,
        });

        return { queued: true, position, id: queuedMsg.id };
    }

    /**
     * Dequeue ALL pending messages and coalesce into a single injection.
     * Called by TurnExecutor between steps.
     *
     * If 3 messages are queued: "stop", "try X instead", "also check Y"
     * They become ONE combined message to the LLM with numbered prefixes.
     *
     * @returns Coalesced message or null if queue is empty
     */
    dequeueAll(): CoalescedMessage | null {
        if (this.queue.length === 0) {
            return null;
        }

        const messages = [...this.queue];
        this.queue = [];

        const combined = this.coalesce(messages);

        this.logger.debug(
            `MessageQueue: Dequeued ${messages.length} message(s), coalesced into single message`
        );

        eventBus.emit('message:dequeued', {
            count: messages.length,
            ids: messages.map((m) => m.id),
            coalesced: messages.length > 1,
            sessionId: this.sessionId,
        });

        return combined;
    }

    /**
     * Check if there are pending messages without dequeuing.
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
     * Clear all pending messages (e.g., on abort).
     */
    clear(): void {
        const count = this.queue.length;
        if (count > 0) {
            const ids = this.queue.map((m) => m.id);
            this.queue = [];
            this.logger.debug(`MessageQueue: Cleared ${count} pending message(s)`);

            eventBus.emit('message:dequeued', {
                count,
                ids,
                coalesced: false,
                sessionId: this.sessionId,
            });
        }
    }

    /**
     * Coalesce multiple messages into one (multimodal-aware).
     * Strategy: Combine with numbered separators, preserve all media.
     *
     * Examples:
     * - 1 message: Returns as-is
     * - 2 messages: "First: ... Also: ..."
     * - 3+ messages: "[1]: ... [2]: ... [3]: ..."
     */
    private coalesce(messages: QueuedMessage[]): CoalescedMessage {
        if (messages.length === 1) {
            const msg = messages[0]!; // Safe: length check guarantees existence
            return {
                messages,
                combinedContent: msg.content,
                firstQueuedAt: msg.queuedAt,
                lastQueuedAt: msg.queuedAt,
            };
        }

        // Multiple messages - combine with numbered prefixes
        const combinedContent: UserMessageContentPart[] = [];

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i]!; // Safe: iterating within bounds
            const prefix = messages.length === 2 ? (i === 0 ? 'First' : 'Also') : `[${i + 1}]`;

            // Find the first text part to prepend the prefix to
            let prefixAdded = false;
            for (const part of msg.content) {
                if (part.type === 'text' && !prefixAdded) {
                    // Prepend prefix to first text part
                    combinedContent.push({
                        type: 'text',
                        text: `${prefix}: ${part.text}`,
                    });
                    prefixAdded = true;
                } else {
                    // Add other parts as-is
                    combinedContent.push(part);
                }
            }

            // If no text part was found, add prefix as standalone
            if (!prefixAdded) {
                combinedContent.unshift({ type: 'text', text: `${prefix}: ` });
            }

            // Add separator between messages
            if (i < messages.length - 1) {
                combinedContent.push({ type: 'text', text: '\n\n' });
            }
        }

        // Safe: messages array is non-empty (single-message case returns early above)
        return {
            messages,
            combinedContent,
            firstQueuedAt: messages[0]!.queuedAt,
            lastQueuedAt: messages[messages.length - 1]!.queuedAt,
        };
    }
}
