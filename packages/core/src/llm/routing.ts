/**
 * LLM Provider Utilities
 *
 * Helper functions for provider classification and model name handling.
 * With explicit providers, routing is determined by config (provider field),
 * not by auth state at runtime.
 *
 * Key concepts:
 * - `provider: dexto` → Uses Dexto gateway (api.dexto.ai), model IDs in OpenRouter format
 * - `provider: anthropic/openai/etc` → Uses native provider APIs directly
 * - `provider: openrouter` → Uses OpenRouter directly (advanced BYOK)
 *
 * @see feature-plans/holistic-dexto-auth-analysis/ for design decisions
 */

import type { LLMProvider } from './types.js';

/**
 * Providers that require their own cloud authentication and cannot use Dexto gateway.
 * These use their own billing (AWS, GCP) or run locally.
 */
export const DIRECT_ONLY_PROVIDERS: readonly LLMProvider[] = [
    'bedrock', // AWS credentials, billing to AWS account
    'vertex', // Google ADC, billing to GCP account
    'ollama', // Local model server
    'local', // Native node-llama-cpp
    'openai-compatible', // User's own endpoint
    'litellm', // User's own proxy
    'glama', // Fixed endpoint gateway
] as const;

/**
 * Check if a provider must always use direct API calls.
 * These providers cannot route through any gateway.
 *
 * @param provider - The LLM provider to check
 * @returns true if the provider requires direct API access
 */
export function isDirectOnlyProvider(provider: LLMProvider): boolean {
    return (DIRECT_ONLY_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Transform a model name to OpenRouter format.
 *
 * OpenRouter uses the format "provider/model-name", e.g.:
 * - "claude-sonnet-4" → "anthropic/claude-sonnet-4"
 * - "gpt-4o" → "openai/gpt-4o"
 *
 * This is used when displaying models or for providers that use OpenRouter format.
 *
 * @param model - The model name in native provider format
 * @param provider - The original provider
 * @returns Model name in OpenRouter format
 */
export function toOpenRouterFormat(model: string, provider: LLMProvider): string {
    // If already in OpenRouter format (has a slash), return as-is
    if (model.includes('/')) {
        return model;
    }

    // These providers already use OpenRouter format or don't need transformation
    if (provider === 'openrouter' || provider === 'dexto') {
        return model;
    }

    // Add provider prefix for OpenRouter format
    return `${provider}/${model}`;
}

// ============================================================================
// DEPRECATED - These exports are kept for backward compatibility during migration
// They will be removed once all consumers are updated
// ============================================================================

/**
 * @deprecated Use isDirectOnlyProvider() instead. With explicit providers,
 * there's no need to check "routeability" - the config determines routing.
 */
export const DEXTO_ROUTEABLE_PROVIDERS: readonly LLMProvider[] = [
    'anthropic',
    'openai',
    'google',
    'groq',
    'xai',
    'cohere',
    'openrouter',
] as const;

/**
 * @deprecated With explicit providers, this check is no longer needed.
 * The provider field in config directly determines where requests go.
 */
export function shouldRouteThroughDexto(provider: LLMProvider): boolean {
    return (DEXTO_ROUTEABLE_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * @deprecated Use toOpenRouterFormat() instead.
 */
export function transformModelForDexto(model: string, provider: LLMProvider): string {
    return toOpenRouterFormat(model, provider);
}
