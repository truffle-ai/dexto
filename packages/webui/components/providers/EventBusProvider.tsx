/**
 * Event Bus Provider
 *
 * Provides the event bus context to the React component tree.
 * Initializes middleware and provides access to the singleton event bus.
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
    ClientEventBus,
    eventBus,
    loggingMiddleware,
    activityMiddleware,
    notificationMiddleware,
    setupEventHandlers,
    type EventMiddleware,
} from '@/lib/events';

/**
 * Event bus context value
 */
interface EventBusContextValue {
    /** The event bus instance */
    bus: ClientEventBus;
}

const EventBusContext = createContext<EventBusContextValue | null>(null);

/**
 * Props for EventBusProvider
 */
interface EventBusProviderProps {
    children: ReactNode;
    /**
     * Additional middleware to register (beyond default logging)
     * Middleware is executed in array order
     */
    middleware?: EventMiddleware[];
    /**
     * Enable logging middleware (default: true in development)
     */
    enableLogging?: boolean;
    /**
     * Enable activity tracking middleware (default: true)
     */
    enableActivityLogging?: boolean;
    /**
     * Enable notification middleware (default: true)
     */
    enableNotifications?: boolean;
    /**
     * Custom event bus instance (for testing)
     * If not provided, uses the singleton instance
     */
    bus?: ClientEventBus;
}

/**
 * Event Bus Provider
 *
 * Wraps the application with event bus context.
 * Initializes default middleware on mount.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <EventBusProvider>
 *   <App />
 * </EventBusProvider>
 *
 * // With all middleware disabled except custom
 * <EventBusProvider
 *   enableLogging={false}
 *   enableActivityLogging={false}
 *   middleware={[customMiddleware]}
 * >
 *   <App />
 * </EventBusProvider>
 *
 * // For testing with isolated bus
 * <EventBusProvider bus={testBus}>
 *   <ComponentUnderTest />
 * </EventBusProvider>
 * ```
 */
export function EventBusProvider({
    children,
    middleware = [],
    enableLogging = process.env.NODE_ENV === 'development',
    enableActivityLogging = true,
    enableNotifications = true,
    bus = eventBus,
}: EventBusProviderProps) {
    // Register middleware and handlers on mount
    useEffect(() => {
        const registeredMiddleware: EventMiddleware[] = [];
        let handlerCleanup: (() => void) | undefined;

        // Register middleware in order (logging first for debugging)
        if (enableLogging) {
            bus.use(loggingMiddleware);
            registeredMiddleware.push(loggingMiddleware);
        }

        if (enableActivityLogging) {
            bus.use(activityMiddleware);
            registeredMiddleware.push(activityMiddleware);
        }

        if (enableNotifications) {
            bus.use(notificationMiddleware);
            registeredMiddleware.push(notificationMiddleware);
        }

        // Add custom middleware
        for (const mw of middleware) {
            bus.use(mw);
            registeredMiddleware.push(mw);
        }

        // Setup event handlers
        handlerCleanup = setupEventHandlers(bus);

        // Cleanup on unmount
        return () => {
            for (const mw of registeredMiddleware) {
                bus.removeMiddleware(mw);
            }
            handlerCleanup?.();
        };
    }, [bus, enableLogging, enableActivityLogging, enableNotifications, middleware]);

    // Memoize context value
    const contextValue = useMemo<EventBusContextValue>(() => ({ bus }), [bus]);

    return <EventBusContext.Provider value={contextValue}>{children}</EventBusContext.Provider>;
}

/**
 * Hook to access the event bus
 *
 * @returns The event bus instance
 * @throws Error if used outside EventBusProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const bus = useEventBus();
 *
 *   useEffect(() => {
 *     const sub = bus.on('llm:response', (event) => {
 *       console.log('Response:', event.content);
 *     });
 *     return () => sub.unsubscribe();
 *   }, [bus]);
 * }
 * ```
 */
export function useEventBus(): ClientEventBus {
    const context = useContext(EventBusContext);
    if (!context) {
        throw new Error('useEventBus must be used within an EventBusProvider');
    }
    return context.bus;
}

/**
 * Hook to subscribe to events with automatic cleanup
 *
 * @param eventName - Event name to subscribe to
 * @param handler - Handler function
 *
 * @example
 * ```tsx
 * function MessageList() {
 *   const [messages, setMessages] = useState<Message[]>([]);
 *
 *   useEventSubscription('llm:response', (event) => {
 *     setMessages(prev => [...prev, {
 *       role: 'assistant',
 *       content: event.content,
 *     }]);
 *   });
 * }
 * ```
 */
export function useEventSubscription<T extends Parameters<ClientEventBus['on']>[0]>(
    eventName: T,
    handler: Parameters<ClientEventBus['on']>[1]
): void {
    const bus = useEventBus();

    useEffect(() => {
        // Type assertion is needed here because the generic relationship between
        // eventName and handler is complex - the EventBus.on() validates at runtime
        const subscription = bus.on(eventName as any, handler as any);
        return () => subscription.unsubscribe();
    }, [bus, eventName, handler]);
}
