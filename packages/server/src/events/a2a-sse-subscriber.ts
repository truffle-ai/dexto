/**
 * A2A SSE (Server-Sent Events) Event Subscriber
 *
 * Subscribes to agent events and streams them to SSE clients for A2A tasks.
 * Uses standard SSE protocol (text/event-stream).
 *
 * Design:
 * - Filters events by taskId/sessionId for targeted streaming
 * - Uses standard SSE format: event: name\ndata: json\n\n
 * - Supports multiple concurrent SSE connections
 */

/* eslint-disable no-undef */
import { setMaxListeners } from 'events';
import { AgentEventBus } from '@dexto/core';
import { logger } from '@dexto/core';

/**
 * SSE connection state
 */
interface SSEConnection {
    /** Task/Session ID to filter events */
    taskId: string;
    /** Controller to write SSE events */
    controller: ReadableStreamDefaultController;
    /** Abort signal for cleanup */
    abortController: AbortController;
    /** Connection timestamp */
    connectedAt: number;
}

/**
 * A2A SSE Event Subscriber
 *
 * Manages Server-Sent Events connections for A2A Protocol task streaming.
 *
 * Usage:
 * ```typescript
 * const sseSubscriber = new A2ASseEventSubscriber();
 * agent.registerSubscriber(sseSubscriber);
 *
 * // In route handler
 * const stream = sseSubscriber.createStream(taskId);
 * return new Response(stream, {
 *   headers: {
 *     'Content-Type': 'text/event-stream',
 *     'Cache-Control': 'no-cache',
 *     'Connection': 'keep-alive'
 *   }
 * });
 * ```
 */
export class A2ASseEventSubscriber {
    private connections: Map<string, SSEConnection> = new Map();
    private eventBus?: AgentEventBus;
    private globalAbortController?: AbortController;

