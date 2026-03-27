import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { LLMErrorCode } from './error-codes.js';
// Use types solely from types.ts to avoid duplication
import { getSupportedProviders } from './registry/index.js';
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
            'llm',
            'user',
            `Unknown model '${model}' for provider '${provider}'`,
            { provider, model }
        );
    }

    static baseUrlMissing(provider: LLMProvider) {
        return new DextoRuntimeError(
            LLMErrorCode.BASE_URL_MISSING,
            'llm',
            'user',
            `Provider '${provider}' requires a baseURL (set config.baseURL or OPENAI_BASE_URL environment variable)`,
            { provider }
        );
    }

    static missingConfig(provider: LLMProvider, configName: string) {
        return new DextoRuntimeError(
            LLMErrorCode.CONFIG_MISSING,
            'llm',
            'user',
            `Provider '${provider}' requires ${configName}`,
            { provider, configName }
        );
    }

    static unsupportedProvider(provider: string) {
        const availableProviders = getSupportedProviders();
        return new DextoRuntimeError(
            LLMErrorCode.PROVIDER_UNSUPPORTED,
            'llm',
            'user',
            `Provider '${provider}' is not supported. Available providers: ${availableProviders.join(', ')}`,
            { provider, availableProviders }
        );
    }

    /**
     * Runtime error when API key is missing for a provider that requires it.
     * This occurs when relaxed validation allowed the app to start without an API key,
     * and the user then tries to use the LLM functionality.
     */
    static apiKeyMissing(provider: LLMProvider, envVar: string) {
        return new DextoRuntimeError(
            LLMErrorCode.API_KEY_MISSING,
            'llm',
            'user',
            `API key required for provider '${provider}'`,
            { provider, envVar },
            `Set the ${envVar} environment variable or configure it in Settings`
        );
    }

    static modelProviderUnknown(model: string) {
        const availableProviders = getSupportedProviders();
        return new DextoRuntimeError(
            LLMErrorCode.MODEL_UNKNOWN,
            'llm',
            'user',
            `Unknown model '${model}' - could not infer provider. Available providers: ${availableProviders.join(', ')}`,
            { model, availableProviders },
            'Specify the provider explicitly or use a recognized model name'
        );
    }

    // Runtime service errors

    static rateLimitExceeded(provider: LLMProvider, retryAfter?: number) {
        return new DextoRuntimeError(
            LLMErrorCode.RATE_LIMIT_EXCEEDED,
            'llm',
            'rate_limit',
            `Rate limit exceeded for ${provider}`,
            {
                details: { provider, retryAfter },
                recovery: retryAfter
                    ? `Wait ${retryAfter} seconds before retrying`
                    : 'Wait before retrying or upgrade your plan',
            }
        );
    }

    /**
     * Error when Dexto account has insufficient credits.
     * Returned as 402 from the gateway with code INSUFFICIENT_CREDITS.
     */
    static insufficientCredits(balance?: number) {
        const balanceStr = balance !== undefined ? `$${balance.toFixed(2)}` : 'low';
        return new DextoRuntimeError(
            LLMErrorCode.INSUFFICIENT_CREDITS,
            'llm',
            'forbidden',
            `Insufficient Dexto credits. Balance: ${balanceStr}`,
            { balance },
            'Run `dexto billing` to check your balance'
        );
    }

    // Runtime operation errors
    static generationFailed(error: string, provider: LLMProvider, model: string) {
        return new DextoRuntimeError(
            LLMErrorCode.GENERATION_FAILED,
            'llm',
            'third_party',
            `Generation failed: ${error}`,
            { details: { error, provider, model } }
        );
    }

    // Switch operation errors (runtime checks not covered by Zod)
    static switchInputMissing() {
        return new DextoRuntimeError(
            LLMErrorCode.SWITCH_INPUT_MISSING,
            'llm',
            'user',
            'At least model or provider must be specified for LLM switch',
            {},
            'Provide either a model name, provider, or both'
        );
    }
}
