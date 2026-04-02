import { setMaxListeners } from 'events';
import { TextEncoder } from 'node:util';
import { ReadableStream, type ReadableStreamDefaultController } from 'node:stream/web';
import type { AgentEventBus, AgentEventMap } from '@dexto/core';
import { logger } from '@dexto/core';

interface SessionSseConnection {
    sessionId: string;
    controller: ReadableStreamDefaultController;
    abortController: AbortController;
    connectedAt: number;
}

function serializeEventPayload<K extends keyof AgentEventMap>(
    eventName: K,
    payload: AgentEventMap[K]
): Record<string, unknown> {
    if (eventName === 'llm:error') {
        const errorPayload = payload as AgentEventMap['llm:error'];
        return {
            ...errorPayload,
            error:
                errorPayload.error instanceof Error
                    ? {
                          message: errorPayload.error.message,
                          name: errorPayload.error.name,
                          stack: errorPayload.error.stack,
                      }
                    : errorPayload.error,
        };
    }

    return payload as Record<string, unknown>;
}

export class SessionSseEventSubscriber {
    private connections = new Map<string, SessionSseConnection>();
    private globalAbortController: AbortController | undefined;

    subscribe(eventBus: AgentEventBus): void {
        this.globalAbortController?.abort();

        this.globalAbortController = new AbortController();
        const { signal } = this.globalAbortController;
        setMaxListeners(32, signal);

        const subscribeSessionEvent = <K extends keyof AgentEventMap>(eventName: K) => {
            eventBus.on(
                eventName,
                ((payload: AgentEventMap[K]) => {
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
                }) as AgentEventMap[K] extends void
                    ? () => void
                    : (payload: AgentEventMap[K]) => void,
                { signal }
            );
        };

        subscribeSessionEvent('llm:thinking');
        subscribeSessionEvent('llm:chunk');
        subscribeSessionEvent('llm:response');
        subscribeSessionEvent('llm:tool-call');
        subscribeSessionEvent('llm:tool-call-partial');
        subscribeSessionEvent('llm:tool-result');
        subscribeSessionEvent('llm:error');
        subscribeSessionEvent('llm:unsupported-input');
        subscribeSessionEvent('tool:running');
        subscribeSessionEvent('context:compacting');
        subscribeSessionEvent('context:compacted');
        subscribeSessionEvent('context:pruned');
        subscribeSessionEvent('message:queued');
        subscribeSessionEvent('message:dequeued');
        subscribeSessionEvent('session:title-updated');
        subscribeSessionEvent('approval:request');
        subscribeSessionEvent('approval:response');
        subscribeSessionEvent('service:event');
        subscribeSessionEvent('run:complete');

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
