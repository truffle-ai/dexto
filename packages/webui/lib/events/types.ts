/**
 * Event types for the WebUI client event bus
 *
 * Uses StreamingEvent from @dexto/core as the source of truth.
 * Only client-only events (like connection status) are defined locally.
 */

import type { StreamingEvent, StreamingEventName } from '@dexto/core';

// Re-export core types for convenience
export type { StreamingEvent, StreamingEventName };

/**
 * Type helper to extract a specific event by its name
 *
 * @example
 * type ChunkEvent = EventByName<'llm:chunk'>;
 * // { name: 'llm:chunk', content: string, chunkType: 'text' | 'reasoning', sessionId: string, ... }
 */
export type EventByName<T extends StreamingEventName> = Extract<StreamingEvent, { name: T }>;

/**
 * Client-only event for connection status changes
 * This event is generated locally, not from the server
 */
export interface ConnectionStatusEvent {
    name: 'connection:status';
    status: 'connected' | 'disconnected' | 'reconnecting';
    timestamp: number;
}

/**
 * Union of all events that can flow through the client event bus
 * Includes server events (StreamingEvent) + client-only events
 */
export type ClientEvent = StreamingEvent | ConnectionStatusEvent;

/**
 * Extract the event name from a ClientEvent
 */
export type ClientEventName = ClientEvent['name'];

/**
 * Middleware function signature
 *
 * Middleware receives an event and a next function.
 * It can:
 * - Pass the event through: next(event)
 * - Modify the event: next({ ...event, modified: true })
 * - Block the event: don't call next()
 * - Perform side effects (logging, notifications, etc.)
 *
 * @example
 * const loggingMiddleware: EventMiddleware = (event, next) => {
 *   console.log('Event:', event.name);
 *   next(event);
 * };
 */
export type EventMiddleware = (event: ClientEvent, next: (event: ClientEvent) => void) => void;

/**
 * Event handler function signature
 *
 * Handlers are called after middleware processing completes.
 * They receive the final event and perform state updates.
 *
 * @example
 * const handleChunk: EventHandler<EventByName<'llm:chunk'>> = (event) => {
 *   chatStore.appendToStreamingMessage(event.sessionId, event.content);
 * };
 */
export type EventHandler<T extends ClientEvent = ClientEvent> = (event: T) => void;

/**
 * Subscription returned when registering a handler
 * Call unsubscribe() to remove the handler
 */
export interface EventSubscription {
    unsubscribe: () => void;
}

/**
 * Type guard to check if an event is a specific type
 *
 * @example
 * if (isEventType(event, 'llm:chunk')) {
 *   // event is narrowed to EventByName<'llm:chunk'>
 *   console.log(event.content);
 * }
 */
export function isEventType<T extends ClientEventName>(
    event: ClientEvent,
    name: T
): event is Extract<ClientEvent, { name: T }> {
    return event.name === name;
}

/**
 * Type guard for connection status events (client-only)
 */
export function isConnectionStatusEvent(event: ClientEvent): event is ConnectionStatusEvent {
    return event.name === 'connection:status';
}
