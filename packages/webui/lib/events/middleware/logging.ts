/**
 * Logging Middleware
 *
 * Logs all events for debugging purposes.
 * Can be enabled/disabled based on environment or flags.
 */

import type { EventMiddleware, ClientEvent } from '../types.js';

/**
 * Event categories for colored logging
 */
const EVENT_CATEGORIES: Record<string, { color: string; label: string }> = {
    // LLM events
    'llm:thinking': { color: '#3b82f6', label: 'LLM' },
    'llm:chunk': { color: '#3b82f6', label: 'LLM' },
    'llm:response': { color: '#22c55e', label: 'LLM' },
    'llm:tool-call': { color: '#f59e0b', label: 'Tool' },
    'llm:tool-result': { color: '#f59e0b', label: 'Tool' },
    'llm:error': { color: '#ef4444', label: 'Error' },
    'llm:unsupported-input': { color: '#ef4444', label: 'Error' },

    // Approval events
    'approval:request': { color: '#8b5cf6', label: 'Approval' },
    'approval:response': { color: '#8b5cf6', label: 'Approval' },

    // Session events
    'session:title-updated': { color: '#06b6d4', label: 'Session' },

    // Context events
    'context:compacted': { color: '#64748b', label: 'Context' },
    'context:pruned': { color: '#64748b', label: 'Context' },

    // Queue events
    'message:queued': { color: '#ec4899', label: 'Queue' },
    'message:dequeued': { color: '#ec4899', label: 'Queue' },

    // Run lifecycle
    'run:complete': { color: '#22c55e', label: 'Run' },

    // Connection (client-only)
    'connection:status': { color: '#64748b', label: 'Connection' },
};

/**
 * Get summary for an event (for compact logging)
 */
function getEventSummary(event: ClientEvent): string {
    switch (event.name) {
        case 'llm:thinking':
            return `session=${event.sessionId}`;
        case 'llm:chunk':
            return `${event.chunkType}: "${event.content.slice(0, 30)}${event.content.length > 30 ? '...' : ''}"`;
        case 'llm:response':
            return `tokens=${event.tokenUsage?.totalTokens ?? '?'}, model=${event.model ?? '?'}`;
        case 'llm:tool-call':
            return `${event.toolName}(${JSON.stringify(event.args).slice(0, 50)}...)`;
        case 'llm:tool-result':
            return `${event.toolName}: ${event.success ? 'success' : 'failed'}`;
        case 'llm:error':
            return event.error?.message ?? 'Unknown error';
        case 'approval:request': {
            // toolName is in metadata for tool_confirmation type
            const toolName =
                'metadata' in event && event.metadata && 'toolName' in event.metadata
                    ? event.metadata.toolName
                    : 'unknown';
            return `${event.type}: ${toolName}`;
        }
        case 'approval:response':
            return `${event.approvalId}: ${event.status}`;
        case 'session:title-updated':
            return `"${event.title}"`;
        case 'run:complete':
            return `reason=${event.finishReason}, steps=${event.stepCount}`;
        case 'message:dequeued':
            return `count=${event.count}`;
        case 'connection:status':
            return event.status;
        default:
            return '';
    }
}

/**
 * Configuration for logging middleware
 */
export interface LoggingConfig {
    /** Enable/disable logging */
    enabled: boolean;
    /** Log full event payload (verbose) */
    verbose: boolean;
    /** Event names to exclude from logging */
    exclude: string[];
    /** Only log these event names (if set, overrides exclude) */
    include?: string[];
}

const defaultConfig: LoggingConfig = {
    enabled: process.env.NODE_ENV === 'development',
    verbose: false,
    exclude: ['llm:chunk'], // Chunks are too noisy by default
};

let config: LoggingConfig = { ...defaultConfig };

/**
 * Configure the logging middleware
 */
export function configureLogging(newConfig: Partial<LoggingConfig>): void {
    config = { ...config, ...newConfig };
}

/**
 * Reset logging config to defaults
 */
export function resetLoggingConfig(): void {
    config = { ...defaultConfig };
}

/**
 * Logging middleware
 *
 * Logs events to the console with colored labels and summaries.
 * Disabled by default in production.
 */
export const loggingMiddleware: EventMiddleware = (event, next) => {
    // Always pass through
    next(event);

    // Skip if disabled
    if (!config.enabled) {
        return;
    }

    // Check include/exclude filters
    if (config.include && !config.include.includes(event.name)) {
        return;
    }
    if (!config.include && config.exclude.includes(event.name)) {
        return;
    }

    // Get category info
    const category = EVENT_CATEGORIES[event.name] ?? { color: '#9ca3af', label: 'Event' };
    const summary = getEventSummary(event);

    // Log with styling
    const sessionId = 'sessionId' in event ? event.sessionId : undefined;
    const sessionSuffix = sessionId ? ` [${sessionId.slice(0, 8)}]` : '';

    console.log(
        `%c[${category.label}]%c ${event.name}${sessionSuffix}${summary ? ` - ${summary}` : ''}`,
        `color: ${category.color}; font-weight: bold`,
        'color: inherit'
    );

    // Verbose mode: log full payload
    if (config.verbose) {
        console.log('  Payload:', event);
    }
};

/**
 * Create a custom logging middleware with specific config
 */
export function createLoggingMiddleware(customConfig: Partial<LoggingConfig>): EventMiddleware {
    const localConfig = { ...defaultConfig, ...customConfig };

    return (event, next) => {
        next(event);

        if (!localConfig.enabled) {
            return;
        }

        if (localConfig.include && !localConfig.include.includes(event.name)) {
            return;
        }
        if (!localConfig.include && localConfig.exclude.includes(event.name)) {
            return;
        }

        const category = EVENT_CATEGORIES[event.name] ?? { color: '#9ca3af', label: 'Event' };
        const summary = getEventSummary(event);
        const sessionId = 'sessionId' in event ? event.sessionId : undefined;
        const sessionSuffix = sessionId ? ` [${sessionId.slice(0, 8)}]` : '';

        console.log(
            `%c[${category.label}]%c ${event.name}${sessionSuffix}${summary ? ` - ${summary}` : ''}`,
            `color: ${category.color}; font-weight: bold`,
            'color: inherit'
        );

        if (localConfig.verbose) {
            console.log('  Payload:', event);
        }
    };
}