    /**
     * Subscribe to agent event bus.
     * Sets up global event listeners that broadcast to all SSE connections.
     *
     * @param eventBus Agent event bus to subscribe to
     */
    subscribe(eventBus: AgentEventBus): void {
        // Abort any previous subscription
        this.globalAbortController?.abort();

        // Create new AbortController for this subscription
        this.globalAbortController = new AbortController();
        const { signal } = this.globalAbortController;

        // Increase max listeners
        const MAX_SHARED_SIGNAL_LISTENERS = 20;
        setMaxListeners(MAX_SHARED_SIGNAL_LISTENERS, signal);

        this.eventBus = eventBus;

        // Subscribe to agent events
        eventBus.on(
            'llm:thinking',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.thinking', {
                    taskId: payload.sessionId,
                });
            },
            { signal }
        );

        eventBus.on(
            'llm:chunk',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.chunk', {
                    taskId: payload.sessionId,
                    type: payload.chunkType,
                    content: payload.content,
                    isComplete: payload.isComplete,
                });
            },
            { signal }
        );

        eventBus.on(
            'llm:tool-call',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.toolCall', {
                    taskId: payload.sessionId,
                    toolName: payload.toolName,
                    args: payload.args,
                    callId: payload.callId,
                });
            },
            { signal }
        );

        eventBus.on(
            'llm:tool-result',
            (payload) => {
                const data: Record<string, unknown> = {
                    taskId: payload.sessionId,
                    toolName: payload.toolName,
                    callId: payload.callId,
                    success: payload.success,
                    sanitized: payload.sanitized,
                };
                if (payload.rawResult !== undefined) {
                    data.rawResult = payload.rawResult;
                }
                this.broadcastToTask(payload.sessionId, 'task.toolResult', data);
            },
            { signal }
        );

        eventBus.on(
            'llm:response',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.message', {
                    taskId: payload.sessionId,
                    message: {
                        role: 'agent',
                        content: [{ type: 'text', text: payload.content }],
                        timestamp: new Date().toISOString(),
                    },
                    tokenUsage: payload.tokenUsage,
                    provider: payload.provider,
                    model: payload.model,
                });
            },
            { signal }
        );

        eventBus.on(
            'llm:error',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.error', {
                    taskId: payload.sessionId,
                    error: {
                        message: payload.error.message,
                        recoverable: payload.recoverable,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'session:reset',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.reset', {
                    taskId: payload.sessionId,
                });
            },
            { signal }
        );

        logger.debug('A2ASseEventSubscriber subscribed to agent events');
    }

    /**
     * Create a new SSE stream for a specific task.
     *
     * Returns a ReadableStream that emits SSE events for the task.
     *
     * @param taskId Task/Session ID to stream events for
     * @returns ReadableStream for SSE connection
     */
    createStream(taskId: string): ReadableStream<Uint8Array> {
        const connectionId = `${taskId}-${Date.now()}`;

        return new ReadableStream({
            start: (controller) => {
                // Create connection state
                const connection: SSEConnection = {
                    taskId,
                    controller,
                    abortController: new AbortController(),
                    connectedAt: Date.now(),
                };

                this.connections.set(connectionId, connection);
                logger.debug(`SSE connection opened for task ${taskId}`);

                // Send initial connection event
                this.sendSSEEvent(controller, 'connected', {
                    taskId,
                    timestamp: new Date().toISOString(),
                });

                // Send keepalive every 30 seconds
                const keepaliveInterval = setInterval(() => {
                    try {
                        this.sendSSEComment(controller, 'keepalive');
                    } catch (_error) {
                        clearInterval(keepaliveInterval);
                    }
                }, 30000);

                // Cleanup on abort
                connection.abortController.signal.addEventListener('abort', () => {
                    clearInterval(keepaliveInterval);
                });
            },

            cancel: () => {
                // Client disconnected, cleanup
                const connection = this.connections.get(connectionId);
                if (connection) {
                    connection.abortController.abort();
                    this.connections.delete(connectionId);
                    logger.debug(`SSE connection closed for task ${taskId}`);
                }
            },
        });
    }

    /**
     * Broadcast an event to a specific task's SSE connections.
     *
     * @param taskId Task ID to broadcast to
     * @param eventName SSE event name
     * @param data Event data
     */
    private broadcastToTask(
        taskId: string,
        eventName: string,
        data: Record<string, unknown>
    ): void {
        let sent = 0;
        for (const [connectionId, connection] of this.connections.entries()) {
            if (connection.taskId === taskId) {
                try {
                    this.sendSSEEvent(connection.controller, eventName, data);
                    sent++;
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    logger.warn(`Failed to send SSE event to ${connectionId}: ${errorMessage}`);
                    // Clean up failed connection
                    connection.abortController.abort();
                    this.connections.delete(connectionId);
                }
            }
        }

        if (sent > 0) {
            logger.debug(`Broadcast ${eventName} to ${sent} SSE connection(s) for task ${taskId}`);
        }
    }

    /**
     * Send an SSE event to a specific controller.
     *
     * Format: event: name\ndata: json\n\n
     *
     * @param controller Stream controller
     * @param eventName Event name
     * @param data Event data
     */
    private sendSSEEvent(
        controller: ReadableStreamDefaultController,
        eventName: string,
        data: Record<string, unknown>
    ): void {
        const event = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(event));
    }

    /**
     * Send an SSE comment (for keepalive).
     *
     * Format: : comment\n
     *
     * @param controller Stream controller
     * @param comment Comment text
     */
    private sendSSEComment(controller: ReadableStreamDefaultController, comment: string): void {
        const line = `: ${comment}\n`;
        controller.enqueue(new TextEncoder().encode(line));
    }

    /**
     * Close all connections and cleanup.
     */
    cleanup(): void {
        logger.debug(`Cleaning up ${this.connections.size} SSE connections`);

        for (const [_connectionId, connection] of this.connections.entries()) {
            connection.abortController.abort();
            try {
                connection.controller.close();
            } catch (_error) {
                // Ignore errors on close
            }
        }

        this.connections.clear();
        this.globalAbortController?.abort();
    }

    /**
     * Get active connection count.
     */
    getConnectionCount(): number {
        return this.connections.size;
    }

    /**
     * Get connection count for a specific task.
     */
    getTaskConnectionCount(taskId: string): number {
        let count = 0;
        for (const connection of this.connections.values()) {
            if (connection.taskId === taskId) {
                count++;
            }
        }
        return count;
    }
}
