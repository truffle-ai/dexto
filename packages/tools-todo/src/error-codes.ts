/**
 * Todo Service Error Codes
 */

export const TODO_ERROR_CODES = [
    'TODO_SERVICE_NOT_INITIALIZED',
    'TODO_LIMIT_EXCEEDED',
    'TODO_INVALID_TODO_STATUS',
    'TODO_DATABASE_ERROR',
] as const;

export type TodoErrorCode = (typeof TODO_ERROR_CODES)[number];

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const TodoErrorCode = {
    // Service lifecycle errors
    SERVICE_NOT_INITIALIZED: 'TODO_SERVICE_NOT_INITIALIZED',

    // Todo management errors
    TODO_LIMIT_EXCEEDED: 'TODO_LIMIT_EXCEEDED',
    INVALID_TODO_STATUS: 'TODO_INVALID_TODO_STATUS',

    // Database errors
    DATABASE_ERROR: 'TODO_DATABASE_ERROR',
} as const;
