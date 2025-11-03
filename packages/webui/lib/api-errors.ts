/**
 * API Error Handling Utilities
 *
 * Extracts error messages from Dexto API responses which can be in multiple formats:
 * 1. DextoRuntimeError: { code, message, scope, type, context?, recovery?, traceId }
 * 2. DextoValidationError: { name, message, issues[], traceId }
 * 3. Wrapped errors: { message, context: { issues: [...] }, ... }
 *
 * Priority order for extraction:
 * 1. context.issues[0].message (wrapped validation errors)
 * 2. issues[0].message (direct validation errors)
 * 3. error (some routes use this)
 * 4. message (standard field)
 * 5. Fallback message
 */

/** Shape of a single validation issue from core */
export interface DextoIssue {
    code: string;
    message: string;
    scope: string;
    type: string;
    severity: 'error' | 'warning';
    path?: Array<string | number>;
    context?: unknown;
}

/** DextoRuntimeError response shape */
export interface DextoRuntimeErrorResponse {
    code: string;
    message: string;
    scope: string;
    type: string;
    context?: {
        issues?: DextoIssue[];
        [key: string]: unknown;
    };
    recovery?: string | string[];
    traceId: string;
}

/** DextoValidationError response shape */
export interface DextoValidationErrorResponse {
    name: 'DextoValidationError';
    message: string;
    issues: DextoIssue[];
    traceId: string;
    errorCount: number;
    warningCount: number;
}

/** Union of possible error response shapes */
export type DextoErrorResponse =
    | DextoRuntimeErrorResponse
    | DextoValidationErrorResponse
    | { error?: string; message?: string; [key: string]: unknown };

/**
 * Extract the most relevant error message from a Dexto API error response
 *
 * @param errorData - The parsed JSON error response from the API
 * @param fallback - Fallback message if no error can be extracted
 * @returns The most specific error message available
 *
 * @example
 * ```ts
 * const res = await fetch('/api/agents/switch', {...});
 * if (!res.ok) {
 *   const errorData = await res.json().catch(() => ({}));
 *   const message = extractErrorMessage(errorData, 'Failed to switch agent');
 *   throw new Error(message);
 * }
 * ```
 */
export function extractErrorMessage(
    errorData: Partial<DextoErrorResponse>,
    fallback: string
): string {
    // Priority 1: Check for wrapped validation errors (context.issues[0].message)
    // This handles DextoRuntimeError wrapping DextoValidationError
    if (errorData.context?.issues && Array.isArray(errorData.context.issues)) {
        const firstIssue = errorData.context.issues[0];
        if (firstIssue?.message) {
            return firstIssue.message;
        }
    }

    // Priority 2: Check for direct validation errors (issues[0].message)
    // This handles unwrapped DextoValidationError
    const issues = (errorData as DextoValidationErrorResponse).issues;
    if (issues && Array.isArray(issues)) {
        const firstIssue = issues[0];
        if (firstIssue?.message) {
            return firstIssue.message;
        }
    }

    // Priority 3: Check for generic error field (some routes use this)
    const error = (errorData as any).error;
    if (typeof error === 'string' && error.length > 0) {
        return error;
    }

    // Priority 4: Check for message field (standard field on all error types)
    if (typeof errorData.message === 'string' && errorData.message.length > 0) {
        return errorData.message;
    }

    // Priority 5: Fallback
    return fallback;
}

/**
 * Extract full error details for logging/debugging
 *
 * @param errorData - The parsed JSON error response
 * @returns Object with all available error information
 */
export function extractErrorDetails(errorData: Partial<DextoErrorResponse>): {
    message: string;
    code?: string;
    scope?: string;
    type?: string;
    traceId?: string;
    recovery?: string | string[];
    issues?: DextoIssue[];
} {
    const code = (errorData as DextoRuntimeErrorResponse).code;
    const scope = (errorData as DextoRuntimeErrorResponse).scope;
    const type = (errorData as DextoRuntimeErrorResponse).type;
    const traceId = (errorData as DextoRuntimeErrorResponse | DextoValidationErrorResponse).traceId;
    const recovery = (errorData as DextoRuntimeErrorResponse).recovery;

    // Get issues from either wrapped or direct validation errors
    let issues: DextoIssue[] | undefined;
    if (errorData.context?.issues) {
        issues = errorData.context.issues;
    } else if ((errorData as DextoValidationErrorResponse).issues) {
        issues = (errorData as DextoValidationErrorResponse).issues;
    }

    return {
        message: extractErrorMessage(errorData, 'An error occurred'),
        code,
        scope,
        type,
        traceId,
        recovery,
        issues,
    };
}
