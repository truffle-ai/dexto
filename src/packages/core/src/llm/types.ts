import { LLMProvider, LLMRouter } from './registry.js';

/**
 * LLMRouter defines the routing backend for LLM service instantiation.
 * 'vercel' = use Vercel LLM service, 'in-built' = use in-built LLM service
 * This type is now defined in the registry as the source of truth.
 */
/**
 * Context interface for message formatters.
 * Provides runtime information for model-aware processing.
 */

export interface LLMContext {
    /** LLM provider name (e.g., 'google.generative-ai', 'openai') */
    provider: LLMProvider;

    /** Specific LLM model name (e.g., 'gemini-2.5-flash', 'gpt-4') */
    model: string;
}

// TODO: see how we can combine this with LLMContext
export interface LLMUpdateContext {
    provider?: LLMProvider;
    model?: string;
    router?: LLMRouter;
    suggestedAction?: string;
}
