import { Result, hasErrors, splitIssues, ok, fail, zodToIssues } from '../utils/result.js';
import { Issue, ErrorScope, ErrorType } from '@core/errors/types.js';
import { LLMErrorCode } from './error-codes.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';

import { type ValidatedLLMConfig, type LLMUpdates, type LLMConfig } from './schemas.js';
import { LLMConfigSchema } from './schemas.js';
import {
    getDefaultModelForProvider,
    acceptsAnyModel,
    getProviderFromModel,
    isValidProviderModel,
    getEffectiveMaxInputTokens,
    supportsBaseURL,
    supportsCustomModels,
    hasAllRegistryModelsSupport,
    transformModelNameForProvider,
} from './registry/index.js';
import {
    lookupOpenRouterModel,
    refreshOpenRouterModelCache,
} from './providers/openrouter-model-registry.js';
import type { LLMUpdateContext } from './types.js';
import { resolveApiKeyForProvider } from '@core/utils/api-key-resolver.js';
import type { IDextoLogger } from '@core/logger/v2/types.js';

// TODO: Consider consolidating validation into async Zod schema (superRefine supports async).
// Currently OpenRouter validation is here to avoid network calls during startup/serverless.
// If startup validation is desired, move to schema with safeParseAsync() and handle serverless separately.

/**
 * Convenience function that combines resolveLLM and validateLLM
 */
export async function resolveAndValidateLLMConfig(
    previous: ValidatedLLMConfig,
    updates: LLMUpdates,
    logger: IDextoLogger
): Promise<Result<ValidatedLLMConfig, LLMUpdateContext>> {
    const { candidate, warnings } = await resolveLLMConfig(previous, updates, logger);

    // If resolver produced any errors, fail immediately (don't try to validate a broken candidate)
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
export async function resolveLLMConfig(
    previous: ValidatedLLMConfig,
    updates: LLMUpdates,
    logger: IDextoLogger
): Promise<{ candidate: LLMConfig; warnings: Issue<LLMUpdateContext>[] }> {
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
    // Skip fallback for providers that support custom models (they allow arbitrary model IDs)
    let model = updates.model ?? previous.model;
    if (
        provider !== previous.provider &&
        !acceptsAnyModel(provider) &&
        !supportsCustomModels(provider) &&
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

    // Gateway model transformation
    // When targeting a gateway provider (dexto/openrouter), transform native model names
    // to OpenRouter format (e.g., "claude-sonnet-4-5-20250929" -> "anthropic/claude-sonnet-4.5")
    if (hasAllRegistryModelsSupport(provider) && !model.includes('/')) {
        try {
            const originalProvider = getProviderFromModel(model);
            model = transformModelNameForProvider(model, originalProvider, provider);
            logger.debug(
                `Transformed model for ${provider}: ${updates.model ?? previous.model} -> ${model}`
            );
        } catch (error: unknown) {
            if (error instanceof DextoRuntimeError) {
                // If the model is known but missing an OpenRouter mapping, fail loudly.
                // Passing through an un-prefixed model to a gateway provider will almost certainly break.
                if (error.code === LLMErrorCode.MODEL_OPENROUTER_MAPPING_MISSING) {
                    warnings.push({
                        code: error.code,
                        message: error.message,
                        severity: 'error',
                        scope: ErrorScope.LLM,
                        type: ErrorType.SYSTEM,
                        context: { provider, model },
                    });
                }
            }
            // Model not in registry - pass through as-is, gateway may accept custom model IDs
            logger.debug(
                `Model '${model}' not in registry, passing through to ${provider} without transformation`
            );
        }
    }

    // Token defaults - always use model's effective max unless explicitly provided
    const maxInputTokens =
        updates.maxInputTokens ??
        getEffectiveMaxInputTokens({ provider, model, apiKey: apiKey || previous.apiKey }, logger);

    // BaseURL resolution
    // Note: OpenRouter baseURL is handled by the factory (fixed endpoint, no user override)
    let baseURL: string | undefined;
    if (updates.baseURL) {
        baseURL = updates.baseURL;
    } else if (supportsBaseURL(provider)) {
        baseURL = previous.baseURL;
    } else {
        baseURL = undefined;
    }

    // Vertex AI validation - requires GOOGLE_VERTEX_PROJECT for ADC authentication
    // This upfront check provides immediate feedback rather than failing at first API call
    if (provider === 'vertex') {
        const projectId = process.env.GOOGLE_VERTEX_PROJECT;
        if (!projectId || !projectId.trim()) {
            warnings.push({
                code: LLMErrorCode.CONFIG_MISSING,
                message:
                    'GOOGLE_VERTEX_PROJECT environment variable is required for Vertex AI. ' +
                    'Set it to your GCP project ID and ensure ADC is configured via `gcloud auth application-default login`',
                severity: 'error',
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
                context: { provider, model },
            });
        }
    }

    // Amazon Bedrock validation - requires AWS_REGION for the endpoint URL
    // Auth can be either:
    // 1. AWS_BEARER_TOKEN_BEDROCK (API key - simplest)
    // 2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (IAM credentials)
    if (provider === 'bedrock') {
        const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
        if (!region || !region.trim()) {
            warnings.push({
                code: LLMErrorCode.CONFIG_MISSING,
                message:
                    'AWS_REGION environment variable is required for Amazon Bedrock. ' +
                    'Also set either AWS_BEARER_TOKEN_BEDROCK (API key) or ' +
                    'AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (IAM credentials).',
                severity: 'error',
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
                context: { provider, model },
            });
        }
    }

    // OpenRouter model validation with cache refresh
    if (provider === 'openrouter') {
        let lookupStatus = lookupOpenRouterModel(model);

        if (lookupStatus === 'unknown') {
            // Cache stale/empty - try to refresh before validating
            try {
                await refreshOpenRouterModelCache({ apiKey });
                lookupStatus = lookupOpenRouterModel(model);
            } catch {
                // Network failed - keep 'unknown' status, allow gracefully
                logger.debug(
                    `OpenRouter model cache refresh failed, allowing model '${model}' without validation`
                );
            }
        }

        if (lookupStatus === 'invalid') {
            // Model definitively not found in fresh cache - this is an error
            warnings.push({
                code: LLMErrorCode.MODEL_INCOMPATIBLE,
                message: `Model '${model}' not found in OpenRouter catalog. Check model ID at https://openrouter.ai/models`,
                severity: 'error',
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
                context: { provider, model },
            });
        }
        // 'unknown' after failed refresh = allow (network issue, graceful degradation)
    }

    return {
        candidate: {
            provider,
            model,
            apiKey,
            baseURL,
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
