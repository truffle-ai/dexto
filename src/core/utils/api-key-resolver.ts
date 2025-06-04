/**
 * Utility for resolving API keys from environment variables.
 * This consolidates the API key resolution logic used across CLI and core components.
 */

// Map the provider to its corresponding API key name (in order of preference)
export const PROVIDER_API_KEY_MAP: Record<string, string[]> = {
    openai: ['OPENAI_API_KEY', 'OPENAI_KEY'],
    anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_KEY', 'CLAUDE_API_KEY'],
    google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    groq: ['GROQ_API_KEY'],
    cohere: ['COHERE_API_KEY'],
    xai: ['XAI_API_KEY', 'X_AI_API_KEY'],
    perplexity: ['PERPLEXITY_API_KEY'],
    together: ['TOGETHER_API_KEY'],
    fireworks: ['FIREWORKS_API_KEY'],
    deepseek: ['DEEPSEEK_API_KEY'],
};

/**
 * Resolves API key for a given provider from environment variables.
 *
 * @param provider The LLM provider
 * @returns Resolved API key or undefined if not found
 */
export function resolveApiKeyForProvider(provider: string): string | undefined {
    const envVars = PROVIDER_API_KEY_MAP[provider.toLowerCase()];
    if (!envVars) {
        return undefined;
    }

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
export function getPrimaryApiKeyEnvVar(provider: string): string {
    const envVars = PROVIDER_API_KEY_MAP[provider.toLowerCase()];
    return envVars?.[0] || `${provider.toUpperCase()}_API_KEY`;
}
