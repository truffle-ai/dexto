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
