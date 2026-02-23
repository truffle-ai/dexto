#!/usr/bin/env tsx
/**
 * Syncs Dexto's built-in LLM model + provider snapshots from models.dev.
 *
 * Why:
 * - `packages/core/src/llm/registry/index.ts` used to hardcode many models (tokens/pricing/modalities),
 *   which is painful to maintain.
 * - models.dev provides a maintained, cross-provider model catalog.
 * - models.dev provides provider metadata (env var hints, docs, base URLs, intended SDK transports).
 *
 * Usage:
 *   pnpm run sync-llm-models        # regenerate the committed snapshots
 *   pnpm run sync-llm-models:check  # verify snapshots are up-to-date (CI)
 *
 * Optional env overrides:
 *   DEXTO_MODELS_DEV_API_JSON=/path/to/api.json
 *     Use a local models.dev snapshot instead of fetching.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHECK_MODE = process.argv.includes('--check');

const MODELS_OUTPUT_PATH = path.join(
    __dirname,
    '../packages/core/src/llm/registry/models.generated.ts'
);
const PROVIDERS_OUTPUT_PATH = path.join(
    __dirname,
    '../packages/core/src/llm/providers.generated.ts'
);

const MODELS_DEV_URL = 'https://models.dev/api.json';

type ModelsDevApi = Record<string, ModelsDevProvider>;
type ModelsDevProvider = {
    id: string;
    name: string;
    env: string[];
    npm: string;
    api?: string | undefined;
    doc?: string | undefined;
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
        [k: string]: unknown;
    };
    modalities?:
        | {
              input: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'>;
              output: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'>;
              [k: string]: unknown;
          }
        | undefined;
    cost?:
        | {
              input: number;
              output: number;
              cache_read?: number;
              cache_write?: number;
              context_over_200k?: unknown;
              [k: string]: unknown;
          }
        | undefined;
    [k: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new Error(`Expected ${label} to be an object`);
    }
    return value;
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw new Error(`Expected ${label} to be a string`);
    }
    return value;
}

function requireNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error(`Expected ${label} to be a number`);
    }
    return value;
}

function parseStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const result: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const trimmed = item.trim();
        if (trimmed) result.push(trimmed);
    }
    return result;
}

function parseModelsDevApi(json: unknown): ModelsDevApi {
    const root = requireRecord(json, 'models.dev api.json root');
    const api: ModelsDevApi = {};

    function parseModalitiesArray(
        value: unknown
    ): Array<'text' | 'audio' | 'image' | 'video' | 'pdf'> {
        if (!Array.isArray(value)) return [];
        const result: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'> = [];
        for (const item of value) {
            if (typeof item !== 'string') continue;
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
            env: parseStringArray(provider.env),
            npm: requireString(provider.npm, `models.dev provider '${providerId}'.npm`),
            api:
                typeof provider.api === 'string' && provider.api.trim()
                    ? provider.api.trim()
                    : undefined,
            doc:
                typeof provider.doc === 'string' && provider.doc.trim()
                    ? provider.doc.trim()
                    : undefined,
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
                ...m,
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
                    ...limit,
                    context: requireNumber(
                        limit.context,
                        `models.dev model '${providerId}/${modelId}'.limit.context`
                    ),
                    input: typeof limit.input === 'number' ? limit.input : undefined,
                    output: typeof limit.output === 'number' ? limit.output : undefined,
                },
                modalities: isRecord(m.modalities)
                    ? {
                          ...m.modalities,
                          input: parseModalitiesArray(m.modalities.input),
                          output: parseModalitiesArray(m.modalities.output),
                      }
                    : undefined,
                cost:
                    isRecord(m.cost) &&
                    typeof m.cost.input === 'number' &&
                    typeof m.cost.output === 'number'
                        ? {
                              ...m.cost,
                              input: m.cost.input,
                              output: m.cost.output,
                              cache_read:
                                  typeof m.cost.cache_read === 'number'
                                      ? m.cost.cache_read
                                      : undefined,
                              cache_write:
                                  typeof m.cost.cache_write === 'number'
                                      ? m.cost.cache_write
                                      : undefined,
                              context_over_200k: m.cost.context_over_200k,
                          }
                        : undefined,
            };

            parsedProvider.models[modelId] = parsedModel;
        }

        api[providerId] = parsedProvider;
    }

    return api;
}

type DextoSupportedFileType = 'pdf' | 'image' | 'audio';

type GeneratedModelPricing = {
    inputPerM: number;
    outputPerM: number;
    cacheReadPerM?: number;
    cacheWritePerM?: number;
    currency?: 'USD';
    unit?: 'per_million_tokens';
};

type GeneratedModelInfo = {
    name: string;
    maxInputTokens: number;
    supportedFileTypes: DextoSupportedFileType[];
    displayName?: string;
    pricing?: GeneratedModelPricing;
    default?: boolean;
};

function getSupportedFileTypesFromModel(
    provider: string,
    model: ModelsDevModel
): DextoSupportedFileType[] {
    const inputModalities = model.modalities?.input ?? [];
    const fileTypes: DextoSupportedFileType[] = [];

    if (inputModalities.includes('pdf')) fileTypes.push('pdf');
    if (inputModalities.includes('image')) fileTypes.push('image');
    if (inputModalities.includes('audio')) fileTypes.push('audio');

    // models.dev currently under-reports PDF support for OpenAI.
    // Dexto historically treats OpenAI vision-capable models as supporting PDFs too.
    // Keep this behavior to avoid user-facing regressions in attachment UI.
    if (provider === 'openai' && model.attachment === true && inputModalities.includes('image')) {
        if (!fileTypes.includes('pdf')) fileTypes.unshift('pdf');
    }

    // If modalities are missing, treat as "no attachments" rather than guessing.
    // models.dev uses `attachment` for a coarse capability flag, but Dexto needs explicit types.
    return fileTypes;
}

function getPricing(model: ModelsDevModel): GeneratedModelPricing | undefined {
    if (!model.cost) return undefined;
    return {
        inputPerM: model.cost.input,
        outputPerM: model.cost.output,
        cacheReadPerM: model.cost.cache_read,
        cacheWritePerM: model.cost.cache_write,
        currency: 'USD',
        unit: 'per_million_tokens',
    };
}

function modelToGeneratedModel(
    model: ModelsDevModel,
    options: {
        provider: string;
        defaultModelId?: string;
    }
): GeneratedModelInfo {
    return {
        name: model.id,
        displayName: model.name,
        maxInputTokens: model.limit.input ?? model.limit.context,
        supportedFileTypes: getSupportedFileTypesFromModel(options.provider, model),
        pricing: getPricing(model),
        ...(options.defaultModelId === model.id ? { default: true } : {}),
    };
}

function buildModelsFromModelsDevProvider(params: {
    provider: string;
    modelsDevApi: ModelsDevApi;
    modelsDevProviderId: string;
    defaultModelId?: string;
    includeModelId: (modelId: string) => boolean;
}): GeneratedModelInfo[] {
    const { provider, modelsDevApi, modelsDevProviderId, defaultModelId, includeModelId } = params;

    const modelsDevProvider = modelsDevApi[modelsDevProviderId];
    if (!modelsDevProvider) {
        throw new Error(
            `models.dev provider '${modelsDevProviderId}' not found (needed for dexto-nova provider '${provider}')`
        );
    }

    const results: GeneratedModelInfo[] = [];
    for (const [modelId, model] of Object.entries(modelsDevProvider.models)) {
        if (!includeModelId(modelId)) continue;
        results.push(modelToGeneratedModel(model, { provider, defaultModelId }));
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
}

async function loadModelsDevApiJsonText(): Promise<string> {
    const localPath = process.env.DEXTO_MODELS_DEV_API_JSON;
    if (localPath) {
        const resolved = path.resolve(localPath);
        if (!fs.existsSync(resolved)) {
            throw new Error(`DEXTO_MODELS_DEV_API_JSON does not exist: ${resolved}`);
        }
        return fs.readFileSync(resolved, 'utf-8');
    }

    const res = await fetch(MODELS_DEV_URL, {
        headers: { 'User-Agent': 'dexto-sync-llm-models' },
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch models.dev (${res.status} ${res.statusText})`);
    }
    return await res.text();
}

async function syncLlmRegistry() {
    const modelsDevText = await loadModelsDevApiJsonText();
    const modelsDevJson = parseModelsDevApi(JSON.parse(modelsDevText));

    const overlayProviderIds = [
        'dexto-nova',
        'openai-compatible',
        'litellm',
        'glama',
        'local',
        'ollama',
    ] as const;

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
        // gateway/dynamic providers intentionally omit defaults here
    };

    function includeModel(providerId: string, modelId: string): boolean {
        if (providerId === 'openai') return modelId.startsWith('gpt-') || modelId.startsWith('o');
        if (providerId === 'anthropic') return modelId.startsWith('claude-');
        if (providerId === 'google') return modelId.startsWith('gemini-');
        if (providerId === 'xai') return modelId.startsWith('grok-');
        if (providerId === 'cohere') return modelId.startsWith('command-');
        return true;
    }

    const providerIds = Object.keys(modelsDevJson).sort();

    const modelsByProvider: Record<string, GeneratedModelInfo[]> = {};
    for (const providerId of providerIds) {
        const defaultModelId = defaults[providerId];
        const models = buildModelsFromModelsDevProvider({
            provider: providerId,
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: providerId,
            defaultModelId,
            includeModelId: (modelId) => includeModel(providerId, modelId),
        });

        if (providerId === 'amazon-bedrock') {
            modelsByProvider[providerId] = models
                // Normalize AWS region-prefixed IDs to the canonical unprefixed ID.
                .map((m) => ({ ...m, name: m.name.replace(/^(eu\\.|us\\.|global\\.)/i, '') }))
                // De-dupe after stripping prefixes.
                .filter((m, idx, arr) => arr.findIndex((x) => x.name === m.name) === idx)
                .sort((a, b) => a.name.localeCompare(b.name));
        } else {
            modelsByProvider[providerId] = models;
        }
    }

    for (const overlayId of overlayProviderIds) {
        modelsByProvider[overlayId] = [];
    }

    const providersById: Record<
        string,
        {
            id: string;
            name: string;
            env: string[];
            npm: string;
            api?: string;
            doc?: string;
        }
    > = {};

    for (const providerId of providerIds) {
        const p = modelsDevJson[providerId]!;
        providersById[providerId] = {
            id: p.id,
            name: p.name,
            env: p.env,
            npm: p.npm,
            ...(p.api ? { api: p.api } : {}),
            ...(p.doc ? { doc: p.doc } : {}),
        };
    }

    const overlayProviders = {
        'dexto-nova': {
            id: 'dexto-nova',
            name: 'Dexto Nova',
            env: ['DEXTO_API_KEY'],
            npm: '@ai-sdk/openai-compatible',
            api: 'https://api.dexto.ai/v1',
            doc: 'https://dexto.ai',
        },
        'openai-compatible': {
            id: 'openai-compatible',
            name: 'OpenAI Compatible (Custom)',
            env: ['OPENAI_API_KEY', 'OPENAI_KEY'],
            npm: '@ai-sdk/openai-compatible',
        },
        litellm: {
            id: 'litellm',
            name: 'LiteLLM',
            env: ['LITELLM_API_KEY', 'LITELLM_KEY'],
            npm: '@ai-sdk/openai-compatible',
            doc: 'https://docs.litellm.ai',
        },
        glama: {
            id: 'glama',
            name: 'Glama',
            env: ['GLAMA_API_KEY'],
            npm: '@ai-sdk/openai-compatible',
            api: 'https://glama.ai/api/gateway/openai/v1',
            doc: 'https://glama.ai',
        },
        local: {
            id: 'local',
            name: 'Local (GGUF)',
            env: [],
            npm: '@ai-sdk/openai-compatible',
        },
        ollama: {
            id: 'ollama',
            name: 'Ollama',
            env: [],
            npm: '@ai-sdk/openai-compatible',
            api: 'http://localhost:11434/v1',
            doc: 'https://ollama.com',
        },
    } as const;

    for (const [providerId, info] of Object.entries(overlayProviders)) {
        providersById[providerId] = { ...info };
    }

    const llmProviders = Object.keys(providersById).sort();

    const modelsHeader = `// This file is auto-generated by scripts/sync-llm-models.ts\n// Do not edit manually - run 'pnpm run sync-llm-models' to update\n`;
    const modelsBody = `
import type { LLMProvider } from '../types.js';
import type { ModelInfo } from './index.js';

export const MODELS_BY_PROVIDER = ${JSON.stringify(modelsByProvider, null, 4)} satisfies Record<
    LLMProvider,
    ModelInfo[]
>;
`;

    const providersHeader = `// This file is auto-generated by scripts/sync-llm-models.ts\n// Do not edit manually - run 'pnpm run sync-llm-models' to update\n`;
    const providersBody = `
export type ProviderSnapshotEntry = {
    id: string;
    name: string;
    env: readonly string[];
    npm: string;
    api?: string;
    doc?: string;
};

export const PROVIDERS_BY_ID = ${JSON.stringify(providersById, null, 4)} as const satisfies Record<
    string,
    ProviderSnapshotEntry
>;

export const LLM_PROVIDERS = ${JSON.stringify(llmProviders, null, 4)} as const;
`;

    const prettierConfig = (await prettier.resolveConfig(MODELS_OUTPUT_PATH)) ?? undefined;
    const formattedModels = await prettier.format(modelsHeader + modelsBody, {
        ...prettierConfig,
        parser: 'typescript',
        filepath: MODELS_OUTPUT_PATH,
    });

    const formattedProviders = await prettier.format(providersHeader + providersBody, {
        ...prettierConfig,
        parser: 'typescript',
        filepath: PROVIDERS_OUTPUT_PATH,
    });

    if (CHECK_MODE) {
        if (!fs.existsSync(MODELS_OUTPUT_PATH)) {
            console.error(
                `❌ Missing generated file: ${path.relative(process.cwd(), MODELS_OUTPUT_PATH)}`
            );
            console.error(`   Run: pnpm run sync-llm-models\n`);
            process.exit(1);
        }
        if (!fs.existsSync(PROVIDERS_OUTPUT_PATH)) {
            console.error(
                `❌ Missing generated file: ${path.relative(process.cwd(), PROVIDERS_OUTPUT_PATH)}`
            );
            console.error(`   Run: pnpm run sync-llm-models\n`);
            process.exit(1);
        }

        const existingModels = fs.readFileSync(MODELS_OUTPUT_PATH, 'utf-8');
        if (existingModels !== formattedModels) {
            console.error('❌ LLM registry snapshot is out of date!');
            console.error(`   File: ${path.relative(process.cwd(), MODELS_OUTPUT_PATH)}`);
            console.error('   Run: pnpm run sync-llm-models\n');
            process.exit(1);
        }

        const existingProviders = fs.readFileSync(PROVIDERS_OUTPUT_PATH, 'utf-8');
        if (existingProviders !== formattedProviders) {
            console.error('❌ LLM provider snapshot is out of date!');
            console.error(`   File: ${path.relative(process.cwd(), PROVIDERS_OUTPUT_PATH)}`);
            console.error('   Run: pnpm run sync-llm-models\n');
            process.exit(1);
        }
        console.log('✅ LLM registry snapshot is up-to-date');
        return;
    }

    fs.mkdirSync(path.dirname(MODELS_OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(MODELS_OUTPUT_PATH, formattedModels, 'utf-8');
    console.log(`✓ Wrote ${path.relative(process.cwd(), MODELS_OUTPUT_PATH)}`);

    fs.mkdirSync(path.dirname(PROVIDERS_OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(PROVIDERS_OUTPUT_PATH, formattedProviders, 'utf-8');
    console.log(`✓ Wrote ${path.relative(process.cwd(), PROVIDERS_OUTPUT_PATH)}`);
}

syncLlmRegistry().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
