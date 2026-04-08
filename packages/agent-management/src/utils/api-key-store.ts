import type { LLMProvider } from '@dexto/core';
import { getPrimaryApiKeyEnvVar, resolveApiKeyForProvider } from './api-key-resolver.js';
import { LLM_PROVIDERS } from '@dexto/core';
import { getDextoEnvPath } from './path.js';
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
    // Vertex AI uses ADC (Application Default Credentials), not API keys.
    // Setup instructions:
    // 1. Create a Google Cloud account and project
    // 2. Enable the Vertex AI API: gcloud services enable aiplatform.googleapis.com
    // 3. Enable desired Claude models (requires Anthropic Model Garden)
    // 4. Install Google Cloud CLI: https://cloud.google.com/sdk/docs/install
    // 5. Configure ADC: gcloud auth application-default login
    // 6. Set env vars: GOOGLE_VERTEX_PROJECT (required), GOOGLE_VERTEX_LOCATION (optional)
    //
    // TODO: Improve Vertex setup flow - add dedicated setup modal with these instructions
    // For now, we check GOOGLE_VERTEX_PROJECT as the "key" equivalent
    if (provider === 'google-vertex' || provider === 'google-vertex-anthropic') {
        const projectId = process.env.GOOGLE_VERTEX_PROJECT;
        return {
            hasApiKey: Boolean(projectId && projectId.trim()),
            envVar: 'GOOGLE_VERTEX_PROJECT',
        };
    }

    // Amazon Bedrock supports two auth methods:
    // 1. AWS_BEARER_TOKEN_BEDROCK - Bedrock API key (simplest, recommended for dev)
    // 2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION (IAM credentials, for production)
    //
    // We check for API key first, then fall back to checking AWS_REGION
    if (provider === 'amazon-bedrock') {
        const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
        if (apiKey && apiKey.trim()) {
            return {
                hasApiKey: true,
                envVar: 'AWS_BEARER_TOKEN_BEDROCK',
            };
        }
        // Fall back to checking AWS_REGION (implies IAM credentials)
        const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
        return {
            hasApiKey: Boolean(region && region.trim()),
            envVar: 'AWS_REGION',
        };
    }

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

/**
 * Providers that use a shared env var for API keys (vs per-endpoint like openai-compatible).
 * For these providers, we save to the env var if none exists, otherwise per-model override.
 */
export const SHARED_API_KEY_PROVIDERS = ['glama', 'openrouter', 'litellm'] as const;

export type ApiKeyStorageStrategy = {
    /** Save the key to provider env var (e.g., GLAMA_API_KEY) */
    saveToProviderEnvVar: boolean;
    /** Save the key as per-model override in custom model config */
    saveAsPerModel: boolean;
};

/**
 * Determine where to store an API key for a custom model.
 *
 * Logic:
 * - For glama/openrouter/litellm (shared env var providers):
 *   - If NO provider key exists → save to provider env var for reuse
 *   - If provider key EXISTS and user entered SAME key → don't save (uses fallback)
 *   - If provider key EXISTS and user entered DIFFERENT key → save as per-model override
 * - For openai-compatible: always save as per-model (each endpoint needs own key)
 *
 * @param provider - The custom model provider
 * @param userEnteredKey - The API key entered by user (trimmed, may be empty)
 * @param providerHasKey - Whether the provider already has a key configured
 * @param existingProviderKey - The existing provider key value (for comparison)
 */
export function determineApiKeyStorage(
    provider: string,
    userEnteredKey: string | undefined,
    providerHasKey: boolean,
    existingProviderKey: string | undefined
): ApiKeyStorageStrategy {
    const result: ApiKeyStorageStrategy = {
        saveToProviderEnvVar: false,
        saveAsPerModel: false,
    };

    if (!userEnteredKey) {
        return result;
    }

    const hasSharedEnvVarKey = (SHARED_API_KEY_PROVIDERS as readonly string[]).includes(provider);

    if (hasSharedEnvVarKey) {
        if (!providerHasKey) {
            // No provider key exists - save to provider env var for reuse
            result.saveToProviderEnvVar = true;
        } else if (existingProviderKey && userEnteredKey !== existingProviderKey) {
            // Provider has key but user entered different one - save as per-model override
            result.saveAsPerModel = true;
        }
        // If user entered same key as provider, don't save anything (uses fallback)
    } else {
        // openai-compatible: always save as per-model (each endpoint needs own key)
        result.saveAsPerModel = true;
    }

    return result;
}
