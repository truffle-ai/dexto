import type { LLMProvider } from './types.js';
import type { ModelInfo } from './registry/index.js';
import { LLM_REGISTRY } from './registry/index.js';
import { CURATED_MODEL_IDS_BY_PROVIDER } from './curation-config.js';

type CuratedModelsOptions = {
    /**
     * Maximum number of models to return.
     */
    max?: number;
};

const DEFAULT_MAX = 8;

/**
 * Returns a small, UI-friendly set of models for a provider.
 *
 * This is intentionally explicit. The curated model IDs are defined in `CURATED_MODEL_IDS_BY_PROVIDER`.
 */
export function getCuratedModelsForProvider(
    provider: LLMProvider,
    options?: CuratedModelsOptions
): ModelInfo[] {
    const providerInfo = LLM_REGISTRY[provider];
    const models = providerInfo.models ?? [];

    if (models.length === 0) return [];

    const max = options?.max ?? DEFAULT_MAX;

    const curatedIds = CURATED_MODEL_IDS_BY_PROVIDER[provider];
    if (!Array.isArray(curatedIds) || curatedIds.length === 0) {
        return [];
    }

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

    return picked;
}
