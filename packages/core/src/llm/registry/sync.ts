import type { LLMProvider, SupportedFileType } from '../types.js';
import type { ModelInfo } from './index.js';
import { DextoValidationError } from '../../errors/DextoValidationError.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';

export const MODELS_DEV_URL = 'https://models.dev/api.json';

type ModelsDevApi = Record<string, ModelsDevProvider>;
type ModelsDevProvider = {
    id: string;
    name: string;
    models: Record<string, ModelsDevModel>;
};
type ModelsDevModel = {
    id: string;
    name: string;
    attachment: boolean;
    limit: {
        context: number;
        input?: number;
        output?: number;
    };
    modalities?:
        | {
              input: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'>;
              output: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'>;
          }
        | undefined;
    cost?:
        | {
              input: number;
              output: number;
              cache_read?: number;
              cache_write?: number;
              context_over_200k?: unknown;
          }
        | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function makeIssue(message: string, path?: Array<string | number>) {
    return {
        code: 'llm_registry_models_dev_parse',
        message,
        scope: ErrorScope.LLM,
        type: ErrorType.USER,
        severity: 'error' as const,
        ...(path ? { path } : {}),
    };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
    if (!isRecord(value))
        throw new DextoValidationError([makeIssue(`Expected ${label} to be an object`)]);
    return value;
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== 'string')
        throw new DextoValidationError([makeIssue(`Expected ${label} to be a string`)]);
    return value;
}

function requireNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new DextoValidationError([makeIssue(`Expected ${label} to be a number`)]);
    }
    return value;
}

export function parseModelsDevApi(json: unknown): ModelsDevApi {
    const root = requireRecord(json, 'models.dev api.json root');
    const api: ModelsDevApi = {};

    function parseModalitiesArray(
        value: unknown
    ): Array<'text' | 'audio' | 'image' | 'video' | 'pdf'> {
        if (!Array.isArray(value)) return [];
        const result: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'> = [];
        for (const item of value) {
            if (
                item === 'text' ||
                item === 'audio' ||
                item === 'image' ||
                item === 'video' ||
                item === 'pdf'
            ) {
                result.push(item);
            }
        }
        return result;
    }

    for (const [providerId, providerValue] of Object.entries(root)) {
        if (!isRecord(providerValue)) continue;
        const provider = providerValue;
        const models = requireRecord(provider.models, `models.dev provider '${providerId}'.models`);

        const parsedProvider: ModelsDevProvider = {
            id: requireString(provider.id ?? providerId, `models.dev provider '${providerId}'.id`),
            name: requireString(
                provider.name ?? providerId,
                `models.dev provider '${providerId}'.name`
            ),
            models: {},
        };

        for (const [modelId, modelValue] of Object.entries(models)) {
            if (!isRecord(modelValue)) continue;
            const m = modelValue;
            const limit = requireRecord(
                m.limit,
                `models.dev model '${providerId}/${modelId}'.limit`
            );

            const parsedModel: ModelsDevModel = {
                id: requireString(
                    m.id ?? modelId,
                    `models.dev model '${providerId}/${modelId}'.id`
                ),
                name: requireString(
                    m.name ?? modelId,
                    `models.dev model '${providerId}/${modelId}'.name`
                ),
                attachment: Boolean(m.attachment),
                limit: {
                    context: requireNumber(
                        limit.context,
                        `models.dev model '${providerId}/${modelId}'.limit.context`
                    ),
                    ...(typeof limit.input === 'number' ? { input: limit.input } : {}),
                    ...(typeof limit.output === 'number' ? { output: limit.output } : {}),
                },
                modalities: isRecord(m.modalities)
                    ? {
                          input: parseModalitiesArray(m.modalities.input),
                          output: parseModalitiesArray(m.modalities.output),
                      }
                    : undefined,
                cost:
                    isRecord(m.cost) &&
                    typeof m.cost.input === 'number' &&
                    typeof m.cost.output === 'number'
                        ? {
                              input: m.cost.input,
                              output: m.cost.output,
                              ...(typeof m.cost.cache_read === 'number'
                                  ? { cache_read: m.cost.cache_read }
                                  : {}),
                              ...(typeof m.cost.cache_write === 'number'
                                  ? { cache_write: m.cost.cache_write }
                                  : {}),
                              ...(m.cost.context_over_200k != null
                                  ? { context_over_200k: m.cost.context_over_200k }
                                  : {}),
                          }
                        : undefined,
            };

            parsedProvider.models[modelId] = parsedModel;
        }

        api[providerId] = parsedProvider;
    }

    return api;
}

function getSupportedFileTypesFromModel(
    provider: LLMProvider,
    model: ModelsDevModel
): SupportedFileType[] {
    const inputModalities = model.modalities?.input ?? [];
    const fileTypes: SupportedFileType[] = [];

    if (inputModalities.includes('pdf')) fileTypes.push('pdf');
    if (inputModalities.includes('image')) fileTypes.push('image');
    if (inputModalities.includes('audio')) fileTypes.push('audio');

    // models.dev currently under-reports PDF support for OpenAI.
    // Dexto historically treats OpenAI vision-capable models as supporting PDFs too.
    if (provider === 'openai' && model.attachment === true && inputModalities.includes('image')) {
        if (!fileTypes.includes('pdf')) fileTypes.unshift('pdf');
    }

    return fileTypes;
}

