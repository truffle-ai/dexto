/**
 * Event Bus Middleware
 *
 * Export all middleware functions for the client event bus.
 */

export {
    loggingMiddleware,
    createLoggingMiddleware,
    configureLogging,
    resetLoggingConfig,
    type LoggingConfig,
} from './logging.js';

export { notificationMiddleware } from './notification.js';
export { activityMiddleware } from './activity.js';

// Future middleware exports:
// export { analyticsMiddleware } from './analytics.js';
