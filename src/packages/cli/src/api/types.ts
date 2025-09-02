import { AgentEventBus } from '@core/events/index.js';

/**
 * Generic interface for subscribing to core events.
 */
export interface EventSubscriber {
    /**
     * Attach event handlers to the given event bus.
     */
    subscribe(eventBus: AgentEventBus): void;

    /**
     * Clean up event listeners and resources.
     */
    cleanup?(): void;
}
