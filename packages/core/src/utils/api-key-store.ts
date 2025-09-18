import { LLM_PROVIDERS } from '@core/llm/types.js';
import type { LLMProvider } from '@core/llm/types.js';
import { getPrimaryApiKeyEnvVar, resolveApiKeyForProvider } from '@core/utils/api-key-resolver.js';
import { getDextoEnvPath } from '@core/utils/path.js';
import { updateEnvFile } from './env-file.js';

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

    process.env[envVar] = apiKey;

    return { envVar, targetEnvPath };
}

export function getProviderKeyStatus(provider: LLMProvider): {
    hasApiKey: boolean;
    envVar: string;
} {
    const envVar = getPrimaryApiKeyEnvVar(provider);
    const key = resolveApiKeyForProvider(provider);
    return { hasApiKey: Boolean(key && key.trim()), envVar };
}

export function listProviderKeyStatus(): Record<string, { hasApiKey: boolean; envVar: string }> {
    const result: Record<string, { hasApiKey: boolean; envVar: string }> = {};
    for (const provider of LLM_PROVIDERS) {
        result[provider] = getProviderKeyStatus(provider);
    }
    return result;
}
