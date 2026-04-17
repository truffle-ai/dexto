import { setMaxListeners } from 'events';
import { TextEncoder } from 'node:util';
import { ReadableStream, type ReadableStreamDefaultController } from 'node:stream/web';
import type { AgentEventBus, AgentEventMap, EventArgs, EventListener } from '@dexto/core';
import { logger } from '@dexto/core';

const SESSION_EVENT_NAMES = [
    'llm:thinking',
    'llm:chunk',
    'llm:response',
    'llm:tool-call',
    'llm:tool-call-partial',
    'llm:tool-result',
    'llm:error',
    'llm:unsupported-input',
    'tool:running',
    'context:compacting',
    'context:compacted',
    'context:pruned',
    'message:queued',
    'message:dequeued',
    'session:title-updated',
    'approval:request',
    'approval:response',
    'service:event',
    'run:complete',
] as const;

type SessionEventName = (typeof SESSION_EVENT_NAMES)[number];
type SessionEventPayload = AgentEventMap[SessionEventName];

interface SessionSseConnection {
    sessionId: string;
    controller: ReadableStreamDefaultController;
    abortController: AbortController;
    connectedAt: number;
}

function serializeEventPayload(
    eventName: SessionEventName,
    payload: SessionEventPayload
): Record<string, unknown> {
    if (eventName === 'llm:error' && 'error' in payload) {
        return {
            ...payload,
            error:
                payload.error instanceof Error
                    ? {
                          message: payload.error.message,
                          name: payload.error.name,
                          stack: payload.error.stack,
                      }
                    : payload.error,
        };
    }

    return { ...payload };
}

export class SessionSseEventSubscriber {
    private connections = new Map<string, SessionSseConnection>();
    private globalAbortController: AbortController | undefined;

    subscribe(eventBus: AgentEventBus): void {
        this.globalAbortController?.abort();

        this.globalAbortController = new AbortController();
        const { signal } = this.globalAbortController;
        setMaxListeners(32, signal);

        const subscribeSessionEvent = <K extends SessionEventName>(eventName: K) => {
            const listener: EventListener<AgentEventMap[K]> = (
                ...args: EventArgs<AgentEventMap[K]>
            ) => {
                const [payload] = args;
                if (
                    !payload ||
                    typeof payload !== 'object' ||
                    !('sessionId' in payload) ||
                    typeof payload.sessionId !== 'string'
                ) {
                    return;
                }

                this.broadcastToSession(
                    payload.sessionId,
                    String(eventName),
                    serializeEventPayload(eventName, payload)
                );
            };

            eventBus.on(eventName, listener, { signal });
        };

        for (const eventName of SESSION_EVENT_NAMES) {
            subscribeSessionEvent(eventName);
        }

        logger.debug('SessionSseEventSubscriber subscribed to agent events');
    }

    createStream(sessionId: string): ReadableStream<Uint8Array> {
        const connectionId = `${sessionId}-${Date.now()}`;

        return new ReadableStream({
            start: (controller) => {
                const connection: SessionSseConnection = {
                    sessionId,
                    controller,
                    abortController: new AbortController(),
                    connectedAt: Date.now(),
                };

                this.connections.set(connectionId, connection);
                logger.debug(`Session SSE connection opened for session ${sessionId}`);

                const keepaliveInterval = setInterval(() => {
                    try {
                        this.sendSSEComment(controller, 'keepalive');
                    } catch {
                        clearInterval(keepaliveInterval);
                    }
                }, 30000);

                connection.abortController.signal.addEventListener('abort', () => {
                    clearInterval(keepaliveInterval);
                });
            },
            cancel: () => {
                const connection = this.connections.get(connectionId);
                if (connection) {
                    connection.abortController.abort();
                    this.connections.delete(connectionId);
                    logger.debug(`Session SSE connection closed for session ${sessionId}`);
                }
            },
        });
    }

    private broadcastToSession(
        sessionId: string,
        eventName: string,
        data: Record<string, unknown>
    ): void {
        for (const [connectionId, connection] of this.connections.entries()) {
            if (connection.sessionId !== sessionId) {
                continue;
            }

            try {
                this.sendSSEEvent(connection.controller, eventName, data);
                if (
                    eventName === 'run:complete' ||
                    (eventName === 'llm:error' && data.recoverable === false)
                ) {
                    connection.abortController.abort();
                    connection.controller.close();
                    this.connections.delete(connectionId);
                }
            } catch (error) {
                logger.debug(
                    `Failed to send session SSE event ${eventName} for ${sessionId}: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
                connection.abortController.abort();
                this.connections.delete(connectionId);
            }
        }
    }

    private sendSSEEvent(
        controller: ReadableStreamDefaultController,
        eventName: string,
        data: Record<string, unknown>
    ): void {
        const encoder = new TextEncoder();
        const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
    }

    private sendSSEComment(controller: ReadableStreamDefaultController, comment: string): void {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`: ${comment}\n\n`));
    }

    cleanup(): void {
        this.globalAbortController?.abort();
        this.globalAbortController = undefined;

        for (const [connectionId, connection] of this.connections.entries()) {
            connection.abortController.abort();
            this.connections.delete(connectionId);
        }
    }
}
