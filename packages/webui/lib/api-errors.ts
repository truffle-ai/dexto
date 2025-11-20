/**
 * API Error Handling Utilities
 *
 * Extracts error messages from Dexto API responses which can be in multiple formats:
 * 1. DextoRuntimeError: { code, message, scope, type, context?, recovery?, traceId }
 * 2. DextoValidationError: { name, message, issues[], traceId }
 * 3. Wrapped errors: { message, context: { issues: [...] }, ... }
 * 4. Hono OpenAPI errors: { success: false, error: { issues: [...] } }
 *
 * Priority order for extraction:
 * 1. context.issues[0].message (wrapped validation errors)
 * 2. issues[0].message (direct validation errors)
 * 3. error.issues[0].message (Hono OpenAPI validation errors)
 * 4. error (some routes use this as a string)
 * 5. message (standard field)
 * 6. Fallback message
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
    endpoint?: string;
    method?: string;
}

/** DextoValidationError response shape */
export interface DextoValidationErrorResponse {
    name: 'DextoValidationError';
    message: string;
    issues: DextoIssue[];
    traceId: string;
    errorCount: number;
    warningCount: number;
    endpoint?: string;
    method?: string;
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
    const runtimeError = errorData as Partial<DextoRuntimeErrorResponse>;
    if (runtimeError.context?.issues && Array.isArray(runtimeError.context.issues)) {
        const firstIssue = runtimeError.context.issues[0];
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

    // Priority 3: Check for Hono OpenAPI validation errors (error.issues[0].message)
    // Hono's Zod validation returns { success: false, error: { issues: [...] } }
    const honoError = (errorData as any).error;
    if (honoError && typeof honoError === 'object' && Array.isArray(honoError.issues)) {
        const firstIssue = honoError.issues[0];
        if (firstIssue?.message) {
            return firstIssue.message;
        }
    }

    // Priority 4: Check for generic error field as string (some routes use this)
    if (typeof honoError === 'string' && honoError.length > 0) {
        return honoError;
    }

    // Priority 5: Check for message field (standard field on all error types)
    if (typeof errorData.message === 'string' && errorData.message.length > 0) {
        return errorData.message;
    }

    // Priority 6: Fallback
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
    endpoint?: string;
    method?: string;
} {
    const code = (errorData as DextoRuntimeErrorResponse).code;
    const scope = (errorData as DextoRuntimeErrorResponse).scope;
    const type = (errorData as DextoRuntimeErrorResponse).type;
    const traceId = (errorData as DextoRuntimeErrorResponse | DextoValidationErrorResponse).traceId;
    const recovery = (errorData as DextoRuntimeErrorResponse).recovery;
    const endpoint = (errorData as DextoRuntimeErrorResponse | DextoValidationErrorResponse)
        .endpoint;
    const method = (errorData as DextoRuntimeErrorResponse | DextoValidationErrorResponse).method;

    // Get issues from either wrapped or direct validation errors or Hono OpenAPI errors
    let issues: DextoIssue[] | undefined;
    const runtimeErr = errorData as Partial<DextoRuntimeErrorResponse>;
    if (runtimeErr.context?.issues) {
        issues = runtimeErr.context.issues;
    } else if ((errorData as DextoValidationErrorResponse).issues) {
        issues = (errorData as DextoValidationErrorResponse).issues;
    } else if ((errorData as any).error?.issues) {
        // Handle Hono OpenAPI validation errors
        issues = (errorData as any).error.issues;
    }

    return {
        message: extractErrorMessage(errorData, 'An error occurred'),
        code,
        scope,
        type,
        traceId,
        recovery,
        issues,
        endpoint,
        method,
    };
}
