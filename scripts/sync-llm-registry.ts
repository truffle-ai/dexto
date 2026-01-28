#!/usr/bin/env tsx
/**
 * Syncs Dexto's built-in LLM model registry from models.dev + OpenRouter's public catalog.
 *
 * Why:
 * - `packages/core/src/llm/registry.ts` used to hardcode many models (tokens/pricing/modalities),
 *   which is painful to maintain.
 * - models.dev provides a maintained, cross-provider model catalog.
 * - OpenRouter's public catalog is used to map "native" model IDs to OpenRouter model IDs for
 *   gateway providers (openrouter/dexto).
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

const OUTPUT_PATH = path.join(__dirname, '../packages/core/src/llm/registry-models.generated.ts');

const MODELS_DEV_URL = 'https://models.dev/api.json';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

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

type OpenRouterModel = {
    id: string;
    name: string;
    context_length?: number;
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
                    input: typeof limit.input === 'number' ? limit.input : undefined,
                    output: typeof limit.output === 'number' ? limit.output : undefined,
                    ...limit,
                },
                modalities: isRecord(m.modalities)
                    ? {
                          input: parseModalitiesArray(m.modalities.input),
                          output: parseModalitiesArray(m.modalities.output),
                          ...m.modalities,
                      }
                    : undefined,
                cost:
                    isRecord(m.cost) &&
                    typeof m.cost.input === 'number' &&
                    typeof m.cost.output === 'number'
                        ? {
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
                              ...m.cost,
                          }
                        : undefined,
                ...m,
            };

            parsedProvider.models[modelId] = parsedModel;
        }

        api[providerId] = parsedProvider;
    }

    return api;
}

function parseOpenRouterModels(json: unknown): OpenRouterModel[] {
    const root = requireRecord(json, 'OpenRouter /models response');
    const data = root.data;
    if (!Array.isArray(data)) {
        throw new Error(`Expected OpenRouter /models response 'data' to be an array`);
    }
    const models: OpenRouterModel[] = [];
    for (const entry of data) {
        if (!isRecord(entry)) continue;
        const id = entry.id;
        const name = entry.name;
        if (typeof id !== 'string' || typeof name !== 'string') continue;
        const context_length =
            typeof entry.context_length === 'number' ? entry.context_length : undefined;
        models.push({ id, name, context_length, ...entry });
    }
    return models;
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
    pricing?: GeneratedModelPricing;
    openrouterId?: string;
    default?: boolean;
};

function normalizeDisplayName(name: string): string {
    return name
        .toLowerCase()
        .replace(/\(latest\)/g, '')
        .replace(/\s+v\d+\b/g, (m) => m.trim()) // keep "v2" token but normalize spacing
        .replace(/\s+/g, ' ')
        .trim();
}

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
        openrouterId?: string;
    }
): GeneratedModelInfo {
    return {
        name: model.id,
        displayName: model.name,
        maxInputTokens: model.limit.input ?? model.limit.context,
        supportedFileTypes: getSupportedFileTypesFromModel(options.provider, model),
        pricing: getPricing(model),
        openrouterId: options.openrouterId,
        ...(options.defaultModelId === model.id ? { default: true } : {}),
    };
}

function groupOpenRouterModelsByPrefix(models: OpenRouterModel[]): Map<string, OpenRouterModel[]> {
    const map = new Map<string, OpenRouterModel[]>();
    for (const model of models) {
        const [prefix] = model.id.split('/');
        if (!prefix) continue;
        const existing = map.get(prefix) ?? [];
        existing.push(model);
        map.set(prefix, existing);
    }
    return map;
}

function findOpenRouterIdForModel(params: {
    openrouterPrefix: string;
    modelsDevModel: ModelsDevModel;
    openrouterByPrefix: Map<string, OpenRouterModel[]>;
}): string | undefined {
    const { openrouterPrefix, modelsDevModel, openrouterByPrefix } = params;

    const candidates = openrouterByPrefix.get(openrouterPrefix) ?? [];
    if (candidates.length === 0) return undefined;

    const targetName = normalizeDisplayName(modelsDevModel.name);

    // 1) Exact name match (best effort)
    const byName = candidates.filter((m) => normalizeDisplayName(m.name) === targetName);
    if (byName.length === 1) return byName[0]?.id;
    if (byName.length > 1) {
        // Prefer matching context length, if present
        const wanted = modelsDevModel.limit.context;
        const exactContext = byName.find((m) => m.context_length === wanted);
        return exactContext?.id ?? byName[0]?.id;
    }

    // 2) Common ID patterns
    const openrouterIds = new Set(candidates.map((m) => m.id));
    const direct = `${openrouterPrefix}/${modelsDevModel.id}`;
    if (openrouterIds.has(direct)) return direct;

    // Google/Gemini often uses a "-001" suffix on OpenRouter IDs
    if (openrouterPrefix.toLowerCase() === 'google') {
        const with001 = `${openrouterPrefix}/${modelsDevModel.id}-001`;
        if (openrouterIds.has(with001)) return with001;
    }

    const withoutLatest = `${openrouterPrefix}/${modelsDevModel.id.replace(/-chat-latest$/i, '-chat')}`;
    if (openrouterIds.has(withoutLatest)) return withoutLatest;

    const withoutGeneralLatest = `${openrouterPrefix}/${modelsDevModel.id.replace(/-latest$/i, '')}`;
    if (openrouterIds.has(withoutGeneralLatest)) return withoutGeneralLatest;

    // Anthropic-style: "4-5" -> "4.5" (OpenRouter uses dots)
    if (openrouterPrefix.toLowerCase() === 'anthropic') {
        const noDate = modelsDevModel.id.replace(/-\d{8}.*$/i, '');
        const dotted = noDate.replace(/-(\d)-(\d)\b/g, '-$1.$2');
        const anthroCandidate = `${openrouterPrefix}/${dotted}`;
        if (openrouterIds.has(anthroCandidate)) return anthroCandidate;
    }

    return undefined;
}

function buildModelsFromModelsDevProvider(params: {
    provider: DextoProvider;
    modelsDevApi: ModelsDevApi;
    modelsDevProviderId: string;
    defaultModelId?: string;
    includeModelId: (modelId: string) => boolean;
    openrouterPrefix?: string;
    openrouterByPrefix: Map<string, OpenRouterModel[]>;
}): GeneratedModelInfo[] {
    const {
        provider,
        modelsDevApi,
        modelsDevProviderId,
        defaultModelId,
        includeModelId,
        openrouterPrefix,
        openrouterByPrefix,
    } = params;

    const modelsDevProvider = modelsDevApi[modelsDevProviderId];
    if (!modelsDevProvider) {
        throw new Error(
            `models.dev provider '${modelsDevProviderId}' not found (needed for dexto provider '${provider}')`
        );
    }

    const results: GeneratedModelInfo[] = [];
    for (const [modelId, model] of Object.entries(modelsDevProvider.models)) {
        if (!includeModelId(modelId)) continue;

        const openrouterId =
            openrouterPrefix && provider !== 'vertex' && provider !== 'bedrock'
                ? findOpenRouterIdForModel({
                      openrouterPrefix,
                      modelsDevModel: model,
                      openrouterByPrefix,
                  })
                : undefined;

        results.push(modelToGeneratedModel(model, { provider, defaultModelId, openrouterId }));
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

    const openrouterRes = await fetch(OPENROUTER_MODELS_URL, {
        headers: { 'User-Agent': 'dexto-sync-llm-registry' },
        signal: AbortSignal.timeout(30_000),
    });
    if (!openrouterRes.ok) {
        throw new Error(
            `Failed to fetch OpenRouter models (${openrouterRes.status} ${openrouterRes.statusText})`
        );
    }
    const openrouterModels = parseOpenRouterModels(await openrouterRes.json());
    const openrouterByPrefix = groupOpenRouterModelsByPrefix(openrouterModels);

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
    } as const;

    const modelsByProvider: Record<DextoProvider, GeneratedModelInfo[]> = {
        openai: buildModelsFromModelsDevProvider({
            provider: 'openai',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'openai',
            defaultModelId: defaults.openai,
            includeModelId: include.openai,
            openrouterPrefix: 'openai',
            openrouterByPrefix,
        }),
        'openai-compatible': [],
        anthropic: buildModelsFromModelsDevProvider({
            provider: 'anthropic',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'anthropic',
            defaultModelId: defaults.anthropic,
            includeModelId: include.anthropic,
            openrouterPrefix: 'anthropic',
            openrouterByPrefix,
        }),
        google: buildModelsFromModelsDevProvider({
            provider: 'google',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'google',
            defaultModelId: defaults.google,
            includeModelId: include.google,
            openrouterPrefix: 'google',
            openrouterByPrefix,
        }),
        groq: buildModelsFromModelsDevProvider({
            provider: 'groq',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'groq',
            defaultModelId: defaults.groq,
            includeModelId: include.groq,
            openrouterByPrefix,
        }),
        xai: buildModelsFromModelsDevProvider({
            provider: 'xai',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'xai',
            defaultModelId: defaults.xai,
            includeModelId: include.xai,
            openrouterPrefix: 'x-ai',
            openrouterByPrefix,
        }),
        cohere: buildModelsFromModelsDevProvider({
            provider: 'cohere',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'cohere',
            defaultModelId: defaults.cohere,
            includeModelId: include.cohere,
            openrouterPrefix: 'cohere',
            openrouterByPrefix,
        }),
        minimax: buildModelsFromModelsDevProvider({
            provider: 'minimax',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'minimax',
            defaultModelId: defaults.minimax,
            includeModelId: include.minimax,
            openrouterPrefix: 'minimax',
            openrouterByPrefix,
        }),
        glm: buildModelsFromModelsDevProvider({
            provider: 'glm',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'zhipuai',
            defaultModelId: defaults.glm,
            includeModelId: include.glm,
            openrouterPrefix: 'z-ai',
            openrouterByPrefix,
        }),
        openrouter: [],
        litellm: [],
        glama: [],
        vertex: [
            ...buildModelsFromModelsDevProvider({
                provider: 'vertex',
                modelsDevApi: modelsDevJson,
                modelsDevProviderId: 'google-vertex',
                defaultModelId: defaults.vertex,
                includeModelId: include.vertex,
                openrouterByPrefix,
            }),
            ...buildModelsFromModelsDevProvider({
                provider: 'vertex',
                modelsDevApi: modelsDevJson,
                modelsDevProviderId: 'google-vertex-anthropic',
                defaultModelId: undefined,
                includeModelId: include.vertex,
                openrouterByPrefix,
            }),
        ].sort((a, b) => a.name.localeCompare(b.name)),
        bedrock: buildModelsFromModelsDevProvider({
            provider: 'bedrock',
            modelsDevApi: modelsDevJson,
            modelsDevProviderId: 'amazon-bedrock',
            defaultModelId: defaults.bedrock,
            includeModelId: include.bedrock,
            openrouterByPrefix,
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
import type { LLMProvider } from './types.js';
import type { ModelInfo } from './registry.js';

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
