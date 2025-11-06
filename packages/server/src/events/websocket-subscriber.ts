import { WebSocketServer, WebSocket } from 'ws';
import { setMaxListeners } from 'events';
import { AgentEventBus, logger } from '@dexto/core';
import { EventSubscriber } from './types.js';

/**
 * TODO: temporarily DUPE OF cli
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
                logger.error(`WebSocket client error: ${error.message}`);
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
                logger.debug(
                    `[websocket-subscriber]: llmservice:toolResult: ${JSON.stringify({
                        toolName: payload.toolName,
                        callId: payload.callId,
                        success: payload.success,
                        sessionId: payload.sessionId,
                    })}`
                );
                const data: Record<string, unknown> = {
                    toolName: payload.toolName,
                    callId: payload.callId,
                    success: payload.success,
                    sanitized: payload.sanitized,
                    sessionId: payload.sessionId,
                };
                if (payload.rawResult !== undefined) {
                    data.rawResult = payload.rawResult;
                }
                this.broadcast({
                    event: 'toolResult',
                    data,
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

        // Forward approval request events (including tool confirmations)
        eventBus.on(
            'dexto:approvalRequest',
            (payload) => {
                this.broadcast({
                    event: 'approvalRequest',
                    data: payload,
                });
            },
            { signal }
        );

        // Forward MCP notification events
        eventBus.on(
            'dexto:mcpResourceUpdated',
            (payload) => {
                this.broadcast({
                    event: 'mcpResourceUpdated',
                    data: {
                        serverName: payload.serverName,
                        resourceUri: payload.resourceUri,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'dexto:mcpPromptsListChanged',
            (payload) => {
                this.broadcast({
                    event: 'mcpPromptsListChanged',
                    data: {
                        serverName: payload.serverName,
                        prompts: payload.prompts,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'dexto:mcpToolsListChanged',
            (payload) => {
                this.broadcast({
                    event: 'mcpToolsListChanged',
                    data: {
                        serverName: payload.serverName,
                        tools: payload.tools,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'dexto:resourceCacheInvalidated',
            (payload) => {
                this.broadcast({
                    event: 'resourceCacheInvalidated',
                    data: {
                        resourceUri: payload.resourceUri,
                        serverName: payload.serverName,
                        action: payload.action,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'dexto:sessionTitleUpdated',
            (payload) => {
                this.broadcast({
                    event: 'sessionTitleUpdated',
                    data: {
                        sessionId: payload.sessionId,
                        title: payload.title,
                    },
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

    /**
     * Unsubscribe from current event bus without closing WebSocket clients.
     * Useful when switching the active agent and re-subscribing to a new bus.
     */
    unsubscribe(): void {
        if (this.abortController) {
            const controller = this.abortController;
            delete this.abortController;
            try {
                controller.abort();
            } catch (error) {
                logger.debug(`Error aborting controller during unsubscribe: ${error}`);
            }
        }
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
