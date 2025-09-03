import type { LLMProvider } from '../llm/types.js';
import { LLM_PROVIDERS } from '../llm/types.js';
import { getPrimaryApiKeyEnvVar, resolveApiKeyForProvider } from './api-key-resolver.js';
import { updateEnvFile } from './env.js';
import { getDextoEnvPath } from './path.js';

/**
 * Save provider API key to the correct .env and make it immediately available in-process.
 * Never returns the key; only metadata for callers to display.
 */
export async function saveProviderApiKey(
    provider: LLMProvider,
    apiKey: string,
    startPath?: string
): Promise<{ envVar: string; targetEnvPath: string }> {
    if (!provider) throw new Error('provider is required');
    if (!apiKey || !apiKey.trim()) throw new Error('apiKey is required');

    const envVar = getPrimaryApiKeyEnvVar(provider);
    const targetEnvPath = getDextoEnvPath(startPath);

    await updateEnvFile(targetEnvPath, { [envVar]: apiKey });

    // Make key immediately available to the running process
    process.env[envVar] = apiKey;

    return { envVar, targetEnvPath };
}

/**
 * Get key presence and primary env var name for a provider.
 */
export function getProviderKeyStatus(provider: LLMProvider): {
    hasApiKey: boolean;
    envVar: string;
} {
    const envVar = getPrimaryApiKeyEnvVar(provider);
    const key = resolveApiKeyForProvider(provider);
    return { hasApiKey: Boolean(key && key.trim()), envVar };
}

/**
 * List key presence across all known providers.
 */
export function listProviderKeyStatus(): Record<string, { hasApiKey: boolean; envVar: string }> {
    const result: Record<string, { hasApiKey: boolean; envVar: string }> = {};
    for (const p of LLM_PROVIDERS) {
        result[p] = getProviderKeyStatus(p);
    }
    return result;
}
