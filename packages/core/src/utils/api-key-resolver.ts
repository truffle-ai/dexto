import type { LLMProvider } from '../llm/types.js';
import { PROVIDERS_BY_ID } from '../llm/providers.generated.js';

/**
 * Utility for resolving API keys from environment variables.
 *
 * This is intentionally derived from the committed models.dev provider snapshot so we can
 * support many providers without maintaining a giant hardcoded map.
 */

const EXTRA_API_KEY_ENV_VARS: Record<string, string[]> = {
    openai: ['OPENAI_KEY'],
    anthropic: ['ANTHROPIC_KEY', 'CLAUDE_API_KEY'],
    google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    xai: ['X_AI_API_KEY'],
    zhipuai: ['ZHIPUAI_API_KEY'],
} as const;

function isLikelyApiKeyEnvVar(name: string): boolean {
    return /(API_KEY|API_TOKEN|TOKEN|SECRET)\b/i.test(name);
}

function uniqueInOrder(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result;
}

export function getApiKeyEnvVarsForProvider(provider: LLMProvider): string[] {
    // Providers that don't use a single API key string
    if (
        provider === 'google-vertex' ||
        provider === 'google-vertex-anthropic' ||
        provider === 'local' ||
        provider === 'ollama'
    ) {
        return [];
    }

    // Bedrock supports an optional bearer token for the Converse API.
    // When absent, auth is handled via AWS credential chain (env/roles/SSO).
    if (provider === 'amazon-bedrock') {
        return ['AWS_BEARER_TOKEN_BEDROCK'];
    }

    const snapshot = PROVIDERS_BY_ID[provider];
    const fromSnapshot = snapshot?.env ?? [];
    const filtered = fromSnapshot.filter(isLikelyApiKeyEnvVar);
    const extras = EXTRA_API_KEY_ENV_VARS[provider] ?? [];
    return uniqueInOrder([...filtered, ...extras]);
}

/**
 * Resolves API key for a given provider from environment variables.
 *
 * @param provider The LLM provider
 * @returns Resolved API key or undefined if not found
 */
export function resolveApiKeyForProvider(provider: LLMProvider): string | undefined {
    const envVars = getApiKeyEnvVarsForProvider(provider);

    // Try each environment variable in order of preference
    for (const envVar of envVars) {
        const value = process.env[envVar];
        if (value && value.trim()) {
            return value.trim();
        }
    }

    return undefined;
}

/**
 * Gets the primary environment variable name for a provider (for display/error messages).
 *
 * @param provider The LLM provider
 * @returns Primary environment variable name
 */
export function getPrimaryApiKeyEnvVar(provider: LLMProvider): string {
    const envVars = getApiKeyEnvVarsForProvider(provider);
    return envVars[0] || `${provider.toUpperCase()}_API_KEY`;
}
