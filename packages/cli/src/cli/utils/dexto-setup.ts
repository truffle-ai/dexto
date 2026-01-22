// packages/cli/src/cli/utils/dexto-setup.ts

import { getDextoApiKey } from '../auth/index.js';
import {
    getAllModelsForProvider,
    transformModelNameForProvider,
    type ModelInfo,
    type LLMProvider,
} from '@dexto/core';

/**
 * Default model for Dexto provider (used as fallback)
 * Uses OpenRouter model format since Dexto proxies to OpenRouter
 */
export const DEFAULT_DEXTO_MODEL = 'anthropic/claude-sonnet-4-5-20250929';

/** Model info with original provider for dexto */
export type DextoModelInfo = ModelInfo & { originalProvider?: LLMProvider };

/**
 * Check if user can use Dexto provider (has DEXTO_API_KEY)
 * This checks both the auth config and environment variable
 */
export async function canUseDextoProvider(): Promise<boolean> {
    // Check auth config first (from dexto login)
    const apiKey = await getDextoApiKey();
    if (apiKey) return true;

    // Fallback to environment variable
    return Boolean(process.env.DEXTO_API_KEY);
}

/**
 * Get the default model for Dexto provider
 */
export function getDefaultDextoModel(): string {
    return DEFAULT_DEXTO_MODEL;
}

/**
 * Get all models available through Dexto, grouped by original provider
 */
export function getDextoModels(): Map<LLMProvider, DextoModelInfo[]> {
    const allModels = getAllModelsForProvider('dexto');
    const grouped = new Map<LLMProvider, DextoModelInfo[]>();

    for (const model of allModels) {
        const provider = model.originalProvider || 'dexto';
        if (!grouped.has(provider)) {
            grouped.set(provider, []);
        }
        grouped.get(provider)!.push(model);
    }

    return grouped;
}

/**
 * Get a flat list of recommended models for quick selection
 * Returns models marked as default from each provider
 */
export function getRecommendedDextoModels(): DextoModelInfo[] {
    const allModels = getAllModelsForProvider('dexto');
    // Return default models from each provider, plus some popular ones
    const recommended = allModels.filter((m) => m.default);

    // If no defaults, return first model from each provider
    if (recommended.length === 0) {
        const grouped = getDextoModels();
        for (const [, models] of grouped) {
            if (models.length > 0) {
                recommended.push(models[0]!);
            }
        }
    }

    return recommended;
}

/**
 * Transform a model name to OpenRouter format for dexto
 */
export function transformModelForDexto(model: string, originalProvider: LLMProvider): string {
    return transformModelNameForProvider(model, originalProvider, 'dexto');
}
