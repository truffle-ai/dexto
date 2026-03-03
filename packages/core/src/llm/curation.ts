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

type CuratedModelRefsOptions = {
    /**
     * Providers to include in selection order.
     */
    providers: readonly LLMProvider[];
    /**
     * Maximum number of model refs to return.
     */
    max?: number;
};

const DEFAULT_MAX = 8;
export type CuratedModelRef = {
    provider: LLMProvider;
    model: string;
};

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
    if (max <= 0) return [];

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

/**
 * Returns curated provider/model refs interleaved across providers.
 *
 * This prevents early providers from consuming the entire featured budget.
 */
export function getCuratedModelRefsForProviders(
    options: CuratedModelRefsOptions
): CuratedModelRef[] {
    const max = options.max ?? DEFAULT_MAX;
    if (max <= 0 || options.providers.length === 0) {
        return [];
    }

    const providerCurated = options.providers.map((provider) => ({
        provider,
        models: getCuratedModelsForProvider(provider, { max }),
    }));
    const cursorByProvider = new Array<number>(providerCurated.length).fill(0);
    const picked: CuratedModelRef[] = [];
    const seen = new Set<string>();

    let madeProgress = true;
    while (picked.length < max && madeProgress) {
        madeProgress = false;

        for (let i = 0; i < providerCurated.length; i++) {
            const bucket = providerCurated[i]!;
            let cursor = cursorByProvider[i]!;

            while (cursor < bucket.models.length) {
                const modelName = bucket.models[cursor]!.name;
                cursor += 1;

                const key = `${bucket.provider}|${modelName}`.toLowerCase();
                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                cursorByProvider[i] = cursor;
                picked.push({
                    provider: bucket.provider,
                    model: modelName,
                });
                madeProgress = true;
                break;
            }

            cursorByProvider[i] = cursor;

            if (picked.length >= max) {
                break;
            }
        }
    }

    return picked;
}
