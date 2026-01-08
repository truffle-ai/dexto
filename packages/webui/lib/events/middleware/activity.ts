/**
 * Activity Middleware
 *
 * Logs events to the activity log store for debugging and monitoring.
 * Maps event types to human-readable descriptions and categories.
 */

import type { EventMiddleware, ClientEvent } from '../types.js';
import type { StreamingEventName } from '@dexto/core';
import { useEventLogStore, type EventCategory } from '../../stores/eventLogStore.js';

// =============================================================================
// Activity Mapping Configuration
// =============================================================================

/**
 * Activity mapping for an event
 */
interface ActivityMapping {
    /**
     * Event category
     */
    category: EventCategory;

    /**
     * Function to generate human-readable description from event
     */
    getDescription: (event: ClientEvent) => string;
}

/**
 * Map of event names to activity mappings
 */
const activityMappings: Partial<Record<StreamingEventName | string, ActivityMapping>> = {
    'llm:thinking': {
        category: 'agent',
        getDescription: () => 'Agent started processing',
    },

    'llm:chunk': {
        category: 'agent',
        getDescription: (e) => {
            if (e.name === 'llm:chunk') {
                const preview = e.content?.slice(0, 50) || '';
                return `Streaming ${e.chunkType}: "${preview}${preview.length >= 50 ? '...' : ''}"`;
            }
            return 'Content chunk received';
        },
    },

    'llm:response': {
        category: 'agent',
        getDescription: (e) => {
            if (e.name === 'llm:response') {
                const tokens = e.tokenUsage?.totalTokens;
                return tokens ? `Response complete (${tokens} tokens)` : 'Response complete';
            }
            return 'Response complete';
        },
    },

    'llm:tool-call': {
        category: 'tool',
        getDescription: (e) => {
            if (e.name === 'llm:tool-call') {
                return `Calling tool: ${e.toolName}`;
            }
            return 'Tool call';
        },
    },

    'llm:tool-result': {
        category: 'tool',
        getDescription: (e) => {
            if (e.name === 'llm:tool-result') {
                const status = e.success ? 'succeeded' : 'failed';
                return `Tool ${e.toolName} ${status}`;
            }
            return 'Tool result';
        },
    },

    'llm:error': {
        category: 'system',
        getDescription: (e) => {
            if (e.name === 'llm:error') {
                return `Error: ${e.error?.message || 'Unknown error'}`;
            }
            return 'Error occurred';
        },
    },

    'approval:request': {
        category: 'approval',
        getDescription: (e) => {
            if (e.name === 'approval:request') {
                // Tool confirmation requests have toolName in metadata
                if (e.type === 'tool_confirmation' && 'toolName' in e.metadata) {
                    return `Approval requested for ${e.metadata.toolName}`;
                }
                // Command confirmation requests
                if (e.type === 'command_confirmation' && 'toolName' in e.metadata) {
                    return `Command approval requested for ${e.metadata.toolName}`;
                }
                // Generic approval request
                return `Approval requested (${e.type})`;
            }
            return 'Approval requested';
        },
    },

    'approval:response': {
        category: 'approval',
        getDescription: (e) => {
            if (e.name === 'approval:response') {
                const statusText =
                    e.status === 'approved'
                        ? 'granted'
                        : e.status === 'denied'
                          ? 'denied'
                          : 'cancelled';
                return `Approval ${statusText}`;
            }
            return 'Approval response';
        },
    },

    'run:complete': {
        category: 'agent',
        getDescription: (e) => {
            if (e.name === 'run:complete') {
                return `Run complete (${e.finishReason})`;
            }
            return 'Run complete';
        },
    },

    'session:title-updated': {
        category: 'system',
        getDescription: (e) => {
            if (e.name === 'session:title-updated') {
                return `Session title: "${e.title}"`;
            }
            return 'Session title updated';
        },
    },

    'message:dequeued': {
        category: 'user',
        getDescription: () => 'Queued message processed',
    },

    'message:queued': {
        category: 'user',
        getDescription: (e) => {
            if (e.name === 'message:queued') {
                return `Message queued at position ${e.position}`;
            }
            return 'Message queued';
        },
    },

    'context:compacted': {
        category: 'system',
        getDescription: (e) => {
            if (e.name === 'context:compacted') {
                return `Context compacted: ${e.originalTokens} → ${e.compactedTokens} tokens`;
            }
            return 'Context compacted';
        },
    },

    'context:pruned': {
        category: 'system',
        getDescription: (e) => {
            if (e.name === 'context:pruned') {
                return `Context pruned: ${e.prunedCount} messages, saved ${e.savedTokens} tokens`;
            }
            return 'Context pruned';
        },
    },

    'connection:status': {
        category: 'system',
        getDescription: (e) => {
            if (e.name === 'connection:status') {
                return `Connection ${e.status}`;
            }
            return 'Connection status changed';
        },
    },
};

// =============================================================================
// Middleware Implementation
// =============================================================================

/**
 * Activity logging middleware
 *
 * Logs all events to the event log store for debugging and monitoring.
 * Always calls next() to ensure events continue through the pipeline.
 */
export const activityMiddleware: EventMiddleware = (event, next) => {
    // Always call next first to ensure event propagates
    next(event);

    const { addEvent } = useEventLogStore.getState();
    const mapping = activityMappings[event.name];

    if (mapping) {
        // Known event type - use mapping
        addEvent({
            name: event.name,
            category: mapping.category,
            description: mapping.getDescription(event),
            timestamp: Date.now(),
            sessionId: 'sessionId' in event ? event.sessionId : undefined,
            metadata: { ...event },
        });
    } else {
        // Unknown event type - log with generic description
        addEvent({
            name: event.name,
            category: 'system',
            description: `Unknown event: ${event.name}`,
            timestamp: Date.now(),
            sessionId: 'sessionId' in event ? event.sessionId : undefined,
            metadata: { ...event },
        });
    }
};