function getPricing(model: ModelsDevModel): ModelInfo['pricing'] | undefined {
    if (!model.cost) return undefined;
    return {
        inputPerM: model.cost.input,
        outputPerM: model.cost.output,
        ...(typeof model.cost.cache_read === 'number'
            ? { cacheReadPerM: model.cost.cache_read }
            : {}),
        ...(typeof model.cost.cache_write === 'number'
            ? { cacheWritePerM: model.cost.cache_write }
            : {}),
        currency: 'USD',
        unit: 'per_million_tokens',
    };
}

function modelToModelInfo(
    provider: LLMProvider,
    model: ModelsDevModel,
    options: { defaultModelId?: string }
): ModelInfo {
    const pricing = getPricing(model);
    return {
        name: model.id,
        displayName: model.name,
        maxInputTokens: model.limit.input ?? model.limit.context,
        supportedFileTypes: getSupportedFileTypesFromModel(provider, model),
        ...(pricing ? { pricing } : {}),
        ...(options.defaultModelId === model.id ? { default: true } : {}),
    };
}

type ProviderBuildSpec = {
    provider: LLMProvider;
    modelsDevProviderId: string;
    includeModelId: (id: string) => boolean;
    defaultModelId?: string;
};

function buildModelsFromModelsDevProvider(params: {
    spec: ProviderBuildSpec;
    modelsDevApi: ModelsDevApi;
}): ModelInfo[] {
    const { spec, modelsDevApi } = params;
    const modelsDevProvider = modelsDevApi[spec.modelsDevProviderId];
    if (!modelsDevProvider) {
        throw new DextoRuntimeError(
            'llm_registry_models_dev_provider_missing',
            ErrorScope.LLM,
            ErrorType.THIRD_PARTY,
            `models.dev provider '${spec.modelsDevProviderId}' not found (needed for dexto-nova provider '${spec.provider}')`,
            { modelsDevProviderId: spec.modelsDevProviderId, provider: spec.provider }
        );
    }

    const results: ModelInfo[] = [];
    for (const [modelId, model] of Object.entries(modelsDevProvider.models)) {
        if (!spec.includeModelId(modelId)) continue;
        const options: { defaultModelId?: string } = {
            ...(spec.defaultModelId ? { defaultModelId: spec.defaultModelId } : {}),
        };

        results.push(modelToModelInfo(spec.provider, model, options));
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
}

export function buildModelsByProviderFromParsedSources(params: {
    modelsDevApi: ModelsDevApi;
}): Record<LLMProvider, ModelInfo[]> {
    const { modelsDevApi } = params;

    const overlayProviderIds: LLMProvider[] = [
        'dexto-nova',
        'openai-compatible',
        'litellm',
        'glama',
        'local',
        'ollama',
    ];

    const defaults: Partial<Record<string, string>> = {
        openai: 'gpt-5-mini',
        anthropic: 'claude-haiku-4-5-20251001',
        google: 'gemini-3-flash-preview',
        groq: 'llama-3.3-70b-versatile',
        xai: 'grok-4',
        cohere: 'command-a-03-2025',
        minimax: 'MiniMax-M2.1',
        zhipuai: 'glm-4.7',
        moonshotai: 'kimi-k2.5',
    };

    function includeModel(providerId: string, modelId: string): boolean {
        if (providerId === 'openai') return modelId.startsWith('gpt-') || modelId.startsWith('o');
        if (providerId === 'anthropic') return modelId.startsWith('claude-');
        if (providerId === 'google') return modelId.startsWith('gemini-');
        if (providerId === 'xai') return modelId.startsWith('grok-');
        if (providerId === 'cohere') return modelId.startsWith('command-');
        return true;
    }

    const providerIds = Object.keys(modelsDevApi).sort();
    const modelsByProvider = {} as Record<LLMProvider, ModelInfo[]>;

    for (const providerId of providerIds) {
        const providerKey = providerId as LLMProvider;
        const models = buildModelsFromModelsDevProvider({
            spec: {
                provider: providerKey,
                modelsDevProviderId: providerId,
                ...(defaults[providerId] ? { defaultModelId: defaults[providerId] } : {}),
                includeModelId: (id) => includeModel(providerId, id),
            },
            modelsDevApi,
        });

        if (providerId === 'amazon-bedrock') {
            modelsByProvider[providerKey] = models
                .map((m) => ({ ...m, name: m.name.replace(/^(eu\.|us\.|global\.)/i, '') }))
                .filter((m, idx, arr) => arr.findIndex((x) => x.name === m.name) === idx)
                .sort((a, b) => a.name.localeCompare(b.name));
        } else {
            modelsByProvider[providerKey] = models;
        }
    }

    for (const overlayId of overlayProviderIds) {
        modelsByProvider[overlayId] = [];
    }

    return modelsByProvider;
}

export async function buildModelsByProviderFromRemote(options?: {
    modelsDevUrl?: string;
    userAgent?: string;
    timeoutMs?: number;
}): Promise<Record<LLMProvider, ModelInfo[]>> {
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const userAgent = options?.userAgent ?? 'dexto-llm-registry';

    const modelsDevRes = await fetch(options?.modelsDevUrl ?? MODELS_DEV_URL, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!modelsDevRes.ok) {
        throw new DextoRuntimeError(
            'llm_registry_models_dev_fetch_failed',
            ErrorScope.LLM,
            ErrorType.THIRD_PARTY,
            `Failed to fetch models.dev (${modelsDevRes.status} ${modelsDevRes.statusText})`,
            { status: modelsDevRes.status, statusText: modelsDevRes.statusText }
        );
    }
    const modelsDevApi = parseModelsDevApi(await modelsDevRes.json());

    return buildModelsByProviderFromParsedSources({ modelsDevApi });
}
