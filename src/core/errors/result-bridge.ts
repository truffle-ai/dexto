import type { Result } from '../utils/result.js';
import type { Issue } from './types.js';
import { DextoError } from './DextoError.js';
import { ErrorScope, ErrorType } from './types.js';

/**
 * Default error factory that creates a DextoError from the primary issue
 */
function defaultErrorFactory<C>(issues: Issue<C>[]): DextoError {
    // Find primary issue (first error, or first issue if no errors)
    const primaryIssue = issues.find((i) => i.severity === 'error') || issues[0];

    if (!primaryIssue) {
        // No issues provided - shouldn't happen but handle gracefully
        return new DextoError(
            'unknown_error' as any,
            ErrorScope.AGENT,
            ErrorType.UNKNOWN,
            'Operation failed'
        );
    }

    return new DextoError(
        primaryIssue.code,
        primaryIssue.scope,
        primaryIssue.type,
        primaryIssue.message,
        primaryIssue.context
    );
}

/**
 * Bridge function to convert Result pattern to exceptions
 * Used at public API boundaries to throw properly typed errors
 *
 * @param result - The Result to check
 * @param errorFactory - Optional factory function to create the error (defaults to creating DextoError from primary issue)
 * @returns The data if successful
 * @throws DextoError if the result contains errors
 *
 * @example
 * ```typescript
 * // Using default factory
 * const result = validateInputForLLM(input, config);
 * const data = ensureOk(result);
 *
 * // Using custom factory
 * const data = ensureOk(result, (issues) =>
 *   new CustomError('Validation failed', issues)
 * );
 * ```
 */
export function ensureOk<T, C>(
    result: Result<T, C>,
    errorFactory: (issues: Issue<C>[]) => Error = defaultErrorFactory
): T {
    if (result.ok) {
        return result.data;
    }

    throw errorFactory(result.issues);
}
