import { TextEncoder } from 'node:util';
import { ReadableStream } from 'node:stream/web';
import type { ReadableStreamDefaultController } from 'node:stream/web';
import type { StreamEvent } from '@dexto/core';
import { logger } from '@dexto/core';

type SessionId = string;

interface SessionStreamState {
    buffer: Uint8Array[];
    controller?: ReadableStreamDefaultController<Uint8Array>;
    timeout?: NodeJS.Timeout;
    closed: boolean;
}

const FINAL_EVENT_TYPES: StreamEvent['type'][] = ['message-complete'];

export class MessageStreamManager {
    private sessions = new Map<SessionId, SessionStreamState>();
    private encoder = new TextEncoder();

    constructor(private options: { idleTimeoutMs?: number } = {}) {}

    public startStreaming(sessionId: string, iterator: AsyncIterableIterator<StreamEvent>): void {
        const state = this.ensureState(sessionId, { reset: true, allowCreate: true });

        if (!state.closed && state.controller) {
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
        iterator: AsyncIterableIterator<StreamEvent>
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
                type: 'error',
                error: error instanceof Error ? error : new Error(String(error)),
                recoverable: false,
            });
        } finally {
            this.close(sessionId);
        }
    }

    private pushEvent(sessionId: string, event: StreamEvent): void {
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

    private isTerminalError(event: StreamEvent): event is Extract<StreamEvent, { type: 'error' }> {
        return event.type === 'error' && event.recoverable === false;
    }

    private formatEvent(sessionId: string, event: StreamEvent): string | null {
        const data: Record<string, unknown> = { sessionId };
        let eventName: string;

        switch (event.type) {
            case 'message-start':
                eventName = 'message-start';
                Object.assign(data, event);
                break;
            case 'thinking':
                eventName = 'thinking';
                break;
            case 'content-chunk':
                eventName = 'content-chunk';
                Object.assign(data, event);
                break;
            case 'tool-use':
                eventName = 'tool-use';
                Object.assign(data, event);
                break;
            case 'tool-result':
                eventName = 'tool-result';
                Object.assign(data, event);
                break;
            case 'message-complete':
                eventName = 'message-complete';
                Object.assign(data, event);
                break;
            case 'error':
                eventName = 'error';
                Object.assign(data, {
                    message: event.error?.message ?? 'Unknown error',
                    stack: event.error?.stack,
                    recoverable: event.recoverable,
                    context: event.context,
                });
                break;
            default:
                return null;
        }

        return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    }
}
