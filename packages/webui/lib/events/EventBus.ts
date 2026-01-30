/**
 * Client Event Bus
 *
 * Central event dispatch system with middleware pipeline support.
 * All SSE events flow through this bus, enabling:
 * - Unified logging and debugging
 * - Cross-cutting concerns (notifications, analytics)
 * - Event history for replay and debugging
 * - Type-safe event handling
 */

import type {
    ClientEvent,
    ClientEventName,
    EventMiddleware,
    EventHandler,
    EventSubscription,
} from './types.js';

/**
 * Maximum number of events to keep in history
 */
const MAX_HISTORY_SIZE = 1000;

/**
 * Client Event Bus
 *
 * Provides centralized event dispatch with middleware support.
 *
 * @example
 * ```typescript
 * const eventBus = new ClientEventBus();
 *
 * // Add middleware
 * eventBus.use(loggingMiddleware);
 * eventBus.use(notificationMiddleware);
 *
 * // Subscribe to specific events
 * eventBus.on('llm:chunk', (event) => {
 *   console.log('Chunk:', event.content);
 * });
 *
 * // Subscribe to all events
 * eventBus.on('*', (event) => {
 *   console.log('Any event:', event.name);
 * });
 *
 * // Dispatch an event
 * eventBus.dispatch({ name: 'llm:thinking', sessionId: 'abc' });
 * ```
 */
export class ClientEventBus {
    /**
     * Registered middleware functions (executed in order)
     */
    private middlewares: EventMiddleware[] = [];

    /**
     * Event handlers by event name
     * '*' is the wildcard key for handlers that receive all events
     */
    private handlers: Map<ClientEventName | '*', Set<EventHandler>> = new Map();

    /**
     * Event history for debugging and replay
     */
    private history: ClientEvent[] = [];

    /**
     * Flag to track if we're currently replaying history
     * Used by middleware to suppress notifications during replay
     */
    private _isReplaying = false;

    /**
     * Register a middleware function
     *
     * Middleware is executed in the order it's added.
     * Each middleware must call next(event) to continue the chain.
     *
     * @param middleware - Middleware function to add
     * @returns this for chaining
     */
    use(middleware: EventMiddleware): this {
        // Prevent duplicate middleware
        if (!this.middlewares.includes(middleware)) {
            this.middlewares.push(middleware);
        }
        return this;
    }

    /**
     * Remove a middleware function
     *
     * @param middleware - Middleware function to remove
     * @returns this for chaining
     */
    removeMiddleware(middleware: EventMiddleware): this {
        const index = this.middlewares.indexOf(middleware);
        if (index !== -1) {
            this.middlewares.splice(index, 1);
        }
        return this;
    }

    /**
     * Subscribe to events of a specific type
     *
     * @param eventName - Event name to subscribe to, or '*' for all events
     * @param handler - Handler function to call when event is dispatched
     * @returns Subscription object with unsubscribe method
     */
    on<T extends ClientEventName | '*'>(
        eventName: T,
        handler: T extends '*' ? EventHandler : EventHandler<Extract<ClientEvent, { name: T }>>
    ): EventSubscription {
        let handlerSet = this.handlers.get(eventName);
        if (!handlerSet) {
            handlerSet = new Set();
            this.handlers.set(eventName, handlerSet);
        }
        handlerSet.add(handler as EventHandler);

        return {
            unsubscribe: () => {
                handlerSet?.delete(handler as EventHandler);
                // Clean up empty sets
                if (handlerSet?.size === 0) {
                    this.handlers.delete(eventName);
                }
            },
        };
    }

    /**
     * Subscribe to an event once
     *
     * Handler will be automatically unsubscribed after first invocation.
     *
     * @param eventName - Event name to subscribe to
     * @param handler - Handler function to call once
     * @returns Subscription object with unsubscribe method
     */
    once<T extends ClientEventName>(
        eventName: T,
        handler: EventHandler<Extract<ClientEvent, { name: T }>>
    ): EventSubscription {
        const wrappedHandler = (event: ClientEvent) => {
            subscription.unsubscribe();
            handler(event as Extract<ClientEvent, { name: T }>);
        };
        // Use type assertion for the wrapped handler
        const subscription = this.on(eventName, wrappedHandler as any);

        return subscription;
    }

