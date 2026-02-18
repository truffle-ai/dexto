// Derive types from registry constants without creating runtime imports.
export const LLM_PROVIDERS = [
    'openai',
    'openai-compatible',
    'anthropic',
    'google',
    'groq',
    'xai',
    'cohere',
    'minimax',
    'glm',
    'openrouter',
    'litellm',
    'glama',
    'vertex',
    'bedrock',
    'local', // Native node-llama-cpp execution (GGUF models)
    'ollama', // Ollama server integration
    'dexto-nova', // Dexto gateway - routes through api.dexto.ai/v1 with billing
] as const;
export type LLMProvider = (typeof LLM_PROVIDERS)[number];

export const SUPPORTED_FILE_TYPES = ['pdf', 'image', 'audio'] as const;
export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number];

// Reasoning tuning is intentionally a small, "preset" shaped knob.
// Supported presets vary by provider+model; validation happens at runtime.
export const REASONING_PRESETS = ['auto', 'off', 'low', 'medium', 'high', 'max', 'xhigh'] as const;
export type ReasoningPreset = (typeof REASONING_PRESETS)[number];

export interface LLMReasoningConfig {
    preset: ReasoningPreset;
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
