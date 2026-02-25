import { LLM_PROVIDERS as GENERATED_LLM_PROVIDERS } from './providers.generated.js';

// Derived from a committed models.dev provider snapshot (plus a small Dexto overlay).
export const LLM_PROVIDERS = GENERATED_LLM_PROVIDERS;
export type LLMProvider = (typeof LLM_PROVIDERS)[number];

export const SUPPORTED_FILE_TYPES = ['pdf', 'image', 'audio'] as const;
export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number];

// Reasoning tuning is provider/model-native.
// `variant` must match one of the variants exposed by getReasoningProfile(provider, model).
export type ReasoningVariant = string;

export interface LLMReasoningConfig {
    variant: ReasoningVariant;
    /**
     * Advanced escape hatch for budget-based providers (Anthropic/Gemini/Bedrock/OpenRouter).
     * Interpreted provider-specifically (e.g. "thinking budget", "reasoning max_tokens").
     */
    budgetTokens?: number | undefined;
}

/**
 * Context interface for message formatters.
 * Provides runtime information for model-aware processing.
 */

export interface LLMContext {
    /** LLM provider name (e.g., 'google', 'openai') */
    provider: LLMProvider;

    /** Specific LLM model name (e.g., 'gemini-2.5-flash', 'gpt-5') */
    model: string;
}

// TODO: see how we can combine this with LLMContext
export interface LLMUpdateContext {
    provider?: LLMProvider;
    model?: string;
    suggestedAction?: string;
}

export interface TokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    // Cache tokens (Vercel AI SDK: cachedInputTokens, providerMetadata.anthropic.cacheCreationInputTokens)
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}
