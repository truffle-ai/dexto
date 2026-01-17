// packages/cli/src/cli/utils/dexto-setup.ts

import { getDextoApiKey } from '../auth/index.js';

/**
 * Default model for Dexto provider
 * Uses OpenRouter model format since Dexto proxies to OpenRouter
 */
export const DEFAULT_DEXTO_MODEL = 'anthropic/claude-4.5-sonnet';

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
