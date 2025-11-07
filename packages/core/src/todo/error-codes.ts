/**
 * Todo Service Error Codes
 */

export enum TodoErrorCode {
    // Service lifecycle errors
    SERVICE_NOT_INITIALIZED = 'TODO_SERVICE_NOT_INITIALIZED',

    // Todo management errors
    TODO_LIMIT_EXCEEDED = 'TODO_LIMIT_EXCEEDED',
    INVALID_TODO_STATUS = 'TODO_INVALID_TODO_STATUS',

    // Database errors
    DATABASE_ERROR = 'TODO_DATABASE_ERROR',
}
