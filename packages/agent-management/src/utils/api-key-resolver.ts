import type { LLMProvider } from '@dexto/core';

/**
 * Utility for resolving API keys from environment variables.
 * This consolidates the API key resolution logic used across CLI and core components.
 */

// Map the provider to its corresponding API key name (in order of preference)
export const PROVIDER_API_KEY_MAP: Record<LLMProvider, string[]> = {
    openai: ['OPENAI_API_KEY', 'OPENAI_KEY'],
    'openai-compatible': ['OPENAI_API_KEY', 'OPENAI_KEY'], // Uses same keys as openai
    anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_KEY', 'CLAUDE_API_KEY'],
    google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    groq: ['GROQ_API_KEY'],
    cohere: ['COHERE_API_KEY'],
    xai: ['XAI_API_KEY', 'X_AI_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
    litellm: ['LITELLM_API_KEY', 'LITELLM_KEY'],
    glama: ['GLAMA_API_KEY'],
    // Vertex uses ADC (Application Default Credentials), not API keys
    // GOOGLE_APPLICATION_CREDENTIALS points to service account JSON (optional)
    // Primary config is GOOGLE_VERTEX_PROJECT (required) + GOOGLE_VERTEX_LOCATION (optional)
    vertex: [],
    // Bedrock supports two auth methods:
    // 1. AWS_BEARER_TOKEN_BEDROCK - Bedrock API key (simplest)
    // 2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION (IAM credentials)
    // AWS_SESSION_TOKEN (optional, for temporary credentials)
    bedrock: ['AWS_BEARER_TOKEN_BEDROCK'],
    // Local providers don't require API keys
    local: [], // Native node-llama-cpp execution
    ollama: [], // Ollama server (may optionally use OLLAMA_API_KEY for remote servers)
    // Dexto gateway - requires key from `dexto login`
    dexto: ['DEXTO_API_KEY'],
    // perplexity: ['PERPLEXITY_API_KEY'],
    // together: ['TOGETHER_API_KEY'],
    // fireworks: ['FIREWORKS_API_KEY'],
    // deepseek: ['DEEPSEEK_API_KEY'],
};

/**
 * Resolves API key for a given provider from environment variables.
 *
 * @param provider The LLM provider
 * @returns Resolved API key or undefined if not found
 */
export function resolveApiKeyForProvider(provider: LLMProvider): string | undefined {
    const envVars = PROVIDER_API_KEY_MAP[provider];
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
export function getPrimaryApiKeyEnvVar(provider: LLMProvider): string {
    const envVars = PROVIDER_API_KEY_MAP[provider];
    return envVars?.[0] || `${provider.toUpperCase()}_API_KEY`;
}