    /**
     * Remove all handlers for a specific event type
     *
     * @param eventName - Event name to clear handlers for
     */
    off(eventName: ClientEventName | '*'): void {
        this.handlers.delete(eventName);
    }

    /**
     * Dispatch an event through the middleware chain and to handlers
     *
     * Events flow through middleware first (in order), then to handlers.
     * Middleware can modify, block, or pass through events.
     *
     * @param event - Event to dispatch
     */
    dispatch(event: ClientEvent): void {
        // Add to history
        this.addToHistory(event);

        // Build middleware chain
        const chain = this.buildMiddlewareChain((finalEvent) => {
            this.notifyHandlers(finalEvent);
        });

        // Start the chain
        chain(event);
    }

    /**
     * Get event history
     *
     * @param filter - Optional filter function
     * @returns Array of events matching filter (or all if no filter)
     */
    getHistory(filter?: (event: ClientEvent) => boolean): ClientEvent[] {
        if (filter) {
            return this.history.filter(filter);
        }
        return [...this.history];
    }

    /**
     * Get events by session ID
     *
     * @param sessionId - Session ID to filter by
     * @returns Array of events for the session
     */
    getHistoryBySession(sessionId: string): ClientEvent[] {
        return this.history.filter(
            (event) => 'sessionId' in event && event.sessionId === sessionId
        );
    }

    /**
     * Clear event history
     */
    clearHistory(): void {
        this.history = [];
    }

    /**
     * Replay events through the bus
     *
     * Useful for restoring state after reconnection or loading history.
     * Sets isReplaying flag so middleware can suppress notifications.
     *
     * @param events - Events to replay
     */
    replay(events: ClientEvent[]): void {
        this._isReplaying = true;
        try {
            for (const event of events) {
                this.dispatch(event);
            }
        } finally {
            this._isReplaying = false;
        }
    }

    /**
     * Check if currently replaying history
     *
     * Middleware can use this to suppress notifications during replay.
     */
    get isReplaying(): boolean {
        return this._isReplaying;
    }

    /**
     * Set replay state (for external control, e.g., session switching)
     */
    setReplaying(replaying: boolean): void {
        this._isReplaying = replaying;
    }

    /**
     * Get count of registered handlers
     */
    get handlerCount(): number {
        let count = 0;
        for (const handlers of this.handlers.values()) {
            count += handlers.size;
        }
        return count;
    }

    /**
     * Get count of registered middleware
     */
    get middlewareCount(): number {
        return this.middlewares.length;
    }

    /**
     * Build the middleware chain
     *
     * Creates a function that passes the event through each middleware in order,
     * finally calling the done callback with the (possibly modified) event.
     */
    private buildMiddlewareChain(done: (event: ClientEvent) => void): (event: ClientEvent) => void {
        // Start from the end and build backwards
        let next = done;

        for (let i = this.middlewares.length - 1; i >= 0; i--) {
            const middleware = this.middlewares[i];
            const currentNext = next;
            next = (event: ClientEvent) => {
                middleware(event, currentNext);
            };
        }

        return next;
    }

    /**
     * Notify all handlers for an event
     */
    private notifyHandlers(event: ClientEvent): void {
        // Notify specific handlers
        const specificHandlers = this.handlers.get(event.name);
        if (specificHandlers) {
            for (const handler of specificHandlers) {
                try {
                    handler(event);
                } catch (error) {
                    console.error(`[EventBus] Handler error for ${event.name}:`, error);
                }
            }
        }

        // Notify wildcard handlers
        const wildcardHandlers = this.handlers.get('*');
        if (wildcardHandlers) {
            for (const handler of wildcardHandlers) {
                try {
                    handler(event);
                } catch (error) {
                    console.error(`[EventBus] Wildcard handler error:`, error);
                }
            }
        }
    }

    /**
     * Add event to history, respecting max size
     */
    private addToHistory(event: ClientEvent): void {
        this.history.push(event);

        // Trim if over limit
        if (this.history.length > MAX_HISTORY_SIZE) {
            this.history = this.history.slice(-MAX_HISTORY_SIZE);
        }
    }
}

/**
 * Singleton event bus instance
 *
 * Use this for the global application event bus.
 * Components should access via EventBusProvider context for testability.
 */
export const eventBus = new ClientEventBus();
