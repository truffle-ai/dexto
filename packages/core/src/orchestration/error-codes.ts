/**
 * Orchestration Service Error Codes
 */

export enum OrchestrationErrorCode {
    // Service lifecycle errors
    SERVICE_NOT_INITIALIZED = 'ORCHESTRATION_SERVICE_NOT_INITIALIZED',

    // Todo management errors
    TODO_LIMIT_EXCEEDED = 'ORCHESTRATION_TODO_LIMIT_EXCEEDED',
    INVALID_TODO_STATUS = 'ORCHESTRATION_INVALID_TODO_STATUS',

    // Database errors
    DATABASE_ERROR = 'ORCHESTRATION_DATABASE_ERROR',
}
