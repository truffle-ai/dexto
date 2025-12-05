import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ErrorScope } from '@core/errors/types.js';
import { ErrorType } from '../errors/types.js';
import { LLMErrorCode } from './error-codes.js';
// Use types solely from types.ts to avoid duplication
import { getSupportedProviders } from './registry.js';
import type { LLMProvider } from './types.js';

/**
 * LLM runtime error factory methods
 * Creates properly typed errors for LLM runtime operations
 *
 * Note: Validation errors (missing API keys, invalid models, etc.) are handled
 * by DextoValidationError through Zod schema validation
 */
export class LLMError {
    // Runtime model/provider lookup errors
    static unknownModel(provider: LLMProvider, model: string) {
        return new DextoRuntimeError(
            LLMErrorCode.MODEL_UNKNOWN,
            ErrorScope.LLM,
            ErrorType.USER,
            `Unknown model '${model}' for provider '${provider}'`,
            { provider, model }
        );
    }

    static baseUrlMissing(provider: LLMProvider) {
        return new DextoRuntimeError(
            LLMErrorCode.BASE_URL_MISSING,
            ErrorScope.LLM,
            ErrorType.USER,
            `Provider '${provider}' requires a baseURL (set config.baseURL or OPENAI_BASE_URL environment variable)`,
            { provider }
        );
    }

    static unsupportedProvider(provider: string) {
        const availableProviders = getSupportedProviders();
        return new DextoRuntimeError(
            LLMErrorCode.PROVIDER_UNSUPPORTED,
            ErrorScope.LLM,
            ErrorType.USER,
            `Provider '${provider}' is not supported. Available providers: ${availableProviders.join(', ')}`,
            { provider, availableProviders }
        );
    }

    static modelProviderUnknown(model: string) {
        const availableProviders = getSupportedProviders();
        return new DextoRuntimeError(
            LLMErrorCode.MODEL_UNKNOWN,
            ErrorScope.LLM,
            ErrorType.USER,
            `Unknown model '${model}' - could not infer provider. Available providers: ${availableProviders.join(', ')}`,
            { model, availableProviders },
            'Specify the provider explicitly or use a recognized model name'
        );
    }

    // Runtime service errors

    static rateLimitExceeded(provider: LLMProvider, retryAfter?: number) {
        return new DextoRuntimeError(
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

    // Runtime operation errors
    static generationFailed(error: string, provider: LLMProvider, model: string) {
        return new DextoRuntimeError(
            LLMErrorCode.GENERATION_FAILED,
            ErrorScope.LLM,
            ErrorType.THIRD_PARTY,
            `Generation failed: ${error}`,
            { details: { error, provider, model } }
        );
    }

    // Switch operation errors (runtime checks not covered by Zod)
    static switchInputMissing() {
        return new DextoRuntimeError(
            LLMErrorCode.SWITCH_INPUT_MISSING,
            ErrorScope.LLM,
            ErrorType.USER,
            'At least model or provider must be specified for LLM switch',
            {},
            'Provide either a model name, provider, or both'
        );
    }
}
