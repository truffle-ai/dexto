import { DextoEvent } from './types.js';
import { ClientError } from './errors.js';

export type EventHandler = (event: DextoEvent) => void;
export type ConnectionStateHandler = (state: 'connecting' | 'open' | 'closed' | 'error') => void;

/**
 * WebSocket client for real-time communication with Dexto server
 * Works in both browser and Node.js environments
 */
export class WebSocketClient {
    private ws: WebSocket | null = null;
    private url: string;
    private eventHandlers = new Map<string, Set<EventHandler>>();
    private stateHandlers = new Set<ConnectionStateHandler>();
    private reconnectEnabled = true;
    private reconnectInterval = 5000;
    private maxReconnectAttempts = 10;
    private reconnectAttempts = 0;
    private isIntentionallyClosed = false;

    constructor(
        url: string,
        options: {
            reconnect?: boolean;
            reconnectInterval?: number;
            maxReconnectAttempts?: number;
        } = {}
    ) {
        this.url = url;
        this.reconnectEnabled = options.reconnect ?? true;
        this.reconnectInterval = options.reconnectInterval ?? 5000;
        this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.isIntentionallyClosed = false;

                // Handle both browser and Node.js WebSocket implementations
                if (typeof WebSocket !== 'undefined') {
                    // Browser environment
                    this.ws = new WebSocket(this.url);
                } else {
                    // Node.js environment - would need to import ws package
                    // For now, throw error as Node.js users should use HTTP methods
                    reject(
                        ClientError.websocketConnectionFailed(
                            this.url,
                            new Error(
                                'WebSocket not available in this environment. Use HTTP methods or run in a browser.'
                            )
                        )
                    );
                    return;
                }

                this.setupEventHandlers(resolve, reject);
            } catch (error) {
                reject(
                    ClientError.websocketConnectionFailed(
                        this.url,
                        error instanceof Error
                            ? error
                            : new Error('Failed to create WebSocket connection')
                    )
                );
            }
        });
    }

    private setupEventHandlers(resolve: () => void, reject: (error: Error) => void) {
        if (!this.ws) return;

        this.ws.onopen = () => {
            this.reconnectAttempts = 0;
            this.emitState('open');
            resolve();
        };

        this.ws.onmessage = (event) => {
            const raw = event.data as unknown;
            const tryDispatch = (text: string) => {
                try {
                    this.handleIncomingMessage(JSON.parse(text));
                } catch (err) {
                    console.warn(
                        `[WebSocketClient] Failed to parse WebSocket message: ${err instanceof Error ? err.message : String(err)}`
                    );
                }
            };

            if (typeof raw === 'string') {
                tryDispatch(raw);
            } else if (typeof globalThis.Blob !== 'undefined' && raw instanceof globalThis.Blob) {
                raw.text()
                    .then(tryDispatch)
                    .catch((err) => {
                        console.warn(
                            `[WebSocketClient] Failed to read Blob message: ${err instanceof Error ? err.message : String(err)}`
                        );
                    });
            } else if (typeof ArrayBuffer !== 'undefined' && raw instanceof ArrayBuffer) {
                try {
                    const text = new globalThis.TextDecoder().decode(raw);
                    tryDispatch(text);
                } catch (err) {
                    console.warn(
                        `[WebSocketClient] Failed to decode ArrayBuffer message: ${err instanceof Error ? err.message : String(err)}`
                    );
                }
            } else {
                console.warn(
                    `[WebSocketClient] Ignoring non-text WebSocket message of type: ${Object.prototype.toString.call(raw)}`
                );
            }
        };

        this.ws.onclose = (_event) => {
            this.emitState('closed');

            if (
                !this.isIntentionallyClosed &&
                this.reconnectEnabled &&
                this.reconnectAttempts < this.maxReconnectAttempts
            ) {
                this.scheduleReconnect();
            }
        };

        this.ws.onerror = (_error) => {
            this.emitState('error');

            // Only reject on initial connection attempt
            if (this.reconnectAttempts === 0) {
                reject(ClientError.websocketConnectionFailed(this.url));
            }
        };
    }

    private scheduleReconnect() {
        this.reconnectAttempts++;

        setTimeout(() => {
            if (!this.isIntentionallyClosed) {
                this.emitState('connecting');
                this.connect().catch(() => {
                    // Connection failed, will try again or give up based on max attempts
                });
            }
        }, this.reconnectInterval);
    }

    private handleIncomingMessage(data: unknown) {
        const msgData = data as Record<string, unknown>;
        const event: DextoEvent = {
            type: (msgData.type as string) || 'unknown',
            data: msgData.data || msgData,
            sessionId: msgData.sessionId as string | undefined,
        };

        // Emit to specific event handlers
        const handlers = this.eventHandlers.get(event.type);
        if (handlers) {
            handlers.forEach((handler) => {
                try {
                    handler(event);
                } catch (error) {
                    console.error(
                        `Error in event handler for ${event.type}: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            });
        }

        // Emit to wildcard handlers
        const wildcardHandlers = this.eventHandlers.get('*');
        if (wildcardHandlers) {
            wildcardHandlers.forEach((handler) => {
                try {
                    handler(event);
                } catch (error) {
                    console.error(
                        `Error in wildcard event handler: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            });
        }
    }

    // Send a message through the WebSocket
    send(message: unknown): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return false;
        }

        try {
            this.ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error(
                `Failed to send WebSocket message: ${error instanceof Error ? error.message : String(error)}`
            );
            return false;
        }
    }

    // Subscribe to specific event types
    on(eventType: string, handler: EventHandler): () => void {
        if (!this.eventHandlers.has(eventType)) {
            this.eventHandlers.set(eventType, new Set());
        }

        this.eventHandlers.get(eventType)!.add(handler);

        // Return unsubscribe function
        return () => {
            const handlers = this.eventHandlers.get(eventType);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    this.eventHandlers.delete(eventType);
                }
            }
        };
    }

    // Subscribe to connection state changes
    onConnectionState(handler: ConnectionStateHandler): () => void {
        this.stateHandlers.add(handler);

        return () => {
            this.stateHandlers.delete(handler);
        };
    }

    private emitState(state: 'connecting' | 'open' | 'closed' | 'error') {
        this.stateHandlers.forEach((handler) => {
            try {
                handler(state);
            } catch (error) {
                console.error(
                    `Error in connection state handler: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        });
    }

    // Get current connection state
    get state(): 'connecting' | 'open' | 'closed' | 'error' {
        if (!this.ws) return 'closed';

        switch (this.ws.readyState) {
            case WebSocket.CONNECTING:
                return 'connecting';
            case WebSocket.OPEN:
                return 'open';
            case WebSocket.CLOSING:
            case WebSocket.CLOSED:
                return 'closed';
            default:
                return 'closed';
        }
    }

    // Close the connection
    close() {
        this.isIntentionallyClosed = true;
        this.reconnectEnabled = false;

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    // Enable/disable automatic reconnection
    setReconnectEnabled(enabled: boolean) {
        this.reconnectEnabled = enabled;
    }
}
