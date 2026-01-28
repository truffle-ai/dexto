import type { LLMProvider } from './types.js';
import type { ModelInfo } from './registry.js';
import { LLM_REGISTRY, getDefaultModelForProvider } from './registry.js';
import { CURATED_MODEL_IDS_BY_PROVIDER } from './curation-config.js';

type CuratedModelsOptions = {
    /**
     * Minimum number of models to return when a provider has a fixed model list.
     * If the provider has fewer models than this, all models are returned.
     */
    min?: number;
    /**
     * Maximum number of models to return.
     */
    max?: number;
};

const DEFAULT_MIN = 3;
const DEFAULT_MAX = 8;

// Provider-specific preference hints for fallback curated selection (substring match against model IDs).
// This is only used when an explicit curated list isn't present or doesn't match any models.
const FALLBACK_PATTERNS_BY_PROVIDER: Partial<Record<LLMProvider, string[]>> = {
    openai: ['gpt-5', 'gpt-4.1', 'gpt-4o', 'o4', 'o3', 'gpt-4'],
    anthropic: ['claude-opus', 'claude-sonnet', 'claude-haiku'],
    google: ['gemini-3', 'gemini-2.5', 'gemini-2', 'gemini-1.5'],
    vertex: ['gemini-3', 'gemini-2.5', 'gemini-2', 'gemini-1.5'],
    xai: ['grok'],
    groq: ['llama', 'mixtral', 'gemma', 'qwen'],
    cohere: ['command-a', 'command-r'],
    minimax: ['minimax', 'm2'],
    glm: ['glm'],
    bedrock: ['claude', 'nova', 'llama', 'mistral'],
};

function uniqByNameCaseInsensitive(models: ModelInfo[]): ModelInfo[] {
    const seen = new Set<string>();
    const out: ModelInfo[] = [];
    for (const m of models) {
        const key = m.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(m);
    }
    return out;
}

function sortByCurationPreference(provider: LLMProvider, models: ModelInfo[]): ModelInfo[] {
    const patterns = (FALLBACK_PATTERNS_BY_PROVIDER[provider] ?? []).map((p) => p.toLowerCase());

    const defaultName = getDefaultModelForProvider(provider)?.toLowerCase();

    function patternRank(name: string): number {
        if (patterns.length === 0) return Number.POSITIVE_INFINITY;
        const lower = name.toLowerCase();
        for (let i = 0; i < patterns.length; i++) {
            const p = patterns[i]!;
            if (lower.includes(p)) return i;
        }
        return Number.POSITIVE_INFINITY;
    }

    return [...models].sort((a, b) => {
        const aIsDefault = defaultName ? a.name.toLowerCase() === defaultName : false;
        const bIsDefault = defaultName ? b.name.toLowerCase() === defaultName : false;
        if (aIsDefault !== bIsDefault) return aIsDefault ? -1 : 1;

        const aPattern = patternRank(a.name);
        const bPattern = patternRank(b.name);
        if (aPattern !== bPattern) return aPattern - bPattern;

        const aFiles = (a.supportedFileTypes?.length ?? 0) > 0;
        const bFiles = (b.supportedFileTypes?.length ?? 0) > 0;
        if (aFiles !== bFiles) return aFiles ? -1 : 1;

        const aPricing = a.pricing != null;
        const bPricing = b.pricing != null;
        if (aPricing !== bPricing) return aPricing ? -1 : 1;

        const aTokens = typeof a.maxInputTokens === 'number' ? a.maxInputTokens : 0;
        const bTokens = typeof b.maxInputTokens === 'number' ? b.maxInputTokens : 0;
        if (aTokens !== bTokens) return bTokens - aTokens;

        return a.name.localeCompare(b.name);
    });
}

/**
 * Returns a small, UI-friendly set of models for a provider.
 *
 * This is intentionally conservative:
 * - Never returns more than `max` models.
 * - Always includes the provider default when one exists.
 * - Uses lightweight provider-specific patterns + stable heuristics to pick additional models.
 *
 * Note: This is not intended to be a perfect "best models" list; it's a pragmatic curated view
 * to avoid dumping thousands of models into pickers by default.
 */
export function getCuratedModelsForProvider(
    provider: LLMProvider,
    options?: CuratedModelsOptions
): ModelInfo[] {
    const providerInfo = LLM_REGISTRY[provider];
    const models = providerInfo.models ?? [];

    if (models.length === 0) return [];

    const min = options?.min ?? DEFAULT_MIN;
    const max = options?.max ?? DEFAULT_MAX;

    // If an explicit curated list exists for this provider, use it as the source of truth.
    const curatedIds = CURATED_MODEL_IDS_BY_PROVIDER[provider];
    if (Array.isArray(curatedIds) && curatedIds.length > 0) {
        const byName = new Map<string, ModelInfo>();
        for (const m of models) {
            byName.set(m.name.toLowerCase(), m);
        }

        const picked: ModelInfo[] = [];
        const seen = new Set<string>();
        for (const id of curatedIds) {
            const key = id.toLowerCase();
            const m = byName.get(key);
            if (!m) continue;
            if (seen.has(key)) continue;
            seen.add(key);
            picked.push(m);
            if (picked.length >= max) break;
        }

        // If the curated list matched at least one model, return it (explicit ordering).
        // If it matched nothing (stale IDs), fall back to heuristic selection below.
        if (picked.length > 0) {
            return uniqByNameCaseInsensitive(picked);
        }
    }

    const sorted = sortByCurationPreference(provider, models);
    const defaultName = getDefaultModelForProvider(provider)?.toLowerCase();

    const picked: ModelInfo[] = [];
    const seen = new Set<string>();

    function add(model: ModelInfo | undefined): void {
        if (!model) return;
        const key = model.name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        picked.push(model);
    }

    if (defaultName) {
        add(sorted.find((m) => m.name.toLowerCase() === defaultName));
    }

    for (const m of sorted) {
        if (picked.length >= max) break;
        add(m);
        if (picked.length >= min) break;
    }

    // If provider has fewer models than min, return all (still capped by max).
    return uniqByNameCaseInsensitive(picked).slice(0, max);
}
