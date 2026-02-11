// schemas/helpers.ts
import { z, type ZodError } from 'zod';
import type { DextoErrorCode, Issue } from '../errors/types.js';
import { ErrorScope, ErrorType } from '../errors/types.js';

/** Trim and require non-empty after trim */
export const NonEmptyTrimmed = z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: 'Required' });

/** Simple URL check (so we don’t need preprocess JUST to trim before .url()) */
function isValidUrl(s: string): boolean {
    try {
        // Allow only http/https (adjust if you want more)
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

export const OptionalURL = z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s === '' || isValidUrl(s), { message: 'Invalid URL' })
    .transform((s) => (s === '' ? undefined : s))
    .optional();

// Expand $VAR and ${VAR} using the provided env, then trim.
export const EnvExpandedString = (env?: Record<string, string | undefined>) =>
    z.string().transform((input) => {
        if (typeof input !== 'string') return '';
        // Use current process.env if no env provided (reads fresh each time)
        const envToUse = env ?? process.env;
        const out = input.replace(
            /\$([A-Z_][A-Z0-9_]*)|\${([A-Z_][A-Z0-9_]*)}/gi,
            (_, a, b) => envToUse[a || b] ?? ''
        );
        return out.trim();
    });

// Zod type for non-empty environment expanded string
export const NonEmptyEnvExpandedString = (env?: Record<string, string | undefined>) =>
    EnvExpandedString(env).refine((s) => s.length > 0, {
        message: 'Value is required',
    });

// Zod type for URL that could be pulled from env variables
export const RequiredEnvURL = (env?: Record<string, string | undefined>) =>
    EnvExpandedString(env).refine(
        (s) => {
            try {
                const u = new URL(s);
                return u.protocol === 'http:' || u.protocol === 'https:';
            } catch {
                return false;
            }
        },
        { message: 'Invalid URL' }
    );

/**
 * A discriminated union result type that can be either successful or failed
 * Provides type safety by ensuring data is only available on success
 * @param T - The type of the data on success
 * @param C - The type of the context for issues
 */
export type Result<T, C = unknown> =
    | { ok: true; data: T; issues: Issue<C>[] }
    | { ok: false; issues: Issue<C>[] };

/**
 * Create a successful result with validated data and optional warnings.
 *
 * **Usage Guidelines:**
 * - Use for operations that completed successfully, even with warnings
 * - Include warnings for non-blocking issues (API key too short, fallback model used, etc.)
 * - DextoAgent methods should prefer this over throwing exceptions
 * - API layer maps this to 2xx status codes
 *
 * @param data - The successfully validated/processed data
 * @param issues - Optional warnings or informational issues (defaults to empty array)
 * @returns A successful Result with ok: true
 *
 * @example
 * ```typescript
 * // Success with no warnings
 * return ok(validatedConfig);
 *
 * // Success with warnings
 * return ok(validatedConfig, [
 *   { code: 'llm_short_api_key', message: 'API key seems short', severity: 'warning', context: {} }
 * ]);
 * ```
 */
export const ok = <T, C = unknown>(data: T, issues: Issue<C>[] = []): Result<T, C> => ({
    ok: true,
    data,
    issues, // warnings live alongside errors here
});

/**
 * Create a failed result with blocking errors that prevent operation completion.
 *
 * **Usage Guidelines:**
 * - Use for validation failures, business rule violations, or any error that should stop execution
 * - Do NOT mix with exceptions - choose Result pattern OR throwing, not both
 * - API layer maps this to 4xx status codes (user/validation errors)
 * - Issues should have severity: 'error' for blocking problems
 *
 * @param issues - Array of error issues that caused the failure (must not be empty)
 * @returns A failed Result with ok: false and no data
 *
 * @example
 * ```typescript
 * // Validation failure
 * return fail([
 *   {
 *     code: LLMErrorCode.SWITCH_INPUT_MISSING,
 *     message: 'At least model or provider must be specified',
 *     severity: 'error',
 *     context: {}
 *   }
 * ]);
 *
 * // Multiple validation errors
 * return fail([
 *   { code: 'missing_api_key', message: 'API key required', severity: 'error', context: {} },
 *   { code: 'invalid_model', message: 'Model not supported', severity: 'error', context: {} }
 * ]);
 * ```
 */
export const fail = <T = never, C = unknown>(issues: Issue<C>[]): Result<T, C> => ({
    ok: false,
    issues,
});

/**
 * Check if a list of issues contains any blocking errors (non-warning severity).
 *
 * **Usage Guidelines:**
 * - Use to determine if a Result should be ok: false
 * - Warnings don't count as errors - operations can succeed with warnings
 * - Useful in validation functions to decide success vs failure
 *
 * @param issues - Array of issues to check
 * @returns true if any issue has severity other than 'warning', false otherwise
 *
 * @example
 * ```typescript
 * const issues = [
 *   { severity: 'warning', message: 'API key seems short' },
 *   { severity: 'error', message: 'Model not found' }
 * ];
 *
 * if (hasErrors(issues)) {
 *   return fail(issues); // Contains errors, operation fails
 * } else {
 *   return ok(data, issues); // Only warnings, operation succeeds
 * }
 * ```
 */
export function hasErrors<C>(issues: Issue<C>[]) {
    return issues.some((i) => i.severity !== 'warning');
}

/**
 * Separate issues into errors (blocking) and warnings (non-blocking) for different handling.
 *
 * **Usage Guidelines:**
 * - Use when you need to handle errors and warnings differently
 * - Errors should block operation, warnings should be logged/reported but allow success
 * - Useful in API responses to show both what failed and what succeeded with caveats
 *
 * @param issues - Array of mixed issues to categorize
 * @returns Object with separate arrays for errors and warnings
 *
 * @example
 * ```typescript
 * const { errors, warnings } = splitIssues(allIssues);
 *
 * if (errors.length > 0) {
 *   logger.error('Validation failed:', errors);
 *   return fail(errors);
 * }
 *
 * if (warnings.length > 0) {
 *   logger.warn('Validation succeeded with warnings:', warnings);
 * }
 *
 * return ok(data, warnings);
 * ```
 */
export function splitIssues<C>(issues: Issue<C>[]) {
    return {
        errors: issues.filter((i) => i.severity !== 'warning'),
        warnings: issues.filter((i) => i.severity === 'warning'),
    };
}

/**
 * Convert Zod validation errors to standardized Issue format for Result pattern.
 *
 * **Usage Guidelines:**
 * - Use in schema validation functions to convert Zod errors to our Issue format
 * - Allows custom error codes via Zod's params.code field in custom refinements
 * - Falls back to SCHEMA_VALIDATION code for standard Zod validation errors
 * - Typically used with severity: 'error' for blocking validation failures
 *
 * @param err - ZodError from failed schema validation
 * @param severity - Issue severity level (defaults to 'error')
 * @returns Array of Issues in our standardized format
 *
 * @example
 * ```typescript
 * // In a validation function
 * const result = MySchema.safeParse(data);
 * if (!result.success) {
 *   const issues = zodToIssues(result.error);
 *   return fail(issues);
 * }
 *
 * // Custom error codes in Zod schema
 * const schema = z.string().refine(val => val.length > 0, {
 *   message: 'Field is required',
 *   params: { code: LLMErrorCode.API_KEY_MISSING }
 * });
 * ```
 */
export function zodToIssues<C = unknown>(
    err: ZodError,
    severity: 'error' | 'warning' = 'error'
): Issue<C>[] {
    const issues: Issue<C>[] = [];

    for (const e of err.errors) {
        // Handle invalid_union errors by extracting the actual validation errors from unionErrors
        if (e.code === 'invalid_union' && (e as any).unionErrors) {
            const unionErrors = (e as any).unionErrors as ZodError[];
            // Iterate through ALL union errors to capture validation issues from every union branch
            let hasCollectedErrors = false;
            for (const unionError of unionErrors) {
                if (unionError && unionError.errors && unionError.errors.length > 0) {
                    // Recursively process each union branch's errors
                    issues.push(...zodToIssues<C>(unionError, severity));
                    hasCollectedErrors = true;
                }
            }

            // Fallback: if no union errors were collected, report the invalid_union error itself
            if (!hasCollectedErrors) {
                const params = (e as any).params || {};
                issues.push({
                    code: (params.code ?? 'schema_validation') as DextoErrorCode,
                    message: e.message,
                    scope: params.scope ?? ErrorScope.AGENT,
                    type: params.type ?? ErrorType.USER,
                    path: e.path,
                    severity,
                    context: params as C,
                });
            }
        } else {
            // Standard error processing
            const params = (e as any).params || {};
            issues.push({
                code: (params.code ?? 'schema_validation') as DextoErrorCode,
                message: e.message,
                scope: params.scope ?? ErrorScope.AGENT,
                type: params.type ?? ErrorType.USER,
                path: e.path,
                severity,
                context: params as C,
            });
        }
    }

    return issues;
}
