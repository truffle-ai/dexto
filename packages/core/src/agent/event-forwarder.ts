/**
 * EventForwarder
 *
 * Encapsulates event forwarding logic between event buses with automatic cleanup.
 * Used primarily by SubAgentCoordinator to forward events from sub-agent sessions
 * to parent sessions.
 */

import type { SessionEventBus, AgentEventBus } from '../events/index.js';
import type { IDextoLogger } from '../logger/v2/types.js';

/**
 * Common interface for event buses that can be used with EventForwarder.
 * Both SessionEventBus and AgentEventBus implement this interface.
 */
interface EventBusLike {
    on(event: string, listener: (payload?: any) => void): this;
    off(event: string, listener: (payload?: any) => void): this;
    emit(event: string, ...args: any[]): boolean;
}

export interface ForwardOptions {
    /**
     * Transform the payload before forwarding.
     * Use this to add metadata like sessionId, depth, etc.
     */
    augmentPayload?: (payload: any) => any;

    /**
     * Filter events before forwarding.
     * Return false to skip forwarding this event.
     */
    filter?: (payload: any) => boolean;
}

/**
 * EventForwarder handles forwarding events from one bus to another
 * with support for payload transformation and filtering.
 */
export class EventForwarder {
    private forwarders = new Map<string, (payload?: any) => void>();

    constructor(
        private source: SessionEventBus | AgentEventBus,
        private target: SessionEventBus | AgentEventBus,
        private logger: IDextoLogger
    ) {}

    /**
     * Set up forwarding for a specific event.
     *
     * @param eventName - Name of the event to forward
     * @param options - Transformation and filtering options
     */
    forward(eventName: string, options?: ForwardOptions): void {
        // Prevent duplicate registration
        if (this.forwarders.has(eventName)) {
            this.logger.warn(
                `Forwarder for ${eventName} already exists, skipping duplicate registration`
            );
            return;
        }

        // Create forwarder function
        const forwarder = (payload?: any) => {
            try {
                // Apply filter if provided
                if (options?.filter && !options.filter(payload)) {
                    this.logger.silly(`Event ${eventName} filtered, not forwarding`);
                    return;
                }

                // Augment payload if transformer provided
                const augmented = options?.augmentPayload
                    ? options.augmentPayload(payload)
                    : payload;

                this.logger.silly(`Forwarding event ${eventName}`, {
                    hasPayload: !!payload,
                    augmented: !!options?.augmentPayload,
                });

                // Forward to target
                (this.target as EventBusLike).emit(eventName, augmented);
            } catch (error) {
                this.logger.error(
                    `Error forwarding event ${eventName}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        };

        // Store forwarder for cleanup
        this.forwarders.set(eventName, forwarder);

        // Attach to source
        (this.source as EventBusLike).on(eventName, forwarder);

        this.logger.debug(`Event forwarder registered for: ${eventName}`);
    }

    /**
     * Remove all event forwarders and clean up listeners.
     */
    dispose(): void {
        this.forwarders.forEach((forwarder, eventName) => {
            (this.source as EventBusLike).off(eventName, forwarder);
        });

        this.logger.debug(`Disposed ${this.forwarders.size} event forwarders`);
        this.forwarders.clear();
    }

    /**
     * Get count of registered forwarders.
     */
    get count(): number {
        return this.forwarders.size;
    }
}
