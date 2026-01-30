#!/usr/bin/env tsx
/**
 * Syncs Dexto's built-in LLM model registry from models.dev.
 *
 * Why:
 * - `packages/core/src/llm/registry/index.ts` used to hardcode many models (tokens/pricing/modalities),
 *   which is painful to maintain.
 * - models.dev provides a maintained, cross-provider model catalog.
 * - models.dev provides gateway catalogs (e.g. OpenRouter) including pricing and modalities.
 *
 * Usage:
 *   pnpm run sync-llm-registry        # regenerate the committed snapshot
 *   pnpm run sync-llm-registry:check  # verify snapshot is up-to-date (CI)
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

const OUTPUT_PATH = path.join(__dirname, '../packages/core/src/llm/registry/models.generated.ts');

const MODELS_DEV_URL = 'https://models.dev/api.json';

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
    reasoning?: boolean;
    temperature?: boolean;
    interleaved?: unknown;
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

type DextoProvider =
    | 'openai'
    | 'openai-compatible'
    | 'anthropic'
    | 'google'
    | 'groq'
    | 'xai'
    | 'cohere'
    | 'minimax'
    | 'glm'
    | 'openrouter'
    | 'litellm'
    | 'glama'
    | 'vertex'
    | 'bedrock'
    | 'local'
    | 'ollama'
    | 'dexto';

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
    reasoning?: boolean;
    supportsTemperature?: boolean;
    supportsInterleaved?: boolean;
    pricing?: GeneratedModelPricing;
    default?: boolean;
};

function getSupportedFileTypesFromModel(
    provider: DextoProvider,
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
        provider: DextoProvider;
        defaultModelId?: string;
    }
): GeneratedModelInfo {
    const supportsInterleaved = model.interleaved === true || isRecord(model.interleaved);
    return {
        name: model.id,
        displayName: model.name,
        maxInputTokens: model.limit.input ?? model.limit.context,
        supportedFileTypes: getSupportedFileTypesFromModel(options.provider, model),
        ...(typeof model.reasoning === 'boolean' ? { reasoning: model.reasoning } : {}),
        ...(typeof model.temperature === 'boolean'
            ? { supportsTemperature: model.temperature }
            : {}),
        ...(supportsInterleaved ? { supportsInterleaved } : {}),
        pricing: getPricing(model),
        ...(options.defaultModelId === model.id ? { default: true } : {}),
    };
}

function buildModelsFromModelsDevProvider(params: {
    provider: DextoProvider;
    modelsDevApi: ModelsDevApi;
    modelsDevProviderId: string;
    defaultModelId?: string;
    includeModelId: (modelId: string) => boolean;
}): GeneratedModelInfo[] {
    const { provider, modelsDevApi, modelsDevProviderId, defaultModelId, includeModelId } = params;

    const modelsDevProvider = modelsDevApi[modelsDevProviderId];
    if (!modelsDevProvider) {
        throw new Error(
            `models.dev provider '${modelsDevProviderId}' not found (needed for dexto provider '${provider}')`
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
        headers: { 'User-Agent': 'dexto-sync-llm-registry' },
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

    const defaults: Partial<Record<DextoProvider, string>> = {
        openai: 'gpt-5-mini',
        anthropic: 'claude-haiku-4-5-20251001',
        google: 'gemini-3-flash-preview',
        groq: 'llama-3.3-70b-versatile',
        xai: 'grok-4',
        cohere: 'command-a-03-2025',
        minimax: 'MiniMax-M2.1',
        glm: 'glm-4.7',
        vertex: 'gemini-3-flash-preview',
        bedrock: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
        // gateway/dynamic providers intentionally omit defaults here
    };

    const include = {
        openai: (id: string) => id.startsWith('gpt-') || id.startsWith('o'),
        anthropic: (id: string) => id.startsWith('claude-'),
        google: (id: string) => id.startsWith('gemini-'),
        groq: (_id: string) => true,
        xai: (id: string) => id.startsWith('grok-'),
        cohere: (id: string) => id.startsWith('command-'),
        minimax: (_id: string) => true,
        glm: (id: string) => id.startsWith('glm-'),
        vertex: (_id: string) => true,
        bedrock: (_id: string) => true,
        openrouter: (_id: string) => true,
    } as const;

    const modelsByProvider: Record<DextoProvider, GeneratedModelInfo[]> = {
        openai: buildModelsFromModelsDevProvider({
            provider: 'openai',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'openai',
            defaultModelId: defaults.openai,
            includeModelId: include.openai,
        }),
        'openai-compatible': [],
        anthropic: buildModelsFromModelsDevProvider({
            provider: 'anthropic',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'anthropic',
            defaultModelId: defaults.anthropic,
            includeModelId: include.anthropic,
        }),
        google: buildModelsFromModelsDevProvider({
            provider: 'google',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'google',
            defaultModelId: defaults.google,
            includeModelId: include.google,
        }),
        groq: buildModelsFromModelsDevProvider({
            provider: 'groq',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'groq',
            defaultModelId: defaults.groq,
            includeModelId: include.groq,
        }),
        xai: buildModelsFromModelsDevProvider({
            provider: 'xai',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'xai',
            defaultModelId: defaults.xai,
            includeModelId: include.xai,
        }),
        cohere: buildModelsFromModelsDevProvider({
            provider: 'cohere',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'cohere',
            defaultModelId: defaults.cohere,
            includeModelId: include.cohere,
        }),
        minimax: buildModelsFromModelsDevProvider({
            provider: 'minimax',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'minimax',
            defaultModelId: defaults.minimax,
            includeModelId: include.minimax,
        }),
        glm: buildModelsFromModelsDevProvider({
            provider: 'glm',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'zhipuai',
            defaultModelId: defaults.glm,
            includeModelId: include.glm,
        }),
        openrouter: buildModelsFromModelsDevProvider({
            provider: 'openrouter',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'openrouter',
            defaultModelId: undefined,
            includeModelId: include.openrouter,
        }),
        litellm: [],
        glama: [],
        vertex: [
            ...buildModelsFromModelsDevProvider({
                provider: 'vertex',
                modelsDevApi: modelsDevJson,
                modelsDevProviderId: 'google-vertex',
                defaultModelId: defaults.vertex,
                includeModelId: include.vertex,
            }),
            ...buildModelsFromModelsDevProvider({
                provider: 'vertex',
                modelsDevApi: modelsDevJson,
                modelsDevProviderId: 'google-vertex-anthropic',
                defaultModelId: undefined,
                includeModelId: include.vertex,
            }),
        ].sort((a, b) => a.name.localeCompare(b.name)),
        bedrock: buildModelsFromModelsDevProvider({
            provider: 'bedrock',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'amazon-bedrock',
            defaultModelId: defaults.bedrock,
            includeModelId: include.bedrock,
        })
            // Normalize AWS region-prefixed IDs to the canonical unprefixed ID.
            .map((m) => ({ ...m, name: m.name.replace(/^(eu\\.|us\\.|global\\.)/i, '') }))
            // De-dupe after stripping prefixes.
            .filter((m, idx, arr) => arr.findIndex((x) => x.name === m.name) === idx)
            .sort((a, b) => a.name.localeCompare(b.name)),
        local: [],
        ollama: [],
        dexto: [],
    };

    const header = `// This file is auto-generated by scripts/sync-llm-registry.ts\n// Do not edit manually - run 'pnpm run sync-llm-registry' to update\n`;
    const body = `
import type { LLMProvider } from '../types.js';
import type { ModelInfo } from './index.js';

export const MODELS_BY_PROVIDER = ${JSON.stringify(modelsByProvider, null, 4)} satisfies Record<
    LLMProvider,
    ModelInfo[]
>;
`;

    const prettierConfig = (await prettier.resolveConfig(OUTPUT_PATH)) ?? undefined;
    const formatted = await prettier.format(header + body, {
        ...prettierConfig,
        parser: 'typescript',
        filepath: OUTPUT_PATH,
    });

    if (CHECK_MODE) {
        if (!fs.existsSync(OUTPUT_PATH)) {
            console.error(
                `❌ Missing generated file: ${path.relative(process.cwd(), OUTPUT_PATH)}`
            );
            console.error(`   Run: pnpm run sync-llm-registry\n`);
            process.exit(1);
        }
        const existing = fs.readFileSync(OUTPUT_PATH, 'utf-8');
        if (existing !== formatted) {
            console.error('❌ LLM registry snapshot is out of date!');
            console.error(`   File: ${path.relative(process.cwd(), OUTPUT_PATH)}`);
            console.error('   Run: pnpm run sync-llm-registry\n');
            process.exit(1);
        }
        console.log('✅ LLM registry snapshot is up-to-date');
        return;
    }

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, formatted, 'utf-8');
    console.log(`✓ Wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

syncLlmRegistry().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
