/**
 * LLM Routing Module
 *
 * Handles transparent routing of LLM requests through the Dexto gateway.
 * When a user is logged into Dexto, requests to supported providers
 * are automatically routed through api.dexto.ai (which proxies to OpenRouter).
 *
 * Key concepts:
 * - Dexto-routeable providers: anthropic, openai, google, groq, xai, cohere, openrouter
 * - Direct-only providers: bedrock, vertex (own cloud auth), local providers
 * - Auth state determines routing: logged in = use Dexto, logged out = use direct API keys
 *
 * @see feature-plans/dexto-unified-model-provider.md for full architecture
 */

import type { LLMProvider } from './types.js';

/**
 * Providers that can be routed through the Dexto gateway.
 * These providers have their models available via OpenRouter,
 * which Dexto proxies to with its own billing layer.
 */
export const DEXTO_ROUTEABLE_PROVIDERS: readonly LLMProvider[] = [
    'anthropic',
    'openai',
    'google',
    'groq',
    'xai',
    'cohere',
    'openrouter', // Already in OpenRouter format, routes through Dexto when logged in
] as const;

/**
 * Providers that must always use direct API calls.
 * These either use their own cloud auth (bedrock, vertex) or run locally.
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
 * Check if a provider can be routed through the Dexto gateway.
 *
 * @param provider - The LLM provider to check
 * @returns true if the provider's requests can route through Dexto
 */
export function shouldRouteThroughDexto(provider: LLMProvider): boolean {
    return (DEXTO_ROUTEABLE_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Check if a provider must always use direct API calls.
 *
 * @param provider - The LLM provider to check
 * @returns true if the provider cannot route through Dexto
 */
export function isDirectOnlyProvider(provider: LLMProvider): boolean {
    return (DIRECT_ONLY_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Transform a model name to OpenRouter format for the Dexto gateway.
 *
 * OpenRouter uses the format "provider/model-name", e.g.:
 * - "claude-sonnet-4" → "anthropic/claude-sonnet-4"
 * - "gpt-4o" → "openai/gpt-4o"
 *
 * @param model - The model name in native provider format
 * @param provider - The original provider
 * @returns Model name in OpenRouter format
 */
export function transformModelForDexto(model: string, provider: LLMProvider): string {
    // If already in OpenRouter format (has a slash), return as-is
    if (model.includes('/')) {
        return model;
    }

    // OpenRouter provider doesn't need transformation (already in OR format)
    if (provider === 'openrouter') {
        return model;
    }

    // Dexto provider is the gateway itself - should not transform
    if (provider === 'dexto') {
        return model;
    }

    // Add provider prefix for OpenRouter format
    return `${provider}/${model}`;
}

/**
 * Routing decision for an LLM request.
 */
export interface RoutingDecision {
    /** Whether to route through Dexto gateway or direct to provider */
    routeThrough: 'dexto' | 'direct';
    /** Provider to use (may differ from original if routing through Dexto) */
    effectiveProvider: LLMProvider;
    /** Model name to use (may be transformed for Dexto) */
    effectiveModel: string;
    /** API key to use */
    apiKey: string;
    /** Base URL override (for direct providers that need it) */
    baseURL?: string | undefined;
}

/**
 * Options for resolving routing decision.
 */
export interface RoutingOptions {
    /** Original provider from config */
    provider: LLMProvider;
    /** Original model from config */
    model: string;
    /** Direct API key for the provider (from config or env) */
    directApiKey?: string | undefined;
    /** Base URL override for the provider */
    baseURL?: string | undefined;
    /** Dexto API key (if user is logged into Dexto) */
    dextoApiKey?: string | undefined;
}

/**
 * Resolve the routing decision for an LLM request.
 *
 * Decision logic:
 * 1. If provider is direct-only (bedrock, vertex, local) → always use direct
 * 2. If user has Dexto API key and provider is routeable → route through Dexto
 * 3. If user has direct API key → use direct
 * 4. If no credentials → return error decision (let caller handle)
 *
 * The Dexto API key is read from:
 * 1. options.dextoApiKey (if explicitly provided)
 * 2. process.env.DEXTO_API_KEY (set by CLI from auth.json if user is logged in)
 *
 * @param options - Routing options
 * @returns Routing decision
 */
export function resolveRouting(options: RoutingOptions): RoutingDecision {
    const { provider, model, directApiKey, baseURL } = options;
    // Get Dexto API key from options or environment (CLI sets this from auth.json)
    const dextoApiKey = options.dextoApiKey ?? process.env.DEXTO_API_KEY;

    // 1. Direct-only providers always use direct routing
    if (isDirectOnlyProvider(provider)) {
        return {
            routeThrough: 'direct',
            effectiveProvider: provider,
            effectiveModel: model,
            apiKey: directApiKey || '',
            baseURL,
        };
    }

    // 2. If already using dexto provider, no transformation needed
    if (provider === 'dexto') {
        return {
            routeThrough: 'dexto',
            effectiveProvider: 'dexto',
            effectiveModel: model,
            apiKey: dextoApiKey || directApiKey || '',
        };
    }

    // 3. If user is logged into Dexto and provider is routeable → use Dexto
    if (dextoApiKey && shouldRouteThroughDexto(provider)) {
        return {
            routeThrough: 'dexto',
            effectiveProvider: 'dexto',
            effectiveModel: transformModelForDexto(model, provider),
            apiKey: dextoApiKey,
        };
    }

    // 4. Fall back to direct provider
    return {
        routeThrough: 'direct',
        effectiveProvider: provider,
        effectiveModel: model,
        apiKey: directApiKey || '',
        baseURL,
    };
}
