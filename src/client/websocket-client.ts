import { DextoEvent, DextoNetworkError } from './types.js';

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
                    throw new Error(
                        'WebSocket not available in this environment. Use HTTP methods or run in browser.'
                    );
                }

                this.setupEventHandlers(resolve, reject);
            } catch (error) {
                reject(
                    new DextoNetworkError(
                        'Failed to create WebSocket connection',
                        error instanceof Error ? error : undefined
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
            try {
                const data = JSON.parse(event.data);
                this.handleIncomingMessage(data);
            } catch (error) {
                console.warn('Failed to parse WebSocket message:', event.data);
            }
        };

        this.ws.onclose = (event) => {
            this.emitState('closed');

            if (
                !this.isIntentionallyClosed &&
                this.reconnectEnabled &&
                this.reconnectAttempts < this.maxReconnectAttempts
            ) {
                this.scheduleReconnect();
            }
        };

        this.ws.onerror = (error) => {
            this.emitState('error');

            // Only reject on initial connection attempt
            if (this.reconnectAttempts === 0) {
                reject(new DextoNetworkError('WebSocket connection failed'));
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

    private handleIncomingMessage(data: any) {
        const event: DextoEvent = {
            type: data.type || 'unknown',
            data: data.data || data,
            sessionId: data.sessionId,
        };

        // Emit to specific event handlers
        const handlers = this.eventHandlers.get(event.type);
        if (handlers) {
            handlers.forEach((handler) => {
                try {
                    handler(event);
                } catch (error) {
                    console.error(`Error in event handler for ${event.type}:`, error);
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
                    console.error(`Error in wildcard event handler:`, error);
                }
            });
        }
    }

    // Send a message through the WebSocket
    send(message: any): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return false;
        }

        try {
            this.ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('Failed to send WebSocket message:', error);
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
                console.error('Error in connection state handler:', error);
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
