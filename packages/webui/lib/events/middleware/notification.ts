/**
 * Notification Middleware
 *
 * Converts significant events into toast notifications.
 * Respects notification suppression during history replay and session switches.
 */

import type { EventMiddleware, ClientEvent } from '../types.js';
import { useSessionStore } from '../../stores/sessionStore.js';
import { useNotificationStore, type Toast } from '../../stores/notificationStore.js';

/**
 * Convert an event to a toast notification
 * Returns null if the event should not generate a toast
 */
function eventToToast(
    event: ClientEvent,
    isCurrentSession: boolean
): Omit<Toast, 'id' | 'timestamp'> | null {
    switch (event.name) {
        // Errors are now shown inline via ErrorBanner, not as toasts
        // Only show toast for errors in background sessions
        case 'llm:error': {
            if (isCurrentSession) {
                return null; // Don't toast - shown inline via ErrorBanner
            }
            const sessionId = 'sessionId' in event ? event.sessionId : undefined;
            return {
                title: 'Error in background session',
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
