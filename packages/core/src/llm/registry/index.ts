import {
    acceptsAnyModel,
    DEFAULT_MAX_INPUT_TOKENS,
    getAllModelsForProvider as getSharedAllModelsForProvider,
    getModel,
    getProviderFromModel as getSharedProviderFromModel,
    getSupportedFileTypesForModel as getSharedSupportedFileTypesForModel,
    getSupportedModels,
    hasAllRegistryModelsSupport,
    LLM_REGISTRY,
    LlmCatalogError,
    supportsCustomModels,
    type ModelInfo,
} from '@dexto/llm';
import type { ValidatedLLMConfig } from '../schemas.js';
import { LLMError } from '../errors.js';
import { LLMErrorCode } from '../error-codes.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import type { Logger } from '../../logger/v2/types.js';
import type { LLMProvider, SupportedFileType } from '@dexto/llm';
import {
    getCachedOpenRouterModelsWithInfo,
    getOpenRouterModelContextLength,
} from '../providers/openrouter-model-registry.js';

type EffectiveMaxInputTokensConfig = Pick<
    ValidatedLLMConfig,
    'provider' | 'model' | 'baseURL' | 'maxInputTokens'
>;

function isUnknownCatalogModelError(error: unknown): boolean {
    return error instanceof LlmCatalogError && error.code === 'MODEL_UNKNOWN';
}

function cloneModel(model: ModelInfo): ModelInfo {
    return {
        ...model,
        supportedFileTypes: [...model.supportedFileTypes],
        ...(model.modalities
            ? {
                  modalities: {
                      input: [...model.modalities.input],
                      output: [...model.modalities.output],
                  },
              }
            : {}),
    };
}

function findOpenRouterSnapshotModelById(modelId: string): ModelInfo | null {
    const normalized = modelId.toLowerCase();
    return LLM_REGISTRY.openrouter.models.find((m) => m.name.toLowerCase() === normalized) ?? null;
}

function buildOpenRouterGatewayModelInfo(
    cachedModel: {
        id: string;
        contextLength: number;
        displayName?: string;
        supportedParameters?: string[];
    },
    snapshot: ModelInfo | null
): ModelInfo {
    const displayName = snapshot?.displayName ?? cachedModel.displayName;
    const supportedFileTypes =
        snapshot?.supportedFileTypes ?? LLM_REGISTRY.openrouter.supportedFileTypes;
    const maxInputTokens =
        cachedModel.contextLength > 0
            ? cachedModel.contextLength
            : (snapshot?.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS);
    const inferredReasoning = cachedModel.supportedParameters?.includes('reasoning');
    const inferredSupportsTemperature = cachedModel.supportedParameters?.includes('temperature');

    return {
        name: snapshot?.name ?? cachedModel.id,
        maxInputTokens,
        supportedFileTypes,
        ...(snapshot?.default ? { default: true } : {}),
        ...(displayName ? { displayName } : {}),
        ...(typeof snapshot?.reasoning === 'boolean'
            ? { reasoning: snapshot.reasoning }
            : inferredReasoning === true
              ? { reasoning: true }
              : {}),
        ...(typeof snapshot?.supportsTemperature === 'boolean'
            ? { supportsTemperature: snapshot.supportsTemperature }
            : inferredSupportsTemperature === true
              ? { supportsTemperature: true }
              : {}),
        ...(typeof snapshot?.supportsInterleaved === 'boolean'
            ? { supportsInterleaved: snapshot.supportsInterleaved }
            : {}),
        ...(snapshot?.releaseDate ? { releaseDate: snapshot.releaseDate } : {}),
        ...(typeof snapshot?.supportsToolCall === 'boolean'
            ? { supportsToolCall: snapshot.supportsToolCall }
            : {}),
        ...(snapshot?.status ? { status: snapshot.status } : {}),
        ...(snapshot?.modalities ? { modalities: snapshot.modalities } : {}),
        ...(snapshot?.providerMetadata ? { providerMetadata: snapshot.providerMetadata } : {}),
        ...(snapshot?.interleaved ? { interleaved: snapshot.interleaved } : {}),
        ...(snapshot?.pricing ? { pricing: snapshot.pricing } : {}),
    };
}

