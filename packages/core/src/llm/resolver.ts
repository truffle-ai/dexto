import { Result, hasErrors, splitIssues, ok, fail, zodToIssues } from '../utils/result.js';
import { Issue, ErrorScope, ErrorType } from '@core/errors/types.js';
import { LLMErrorCode } from './error-codes.js';

import { type ValidatedLLMConfig, type LLMUpdates, type LLMConfig } from './schemas.js';
import { LLMConfigSchema } from './schemas.js';
import {
    getDefaultModelForProvider,
    acceptsAnyModel,
    getProviderFromModel,
    isValidProviderModel,
    getEffectiveMaxInputTokens,
} from './registry.js';
import type { LLMUpdateContext } from './types.js';
import { resolveApiKeyForProvider } from '@core/utils/api-key-resolver.js';
import type { IDextoLogger } from '@core/logger/v2/types.js';

/**
 * Convenience function that combines resolveLLM and validateLLM
 */
export function resolveAndValidateLLMConfig(
    previous: ValidatedLLMConfig,
    updates: LLMUpdates,
    logger: IDextoLogger
): Result<ValidatedLLMConfig, LLMUpdateContext> {
    const { candidate, warnings } = resolveLLMConfig(previous, updates, logger);

    // If resolver produced any errors, fail immediately (don’t try to validate a broken candidate)
    if (hasErrors(warnings)) {
        const { errors } = splitIssues(warnings);
        return fail<ValidatedLLMConfig, LLMUpdateContext>(errors);
    }
    const result = validateLLMConfig(candidate, warnings);
    return result;
}

/**
 * Infers the LLM config from the provided updates
 * @param previous - The previous LLM config
 * @param updates - The updates to the LLM config
 * @returns The resolved LLM config
 */
export function resolveLLMConfig(
    previous: ValidatedLLMConfig,
    updates: LLMUpdates,
    logger: IDextoLogger
): { candidate: LLMConfig; warnings: Issue<LLMUpdateContext>[] } {
    const warnings: Issue<LLMUpdateContext>[] = [];

    // Provider inference (if not provided, infer from model or previous provider)
    const provider =
        updates.provider ??
        (updates.model
            ? (() => {
                  try {
                      return getProviderFromModel(updates.model);
                  } catch {
                      return previous.provider;
                  }
              })()
            : previous.provider);

    // API key resolution
    // (if not provided, previous API key if provider is the same)
    // (if not provided, and provider is different, throw error)
    const envKey = resolveApiKeyForProvider(provider);
    const apiKey =
        updates.apiKey ?? (provider !== previous.provider ? envKey : previous.apiKey) ?? '';
    if (!apiKey) {
        warnings.push({
            code: LLMErrorCode.API_KEY_CANDIDATE_MISSING,
            message: 'API key not provided or found in environment',
            severity: 'warning',
            scope: ErrorScope.LLM,
            type: ErrorType.USER,
            context: { provider },
        });
    } else if (typeof apiKey === 'string' && apiKey.length < 10) {
        warnings.push({
            code: LLMErrorCode.API_KEY_INVALID,
            message: 'API key looks unusually short',
            severity: 'warning',
            scope: ErrorScope.LLM,
            type: ErrorType.USER,
            context: { provider },
        });
    }

    // Model fallback
    // if new provider doesn't support the new model, use the default model
    let model = updates.model ?? previous.model;
    if (
        provider !== previous.provider &&
        !acceptsAnyModel(provider) &&
        !isValidProviderModel(provider, model)
    ) {
        model = getDefaultModelForProvider(provider) ?? previous.model;
        warnings.push({
            code: LLMErrorCode.MODEL_INCOMPATIBLE,
            message: `Model set to default '${model}' for provider '${provider}'`,
            severity: 'warning',
            scope: ErrorScope.LLM,
            type: ErrorType.USER,
            context: { provider, model },
        });
    }

    // Token defaults - always use model's effective max unless explicitly provided
    const maxInputTokens =
        updates.maxInputTokens ??
        getEffectiveMaxInputTokens({ provider, model, apiKey: apiKey || previous.apiKey }, logger);

    return {
        candidate: {
            provider,
            model,
            apiKey,
            baseURL: updates.baseURL ?? previous.baseURL,
            maxIterations: updates.maxIterations ?? previous.maxIterations,
            maxInputTokens,
            maxOutputTokens: updates.maxOutputTokens ?? previous.maxOutputTokens,
            temperature: updates.temperature ?? previous.temperature,
        },
        warnings,
    };
}

// Passes the input candidate through the schema and returns a result
export function validateLLMConfig(
    candidate: LLMConfig,
    warnings: Issue<LLMUpdateContext>[]
): Result<ValidatedLLMConfig, LLMUpdateContext> {
    // Final validation (business rules + shape)
    const parsed = LLMConfigSchema.safeParse(candidate);
    if (!parsed.success) {
        return fail<ValidatedLLMConfig, LLMUpdateContext>(zodToIssues(parsed.error, 'error'));
    }

    // Schema validation now handles apiKey non-empty validation

    // Check for short API key (warning)
    if (parsed.data.apiKey && parsed.data.apiKey.length < 10) {
        warnings.push({
            code: LLMErrorCode.API_KEY_INVALID,
            message: 'API key seems too short - please verify it is correct',
            path: ['apiKey'],
            severity: 'warning',
            scope: ErrorScope.LLM,
            type: ErrorType.USER,
            context: {
                provider: candidate.provider,
                model: candidate.model,
            },
        });
    }

    return ok<ValidatedLLMConfig, LLMUpdateContext>(parsed.data, warnings);
}
