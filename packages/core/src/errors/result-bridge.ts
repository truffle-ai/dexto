import type { Result } from '../utils/result.js';
import { DextoValidationError } from './DextoValidationError.js';
import type { IDextoLogger } from '../logger/v2/types.js';

/**
 * Bridge function to convert Result pattern to validation exceptions
 * Used at public API boundaries for validation flows
 *
 * Note: Runtime errors are thrown directly, not through Result pattern
 *
 * @param result - The Result to check (typically from validation functions)
 * @param logger - Logger instance for logging errors
 * @returns The data if successful
 * @throws DextoValidationError if the result contains validation issues
 *
 * @example
 * ```typescript
 * // Validation flow
 * const result = validateInputForLLM(input, config);
 * const data = ensureOk(result, logger); // Throws DextoValidationError if validation failed
 *
 * // LLM config validation
 * const configResult = resolveAndValidateLLMConfig(current, updates);
 * const validatedConfig = ensureOk(configResult, logger);
 * ```
 */
export function ensureOk<T, C>(result: Result<T, C>, logger: IDextoLogger): T {
    if (result.ok) {
        return result.data;
    }

    const issueMessages = result.issues.map((i) => i.message).join('; ');
    logger.error(`ensureOk: validation failed - ${issueMessages}`);
    // Result pattern is used for validation - throw validation error
    throw new DextoValidationError(result.issues);
}