function getOpenRouterGatewayCatalogModels(): ModelInfo[] {
    const cached = getCachedOpenRouterModelsWithInfo();
    if (!cached || cached.length === 0) {
        return LLM_REGISTRY.openrouter.models.map(cloneModel);
    }

    return cached
        .map((cachedModel) =>
            buildOpenRouterGatewayModelInfo(
                cachedModel,
                findOpenRouterSnapshotModelById(cachedModel.id)
            )
        )
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function getAllModelsForProvider(
    provider: LLMProvider
): Array<ModelInfo & { originalProvider?: LLMProvider }> {
    if (provider === 'openrouter') {
        return getOpenRouterGatewayCatalogModels().map((model) => ({
            ...model,
            originalProvider: 'openrouter',
        }));
    }

    if (!hasAllRegistryModelsSupport(provider)) {
        return getSharedAllModelsForProvider(provider) as Array<
            ModelInfo & { originalProvider?: LLMProvider }
        >;
    }

    const allModels: Array<ModelInfo & { originalProvider?: LLMProvider }> = [];
    const seen = new Set<string>();

    for (const model of LLM_REGISTRY[provider].models) {
        const key = model.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        allModels.push({ ...cloneModel(model), originalProvider: provider });
    }

    for (const model of getOpenRouterGatewayCatalogModels()) {
        const key = model.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        allModels.push({ ...model, originalProvider: 'openrouter' });
    }

    return allModels;
}

export function getProviderFromModel(model: string): LLMProvider {
    try {
        return getSharedProviderFromModel(model) as LLMProvider;
    } catch (error) {
        if (isUnknownCatalogModelError(error)) {
            throw LLMError.modelProviderUnknown(model);
        }
        throw error;
    }
}

export function getSupportedFileTypesForModel(
    provider: LLMProvider,
    model: string
): SupportedFileType[] {
    try {
        return getSharedSupportedFileTypesForModel(provider, model) as SupportedFileType[];
    } catch (error) {
        if (isUnknownCatalogModelError(error)) {
            throw LLMError.unknownModel(provider, model);
        }
        throw error;
    }
}

export function modelSupportsFileType(
    provider: LLMProvider,
    model: string,
    fileType: SupportedFileType
): boolean {
    return getSupportedFileTypesForModel(provider, model).includes(fileType);
}

export function getMaxInputTokensForModel(
    provider: LLMProvider,
    model: string,
    logger?: Logger
): number {
    const modelInfo = getModel(provider, model);
    if (modelInfo !== null) {
        logger?.debug(`Found max tokens for ${provider}/${model}: ${modelInfo.maxInputTokens}`);
        return modelInfo.maxInputTokens;
    }

    if ((provider === 'openrouter' || provider === 'dexto-nova') && model.includes('/')) {
        const contextLength = getOpenRouterModelContextLength(model);
        if (typeof contextLength === 'number') {
            logger?.debug(
                `Using max tokens from OpenRouter cache for ${provider}/${model}: ${contextLength}`
            );
            return contextLength;
        }
    }

    const supportedModels = getSupportedModels(provider).join(', ');
    logger?.error(
        `Model '${model}' not found for provider '${provider}' in LLM registry. Supported models: ${supportedModels}`
    );
    throw LLMError.unknownModel(provider, model);
}

export function getEffectiveMaxInputTokens(
    config: EffectiveMaxInputTokensConfig,
    logger: Logger
): number {
    const configuredMaxInputTokens = config.maxInputTokens;

    if (configuredMaxInputTokens != null) {
        if (config.baseURL) {
            logger.debug(
                `Using maxInputTokens from configuration (with baseURL): ${configuredMaxInputTokens}`
            );
            return configuredMaxInputTokens;
        }

        try {
            const registryMaxInputTokens = getMaxInputTokensForModel(
                config.provider,
                config.model,
                logger
            );
            if (configuredMaxInputTokens > registryMaxInputTokens) {
                logger.warn(
                    `Provided maxInputTokens (${configuredMaxInputTokens}) for ${config.provider}/${config.model} exceeds the known limit (${registryMaxInputTokens}) for model ${config.model}. Capping to registry limit.`
                );
                return registryMaxInputTokens;
            }

            logger.debug(
                `Using valid maxInputTokens override from configuration: ${configuredMaxInputTokens} (Registry limit: ${registryMaxInputTokens})`
            );
            return configuredMaxInputTokens;
        } catch (error: unknown) {
            if (error instanceof DextoRuntimeError && error.code === LLMErrorCode.MODEL_UNKNOWN) {
                logger.warn(
                    `Registry lookup failed during maxInputTokens override check for ${config.provider}/${config.model}: ${error.message}. ` +
                        `Proceeding with the provided maxInputTokens value (${configuredMaxInputTokens}), but it might be invalid.`
                );
                return configuredMaxInputTokens;
            }

            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(
                `getEffectiveMaxInputTokens: unexpected error during maxInputTokens override check: ${errorMessage}`
            );
            throw error;
        }
    }

    if (config.baseURL) {
        logger.warn(
            `baseURL is set but maxInputTokens is missing. Defaulting to ${DEFAULT_MAX_INPUT_TOKENS}. ` +
                `Provide 'maxInputTokens' in configuration to avoid default fallback.`
        );
        return DEFAULT_MAX_INPUT_TOKENS;
    }

    if (acceptsAnyModel(config.provider)) {
        logger.debug(
            `Provider ${config.provider} accepts any model, defaulting to ${DEFAULT_MAX_INPUT_TOKENS} tokens`
        );
        return DEFAULT_MAX_INPUT_TOKENS;
    }

    try {
        const registryMaxInputTokens = getMaxInputTokensForModel(
            config.provider,
            config.model,
            logger
        );
        logger.debug(
            `Using maxInputTokens from registry for ${config.provider}/${config.model}: ${registryMaxInputTokens}`
        );
        return registryMaxInputTokens;
    } catch (error: unknown) {
        if (error instanceof DextoRuntimeError && error.code === LLMErrorCode.MODEL_UNKNOWN) {
            if (supportsCustomModels(config.provider)) {
                logger.debug(
                    `Custom model ${config.model} not in ${config.provider} registry, defaulting to ${DEFAULT_MAX_INPUT_TOKENS} tokens`
                );
                return DEFAULT_MAX_INPUT_TOKENS;
            }

            logger.error(
                `Registry lookup failed for ${config.provider}/${config.model}: ${error.message}. ` +
                    `Effective maxInputTokens cannot be determined.`
            );
            throw LLMError.unknownModel(config.provider, config.model);
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
            `getEffectiveMaxInputTokens: unexpected error during registry lookup for maxInputTokens: ${errorMessage}`
        );
        throw error;
    }
}
