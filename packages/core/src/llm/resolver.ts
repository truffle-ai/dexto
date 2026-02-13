import { Result, hasErrors, splitIssues, ok, fail, zodToIssues } from '../utils/result.js';
import { Issue, ErrorScope, ErrorType } from '../errors/types.js';
import { LLMErrorCode } from './error-codes.js';

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
} from './registry/index.js';
import {
    lookupOpenRouterModel,
    refreshOpenRouterModelCache,
} from './providers/openrouter-model-registry.js';
import type { LLMUpdateContext } from './types.js';
import { resolveApiKeyForProvider } from '../utils/api-key-resolver.js';
import type { IDextoLogger } from '../logger/v2/types.js';

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
    const result = validateLLMConfig(candidate, warnings, logger);
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

    // Provider inference (if not provided, infer from native model IDs or fall back to previous provider)
    const provider =
        updates.provider ??
        (updates.model && !updates.model.includes('/')
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

    // Gateway providers require OpenRouter-format IDs.
    // If the user is switching providers (but not explicitly setting a model),
    // pick the gateway's default model to avoid surprising validation errors.
    if (
        provider !== previous.provider &&
        updates.model == null &&
        hasAllRegistryModelsSupport(provider) &&
        !model.includes('/')
    ) {
        const defaultGatewayModel = getDefaultModelForProvider(provider);
        if (defaultGatewayModel) {
            model = defaultGatewayModel;
            warnings.push({
                code: LLMErrorCode.MODEL_INCOMPATIBLE,
                message: `Model set to default '${model}' for provider '${provider}'`,
                severity: 'warning',
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
                context: { provider, model },
            });
        }
    }

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
            maxInputTokens: updates.maxInputTokens,
            maxOutputTokens: updates.maxOutputTokens ?? previous.maxOutputTokens,
            temperature: updates.temperature ?? previous.temperature,
        },
        warnings,
    };
}

// Passes the input candidate through the schema and returns a result
export function validateLLMConfig(
    candidate: LLMConfig,
    warnings: Issue<LLMUpdateContext>[],
    logger: IDextoLogger
): Result<ValidatedLLMConfig, LLMUpdateContext> {
    // Final validation (business rules + shape)
    const parsed = LLMConfigSchema.safeParse(candidate);
    if (!parsed.success) {
        return fail<ValidatedLLMConfig, LLMUpdateContext>(zodToIssues(parsed.error, 'error'));
    }

    // Token defaults: always use model's effective max unless explicitly provided.
    const maxInputTokens =
        parsed.data.maxInputTokens ??
        getEffectiveMaxInputTokens(
            {
                provider: parsed.data.provider,
                model: parsed.data.model,
                apiKey: parsed.data.apiKey ?? candidate.apiKey ?? '',
                baseURL: parsed.data.baseURL,
            },
            logger
        );

    // Note: Credentials (apiKey/baseURL) are validated at runtime when creating provider clients.

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

    return ok<ValidatedLLMConfig, LLMUpdateContext>({ ...parsed.data, maxInputTokens }, warnings);
}
