import type { Result } from '../utils/result.js';
import type { Issue } from './types.js';
import type { DextoError } from './DextoError.js';

/**
 * Bridge function to convert Result pattern to exceptions
 * Used at public API boundaries to throw properly typed errors
 *
 * @param result - The Result to check
 * @param errorFactory - Factory function to create the appropriate error
 * @returns The data if successful
 * @throws DextoError if the result contains errors
 *
 * @example
 * ```typescript
 * const result = validateInputForLLM(input, config);
 * ensureOk(result, (issues) =>
 *   LLMError.inputValidationFailed(issues)
 * );
 * ```
 */
export function ensureOk<T, C>(
    result: Result<T, C>,
    errorFactory: (issues: Issue<C>[]) => DextoError
): T {
    if (result.ok) {
        return result.data;
    }
    throw errorFactory(result.issues);
}
