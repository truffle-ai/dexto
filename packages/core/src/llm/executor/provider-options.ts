/**
 * Provider-specific options builder for Vercel AI SDK's streamText/generateText.
 *
 * Centralizes provider-specific configuration that requires explicit opt-in:
 * - Anthropic: cacheControl for prompt caching, sendReasoning for extended thinking
 * - Bedrock/Vertex Claude: Same as Anthropic (Claude models on these platforms)
 * - Google: thinkingConfig for Gemini thinking models
 * - OpenAI: reasoningEffort for o1/o3/codex/gpt-5 models
 *
 * Caching notes:
 * - Anthropic: Requires explicit cacheControl option (we enable it)
 * - OpenAI: Automatic for prompts ≥1024 tokens (no config needed)
 * - Google: Implicit caching automatic for Gemini 2.5+ (≥1024 tokens for Flash,
 *   ≥2048 for Pro). Explicit caching requires pre-created cachedContent IDs.
 * All providers return cached token counts in the response (cachedInputTokens).
 */

import type { LLMProvider } from '../types.js';
import { isReasoningCapableModel } from '../registry/index.js';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ProviderOptionsConfig {
    provider: LLMProvider;
    model: string;
    reasoningEffort?: ReasoningEffort | undefined;
}

/**
 * Build provider-specific options for streamText/generateText.
 *
 * @param config Provider, model, and optional reasoning effort configuration
 * @returns Provider options object or undefined if no special options needed
 */
export function buildProviderOptions(
    config: ProviderOptionsConfig
): Record<string, Record<string, unknown>> | undefined {
    const { provider, model, reasoningEffort } = config;
    const modelLower = model.toLowerCase();

    // Anthropic: Enable prompt caching and reasoning streaming
    if (provider === 'anthropic') {
        return {
            anthropic: {
                // Enable prompt caching - saves money and improves latency
                cacheControl: { type: 'ephemeral' },
                // Stream reasoning/thinking content when model supports it
                sendReasoning: true,
            },
        };
    }

    // Bedrock: Enable caching and reasoning for Claude models
    if (provider === 'bedrock' && modelLower.includes('claude')) {
        return {
            bedrock: {
                cacheControl: { type: 'ephemeral' },
                sendReasoning: true,
            },
        };
    }

    // Vertex: Enable caching and reasoning for Claude models
    if (provider === 'vertex' && modelLower.includes('claude')) {
        return {
            'vertex-anthropic': {
                cacheControl: { type: 'ephemeral' },
                sendReasoning: true,
            },
        };
    }

    // Google: Enable thinking for models that support it
    // Note: Google automatically enables thinking for thinking models,
    // but we explicitly enable includeThoughts to receive the reasoning
    if (provider === 'google' || (provider === 'vertex' && !modelLower.includes('claude'))) {
        return {
            google: {
                thinkingConfig: {
                    // Include thoughts in the response for transparency
                    includeThoughts: true,
                },
            },
        };
    }

    // OpenAI: Set reasoning effort for reasoning-capable models
    // Use config value if provided, otherwise auto-detect based on model
    if (provider === 'openai') {
        const effectiveEffort = reasoningEffort ?? getDefaultReasoningEffort(model);
        if (effectiveEffort) {
            return {
                openai: {
                    reasoningEffort: effectiveEffort,
                },
            };
        }
    }

    return undefined;
}

/**
 * Determine the default reasoning effort for OpenAI models.
 *
 * OpenAI reasoning effort levels (from lowest to highest):
 * - 'none': No reasoning, fastest responses
 * - 'low': Minimal reasoning, fast responses
 * - 'medium': Balanced reasoning (OpenAI's recommended daily driver)
 * - 'high': Thorough reasoning for complex tasks
 * - 'xhigh': Extra high reasoning for quality-critical, non-latency-sensitive tasks
 *
 * Default strategy:
 * - Reasoning-capable models (codex, o1, o3, gpt-5): 'medium' - OpenAI's recommended default
 * - Other models: undefined (no reasoning effort needed)
 *
 * @param model The model name
 * @returns Reasoning effort level or undefined if not applicable
 */
export function getDefaultReasoningEffort(
    model: string
): Exclude<ReasoningEffort, 'none'> | undefined {
    // Use the centralized registry function for capability detection
    if (isReasoningCapableModel(model)) {
        // 'medium' is OpenAI's recommended daily driver for reasoning models
        return 'medium';
    }

    // Other models don't need explicit reasoning effort
    return undefined;
}
