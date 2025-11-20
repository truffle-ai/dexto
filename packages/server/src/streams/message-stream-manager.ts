import { TextEncoder } from 'node:util';
import { ReadableStream } from 'node:stream/web';
import type { ReadableStreamDefaultController } from 'node:stream/web';
import type { StreamingEvent, AgentEventBus } from '@dexto/core';
import { logger } from '@dexto/core';

type SessionId = string;

interface SessionStreamState {
    buffer: Uint8Array[];
    controller?: ReadableStreamDefaultController<Uint8Array>;
    timeout?: NodeJS.Timeout;
    closed: boolean;
}

// Final events that signal stream completion (using core event names)
const FINAL_EVENT_TYPES: StreamingEvent['type'][] = ['llm:response'];

export class MessageStreamManager {
    private sessions = new Map<SessionId, SessionStreamState>();
    private encoder = new TextEncoder();
    private eventBus?: AgentEventBus;
    private globalAbortController?: AbortController;

    constructor(private options: { idleTimeoutMs?: number } = {}) {}

    /**
     * Subscribe to agent event bus for approval events.
     * This allows approval requests to be forwarded through the SSE stream.
     */
    public subscribeToEventBus(eventBus: AgentEventBus): void {
        // Abort any previous subscription
        this.globalAbortController?.abort();

        // Create new AbortController for this subscription
        this.globalAbortController = new AbortController();
        const { signal } = this.globalAbortController;

        this.eventBus = eventBus;

        // Subscribe to approval:request events
        eventBus.on(
            'approval:request',
            (payload) => {
                const sessionId = payload.sessionId;
                if (sessionId) {
                    this.pushApprovalEvent(sessionId, 'approval:request', payload);
                }
            },
            { signal }
        );

        // Subscribe to approval:response events
        eventBus.on(
            'approval:response',
            (payload) => {
                const sessionId = payload.sessionId;
                if (sessionId) {
                    this.pushApprovalEvent(sessionId, 'approval:response', payload);
                }
            },
            { signal }
        );

        // Subscribe to session:title-updated events
        eventBus.on(
            'session:title-updated',
            (payload) => {
                const sessionId = payload.sessionId;
                if (sessionId) {
                    this.pushApprovalEvent(sessionId, 'session:title-updated', payload);
                }
            },
            { signal }
        );

        logger.debug('MessageStreamManager subscribed to approval and session events on event bus');
    }

    public startStreaming(
        sessionId: string,
        iterator: AsyncIterableIterator<StreamingEvent>
    ): void {
        // Check for existing state before resetting
        const existingState = this.sessions.get(sessionId);
        if (existingState && !existingState.closed && existingState.controller) {
            logger.warn(
                `[MessageStreamManager] Overwriting active stream for session ${sessionId}`
            );
            this.close(sessionId);
        }

        this.ensureState(sessionId, { reset: true, allowCreate: true });

        void this.consumeIterator(sessionId, iterator);
    }

    public createReadableStream(sessionId: string): ReadableStream<Uint8Array> {
        const state = this.ensureState(sessionId, { allowCreate: false });

        return new ReadableStream<Uint8Array>({
            start: (controller) => {
                state.controller = controller;
                for (const chunk of state.buffer) {
                    controller.enqueue(chunk);
                }
                state.buffer = [];
            },
            cancel: () => {
                this.close(sessionId);
            },
        });
    }

    private async consumeIterator(
        sessionId: string,
        iterator: AsyncIterableIterator<StreamingEvent>
    ): Promise<void> {
        try {
            for await (const event of iterator) {
                this.pushEvent(sessionId, event);
            }
        } catch (error) {
            logger.error(
                `[MessageStreamManager] Error while streaming session ${sessionId}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            this.pushEvent(sessionId, {
                type: 'llm:error',
                error: error instanceof Error ? error : new Error(String(error)),
                recoverable: false,
                sessionId,
            });
        } finally {
            this.close(sessionId);
        }
    }

    private pushEvent(sessionId: string, event: StreamingEvent): void {
        const state = this.ensureState(sessionId, { allowCreate: false });
        if (state.closed) {
            return;
        }
        const payload = this.formatEvent(sessionId, event);

        if (!payload) {
            return;
        }

        const encoded = this.encoder.encode(payload);
        if (state.controller) {
            state.controller.enqueue(encoded);
        } else {
            state.buffer.push(encoded);
        }

        if (FINAL_EVENT_TYPES.includes(event.type) || this.isTerminalError(event)) {
            this.close(sessionId);
        }
    }

    /**
     * Push an approval event through the SSE stream.
     * This is separate from pushEvent because approval events come from the event bus,
     * not from the streaming iterator.
     */
    private pushApprovalEvent(
        sessionId: string,
        eventName: string,
        data: Record<string, unknown>
    ): void {
        // Try to get existing state, but don't create if it doesn't exist
        // (approval might come before stream is established)
        const state = this.sessions.get(sessionId);
        if (!state || state.closed) {
            logger.debug(
                `[MessageStreamManager] Approval event ${eventName} for session ${sessionId} - no active stream`
            );
            return;
        }

        const payload = `event: ${eventName}\ndata: ${JSON.stringify({ sessionId, ...data })}\n\n`;
        const encoded = this.encoder.encode(payload);

        if (state.controller) {
            state.controller.enqueue(encoded);
            logger.debug(
                `[MessageStreamManager] Forwarded ${eventName} to SSE stream for session ${sessionId}`
            );
        } else {
            state.buffer.push(encoded);
            logger.debug(`[MessageStreamManager] Buffered ${eventName} for session ${sessionId}`);
        }
    }

    private ensureState(
        sessionId: string,
        options: { reset?: boolean; allowCreate?: boolean }
    ): SessionStreamState {
        const { reset = false, allowCreate = true } = options;

        if (!this.sessions.has(sessionId)) {
            if (!allowCreate) {
                throw new Error(`No active stream state for session ${sessionId}`);
            }
            this.sessions.set(sessionId, {
                buffer: [],
                closed: false,
            });
        }

        if (reset) {
            const existing = this.sessions.get(sessionId);
            if (existing?.timeout) {
                clearTimeout(existing.timeout);
            }
            this.sessions.set(sessionId, {
                buffer: [],
                closed: false,
            });
        }

        return this.sessions.get(sessionId)!;
    }

    private close(sessionId: string): void {
        const state = this.sessions.get(sessionId);
        if (!state || state.closed) return;

        state.closed = true;
        if (state.controller) {
            try {
                state.controller.close();
            } catch (error) {
                logger.warn(
                    `[MessageStreamManager] Failed to close controller for ${sessionId}: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        }

        const timeoutMs = this.options.idleTimeoutMs ?? 5 * 60 * 1000;
        state.timeout = setTimeout(() => {
            this.sessions.delete(sessionId);
        }, timeoutMs);
    }

    private isTerminalError(
        event: StreamingEvent
    ): event is Extract<StreamingEvent, { type: 'llm:error' }> {
        return event.type === 'llm:error' && event.recoverable === false;
    }

    private formatEvent(sessionId: string, event: StreamingEvent): string | null {
        const data: Record<string, unknown> = { sessionId };
        let eventName: string;

        // Handle special case for error events
        if (event.type === 'llm:error') {
            eventName = 'llm:error';
            Object.assign(data, {
                message: event.error?.message ?? 'Unknown error',
                stack: event.error?.stack,
                recoverable: event.recoverable,
                context: event.context,
            });
        } else {
            // Default case: event name matches event type, spread all event data
            eventName = event.type;
            Object.assign(data, event);
        }

        return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    }
}
