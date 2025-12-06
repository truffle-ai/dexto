/**
 * Event Log Store
 *
 * Stores activity events for debugging and monitoring.
 * Provides an audit trail of all events flowing through the event bus.
 */

import { create } from 'zustand';
import type { StreamingEventName } from '@dexto/core';

// =============================================================================
// Types
// =============================================================================

/**
 * Event categories for organization and filtering
 */
export type EventCategory = 'agent' | 'tool' | 'system' | 'user' | 'approval';

/**
 * Activity event stored in the log
 */
export interface ActivityEvent {
    /**
     * Unique event ID
     */
    id: string;

    /**
     * Event name from SSE
     */
    name: StreamingEventName | string;

    /**
     * Event category
     */
    category: EventCategory;

    /**
     * Human-readable description
     */
    description: string;

    /**
     * Timestamp when event was logged
     */
    timestamp: number;

    /**
     * Session ID if event is session-scoped
     */
    sessionId?: string;

    /**
     * Additional metadata (full event payload)
     */
    metadata?: Record<string, unknown>;
}

// =============================================================================
// Store Interface
// =============================================================================

interface EventLogStore {
    /**
     * Stored events (newest last)
     */
    events: ActivityEvent[];

    /**
     * Maximum number of events to keep
     */
    maxEvents: number;

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    /**
     * Add a new event to the log
     */
    addEvent: (event: Omit<ActivityEvent, 'id'>) => void;

    /**
     * Clear all events
     */
    clearEvents: () => void;

    /**
     * Clear events for a specific session
     */
    clearSessionEvents: (sessionId: string) => void;

    /**
     * Set the maximum number of events to keep
     */
    setMaxEvents: (max: number) => void;

    // -------------------------------------------------------------------------
    // Selectors
    // -------------------------------------------------------------------------

    /**
     * Get events for a specific session
     */
    getEventsBySession: (sessionId: string) => ActivityEvent[];

    /**
     * Get events by category
     */
    getEventsByCategory: (category: EventCategory) => ActivityEvent[];

    /**
     * Get most recent N events
     */
    getRecentEvents: (limit: number) => ActivityEvent[];
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useEventLogStore = create<EventLogStore>()((set, get) => ({
    events: [],
    maxEvents: 1000,

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    addEvent: (event) => {
        const id = `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        set((state) => {
            const newEvents = [...state.events, { ...event, id }];

            // Trim to maxEvents, keeping newest
            if (newEvents.length > state.maxEvents) {
                return { events: newEvents.slice(-state.maxEvents) };
            }

            return { events: newEvents };
        });
    },

    clearEvents: () => {
        set({ events: [] });
    },

    clearSessionEvents: (sessionId) => {
        set((state) => ({
            events: state.events.filter((event) => event.sessionId !== sessionId),
        }));
    },

    setMaxEvents: (max) => {
        set((state) => {
            // If reducing max, trim events immediately
            if (state.events.length > max) {
                return {
                    maxEvents: max,
                    events: state.events.slice(-max),
                };
            }
            return { maxEvents: max };
        });
    },

    // -------------------------------------------------------------------------
    // Selectors
    // -------------------------------------------------------------------------

    getEventsBySession: (sessionId) => {
        return get().events.filter((event) => event.sessionId === sessionId);
    },

    getEventsByCategory: (category) => {
        return get().events.filter((event) => event.category === category);
    },

    getRecentEvents: (limit) => {
        const events = get().events;
        return events.slice(-limit);
    },
}));
