import { WebSocketServer, WebSocket } from 'ws';
import { setMaxListeners } from 'events';
import { AgentEventBus } from '@dexto/core';
import { logger } from '@dexto/core';
import { EventSubscriber } from './types.js';

/**
 * WebSocket event subscriber that broadcasts agent events to connected clients
 */
export class WebSocketEventSubscriber implements EventSubscriber {
    private connections: Set<WebSocket> = new Set();
    private abortController?: AbortController;

    constructor(private wss: WebSocketServer) {
        // Track new connections
        this.wss.on('connection', (ws: WebSocket) => {
            logger.debug('New WebSocket client connected');
            this.connections.add(ws);

            // Add error handling for individual connections
            ws.on('error', (error: Error) => {
                logger.error('WebSocket client error:', error);
                this.connections.delete(ws);
            });

            ws.on('close', () => {
                logger.debug('WebSocket client disconnected');
                this.connections.delete(ws);
            });
        });
    }

    /**
     * Subscribe to agent events and broadcast them to WebSocket clients
     */
    subscribe(eventBus: AgentEventBus): void {
        // Abort any previous subscription before creating a new one
        this.abortController?.abort();

        // Create new AbortController for this subscription
        this.abortController = new AbortController();
        const { signal } = this.abortController;

        // Increase max listeners since we intentionally share this signal across multiple events
        // This prevents the MaxListenersExceededWarning
        const MAX_SHARED_SIGNAL_LISTENERS = 20;
        setMaxListeners(MAX_SHARED_SIGNAL_LISTENERS, signal);

        // Subscribe to all relevant events with abort signal
        eventBus.on(
            'llmservice:thinking',
            (payload) => {
                this.broadcast({
                    event: 'thinking',
                    data: {
                        sessionId: payload.sessionId,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'llmservice:chunk',
            (payload) => {
                this.broadcast({
                    event: 'chunk',
                    data: {
                        type: payload.type,
                        content: payload.content,
                        isComplete: payload.isComplete,
                        sessionId: payload.sessionId,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'llmservice:toolCall',
            (payload) => {
                this.broadcast({
                    event: 'toolCall',
                    data: {
                        toolName: payload.toolName,
                        args: payload.args,
                        callId: payload.callId,
                        sessionId: payload.sessionId,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'llmservice:toolResult',
            (payload) => {
                this.broadcast({
                    event: 'toolResult',
                    data: {
                        toolName: payload.toolName,
                        result: payload.result,
                        callId: payload.callId,
                        success: payload.success,
                        sessionId: payload.sessionId,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'llmservice:response',
            (payload) => {
                logger.debug(
                    `[websocket-subscriber]: llmservice:response: ${JSON.stringify(payload)}`
                );
                this.broadcast({
                    event: 'response',
                    data: {
                        text: payload.content,
                        reasoning: payload.reasoning,
                        tokenUsage: payload.tokenUsage,
                        provider: payload.provider,
                        model: payload.model,
                        router: payload.router,
                        sessionId: payload.sessionId,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'llmservice:error',
            (payload) => {
                this.broadcast({
                    event: 'error',
                    data: {
                        message: payload.error.message,
                        context: payload.context,
                        recoverable: payload.recoverable,
                        sessionId: payload.sessionId,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'dexto:conversationReset',
            (payload) => {
                this.broadcast({
                    event: 'conversationReset',
                    data: {
                        sessionId: payload.sessionId,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'dexto:mcpServerConnected',
            (payload) => {
                this.broadcast({
                    event: 'mcpServerConnected',
                    data: {
                        name: payload.name,
                        success: payload.success,
                        error: payload.error,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'dexto:availableToolsUpdated',
            (payload) => {
                this.broadcast({
                    event: 'availableToolsUpdated',
                    data: {
                        tools: payload.tools,
                        source: payload.source,
                    },
                });
            },
            { signal }
        );

        // Forward pre-execution tool confirmation events
        eventBus.on(
            'dexto:toolConfirmationRequest',
            (payload) => {
                this.broadcast({
                    event: 'toolConfirmationRequest',
                    data: payload,
                });
            },
            { signal }
        );
    }

    /**
     * Clean up event listeners and resources
     */
    cleanup(): void {
        if (this.abortController) {
            this.abortController.abort();
            delete this.abortController;
        }

        // Close all WebSocket connections
        for (const client of this.connections) {
            if (client.readyState === WebSocket.OPEN) {
                client.close();
            }
        }
        this.connections.clear();

        logger.debug('WebSocket event subscriber cleaned up');
    }

    private broadcast(message: { event: string; data?: Record<string, any> }): void {
        const messageString = JSON.stringify(message);
        for (const client of this.connections) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageString);
            } else {
                this.connections.delete(client);
            }
        }
    }
}
