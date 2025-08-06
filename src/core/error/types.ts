/**
 * Error types that map directly to HTTP status codes
 * Each type represents the nature of the error
 */
export const enum ErrorType {
    USER = 'user', // 400 - bad input, config errors, validation failures
    NOT_FOUND = 'not_found', // 404 - resource doesn't exist (session, file, etc.)
    FORBIDDEN = 'forbidden', // 403 - permission denied, unauthorized
    TIMEOUT = 'timeout', // 408 - operation timed out
    RATE_LIMIT = 'rate_limit', // 429 - too many requests
    SYSTEM = 'system', // 500 - bugs, internal failures, unexpected states
    THIRD_PARTY = 'third_party', // 502 - upstream provider failures, API errors
}
