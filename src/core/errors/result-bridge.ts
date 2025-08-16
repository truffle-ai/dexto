import type { Result } from '../utils/result.js';
import { DextoValidationError } from './DextoValidationError.js';

/**
 * Bridge function to convert Result pattern to validation exceptions
 * Used at public API boundaries for validation flows
 *
 * Note: Runtime errors are thrown directly, not through Result pattern
 *
 * @param result - The Result to check (typically from validation functions)
 * @returns The data if successful
 * @throws DextoValidationError if the result contains validation issues
 *
 * @example
 * ```typescript
 * // Validation flow
 * const result = validateInputForLLM(input, config);
 * const data = ensureOk(result); // Throws DextoValidationError if validation failed
 *
 * // LLM config validation
 * const configResult = resolveAndValidateLLMConfig(current, updates);
 * const validatedConfig = ensureOk(configResult);
 * ```
 */
export function ensureOk<T, C>(result: Result<T, C>): T {
    if (result.ok) {
        return result.data;
    }

    // Result pattern is used for validation - throw validation error
    throw new DextoValidationError(result.issues);
}
