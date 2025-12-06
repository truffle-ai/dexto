/**
 * Notification Middleware
 *
 * Converts significant events into toast notifications.
 * Respects notification suppression during history replay and session switches.
 */

import type { EventMiddleware, ClientEvent } from '../types.js';
import { useSessionStore } from '../../stores/sessionStore.js';
import { useNotificationStore, type Toast } from '../../stores/notificationStore.js';
import { ApprovalType } from '@dexto/core';

/**
 * Convert an event to a toast notification
 * Returns null if the event should not generate a toast
 */
function eventToToast(
    event: ClientEvent,
    isCurrentSession: boolean
): Omit<Toast, 'id' | 'timestamp'> | null {
    switch (event.name) {
        // Always notify for approval requests (needs user action)
        case 'approval:request': {
            let description = 'Action needs your approval';

            // Extract tool name for tool confirmation requests
            if (event.type === ApprovalType.TOOL_CONFIRMATION && 'metadata' in event) {
                const toolName = event.metadata.toolName;
                description = `Tool "${toolName}" needs your approval`;
            }

            return {
                title: 'Approval Required',
                description,
                intent: 'warning',
                sessionId: 'sessionId' in event ? event.sessionId : undefined,
            };
        }

        // Always notify for errors (user should know)
        case 'llm:error': {
            const sessionId = 'sessionId' in event ? event.sessionId : undefined;
            return {
                title: 'Error',
                description: event.error?.message || 'An error occurred',
                intent: 'danger',
                sessionId,
            };
        }

        // Only notify for background sessions (not current session)
        case 'llm:response': {
            const sessionId = 'sessionId' in event ? event.sessionId : undefined;
            if (isCurrentSession) {
                return null; // Don't notify for current session
            }
            return {
                title: 'Response Ready',
                description: 'Agent completed in background session',
                intent: 'info',
                sessionId,
            };
        }

        // No notifications for other events
        default:
            return null;
    }
}

/**
 * Notification middleware
 *
 * Converts events into toast notifications based on:
 * - Event type (approval, error, response)
 * - Session context (current vs background)
 * - Notification suppression state (replay, switching)
 */
export const notificationMiddleware: EventMiddleware = (event, next) => {
    // Always call next first
    next(event);

    const { shouldSuppressNotifications, currentSessionId } = useSessionStore.getState();
    const { addToast } = useNotificationStore.getState();

    // Skip notifications during history replay or session switch
    if (shouldSuppressNotifications()) {
        return;
    }

    // Determine if this event is from the current session
    const sessionId = 'sessionId' in event ? event.sessionId : undefined;
    const isCurrentSession = sessionId === currentSessionId;

    // Convert event to toast
    const toast = eventToToast(event, isCurrentSession);

    // Add toast if applicable
    if (toast) {
        addToast(toast);
    }
};
