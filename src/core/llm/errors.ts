import { DextoError } from '../error/DextoError.js';
import { ErrorScope } from '@core/error/types.js';
import { ErrorType } from '../error/types.js';
import { LLMErrorCode } from './error-codes.js';
import type { Issue } from '@core/error/types.js';
import type { LLMProvider } from './registry.js';

/**
 * LLM error factory methods
 * Creates properly typed errors for LLM operations
 */
export class LLMError {
    // API Key errors
    static missingApiKey(provider: LLMProvider, envVar: string) {
        return new DextoError(
            LLMErrorCode.API_KEY_MISSING,
            ErrorScope.LLM,
            ErrorType.USER,
            `Missing API key for provider '${provider}' – set ${envVar} or pass --api-key`,
            {
                details: { provider, envVar },
                recovery: `Set the environment variable ${envVar} with your API key`,
            }
        );
    }

    static invalidApiKey(provider: LLMProvider, reason: string) {
        return new DextoError(
            LLMErrorCode.API_KEY_INVALID,
            ErrorScope.LLM,
            ErrorType.USER,
            `Invalid API key for provider '${provider}': ${reason}`,
            { details: { provider, reason } }
        );
    }

    // Base URL errors
    static missingBaseUrl(provider: LLMProvider) {
        return new DextoError(
            LLMErrorCode.BASE_URL_MISSING,
            ErrorScope.LLM,
            ErrorType.USER,
            `Provider '${provider}' requires a 'baseURL'`,
            { details: { provider } }
        );
    }

    static invalidBaseUrl(provider: LLMProvider, url: string) {
        return new DextoError(
            LLMErrorCode.BASE_URL_INVALID,
            ErrorScope.LLM,
            ErrorType.USER,
            `Invalid base URL for provider '${provider}': ${url}`,
            { details: { provider, url } }
        );
    }

    // Model/Provider errors
    static incompatibleModel(provider: LLMProvider, model: string, supportedModels: string[]) {
        return new DextoError(
            LLMErrorCode.MODEL_INCOMPATIBLE,
            ErrorScope.LLM,
            ErrorType.USER,
            `Model '${model}' is not supported for provider '${provider}'. Supported: ${supportedModels.join(', ')}`,
            { details: { provider, model, supportedModels } }
        );
    }

    static unknownModel(provider: LLMProvider, model: string) {
        return new DextoError(
            LLMErrorCode.MODEL_UNKNOWN,
            ErrorScope.LLM,
            ErrorType.USER,
            `Unknown model '${model}' for provider '${provider}'`,
            { details: { provider, model } }
        );
    }

    static unsupportedProvider(provider: string, availableProviders: LLMProvider[]) {
        return new DextoError(
            LLMErrorCode.PROVIDER_UNSUPPORTED,
            ErrorScope.LLM,
            ErrorType.USER,
            `Provider '${provider}' not supported. Available: ${availableProviders.join(', ')}`,
            { details: { provider, availableProviders } }
        );
    }

    static unsupportedRouter(router: string, provider: LLMProvider, supportedRouters: string[]) {
        return new DextoError(
            LLMErrorCode.ROUTER_UNSUPPORTED,
            ErrorScope.LLM,
            ErrorType.USER,
            `Router '${router}' not supported for provider '${provider}'. Supported: ${supportedRouters.join(', ')}`,
            { details: { router, provider, supportedRouters } }
        );
    }

    // Input validation
    static fileUnsupported(
        fileName: string,
        fileType: string,
        provider: LLMProvider,
        model?: string
    ) {
        return new DextoError(
            LLMErrorCode.INPUT_FILE_UNSUPPORTED,
            ErrorScope.LLM,
            ErrorType.USER,
            `File type '${fileType}' not supported by ${provider}/${model || 'current model'}`,
            {
                details: { fileName, fileType, provider, model },
                recovery: 'Use a supported file type or different model',
            }
        );
    }

    static imageUnsupported(provider: LLMProvider, model?: string) {
        return new DextoError(
            LLMErrorCode.INPUT_IMAGE_UNSUPPORTED,
            ErrorScope.LLM,
            ErrorType.USER,
            `Images not supported by ${provider}/${model || 'current model'}`,
            {
                details: { provider, model },
                recovery: 'Use a model that supports vision capabilities',
            }
        );
    }

    // Limits
    static tokensExceeded(actual: number, max: number, model: string) {
        return new DextoError(
            LLMErrorCode.TOKENS_EXCEEDED,
            ErrorScope.LLM,
            ErrorType.USER,
            `Max input tokens for model '${model}' is ${max}. You provided ${actual}`,
            { details: { actual, max, model } }
        );
    }

    static rateLimitExceeded(provider: LLMProvider, retryAfter?: number) {
        return new DextoError(
            LLMErrorCode.RATE_LIMIT_EXCEEDED,
            ErrorScope.LLM,
            ErrorType.RATE_LIMIT,
            `Rate limit exceeded for ${provider}`,
            {
                details: { provider, retryAfter },
                recovery: retryAfter
                    ? `Wait ${retryAfter} seconds before retrying`
                    : 'Wait before retrying or upgrade your plan',
            }
        );
    }

    // Operations
    static switchFailed(issues: Issue[]) {
        return new DextoError(
            LLMErrorCode.SWITCH_FAILED,
            ErrorScope.LLM,
            ErrorType.USER,
            'LLM switch failed due to validation errors',
            { issues }
        );
    }

    static generationFailed(error: string, provider: LLMProvider, model: string) {
        return new DextoError(
            LLMErrorCode.GENERATION_FAILED,
            ErrorScope.LLM,
            ErrorType.THIRD_PARTY,
            `Generation failed: ${error}`,
            { details: { error, provider, model } }
        );
    }

    // Validation
    static inputValidationFailed(issues: Issue[]) {
        const primaryIssue = issues[0];
        return new DextoError(
            primaryIssue?.code || LLMErrorCode.REQUEST_INVALID_SCHEMA,
            ErrorScope.LLM,
            ErrorType.USER,
            primaryIssue?.message || 'Input validation failed',
            { issues }
        );
    }
}

// Legacy error classes for backward compatibility (to be deprecated)
export class UnknownProviderError extends Error {
    constructor(provider: string, availableProviders?: string[]) {
        const message = availableProviders
            ? `Provider '${provider}' not found. Available providers: ${availableProviders.join(', ')}`
            : `Provider '${provider}' not found`;

        super(message);
        this.name = 'UnknownProviderError';
    }
}

export class UnknownModelError extends Error {
    constructor(provider: string, model: string, availableModels?: string[]) {
        const message = availableModels
            ? `Model '${model}' not found in provider '${provider}'. Available models: ${availableModels.join(', ')}`
            : `Model '${model}' not found in provider '${provider}'`;

        super(message);
        this.name = 'UnknownModelError';
    }
}

export class CantInferProviderError extends Error {
    constructor(model: string) {
        super(`Unrecognized model '${model}'. Could not infer provider.`);
        this.name = 'CantInferProviderError';
    }
}

export class EffectiveMaxInputTokensError extends Error {
    constructor(provider: LLMProvider, model: string) {
        super(
            `Could not determine effective maxInputTokens for ${provider}/${model}. ` +
                `'maxInputTokens' was not provided in config, and the model was not found in the registry.`
        );
        this.name = 'EffectiveMaxInputTokensError';
    }
}
