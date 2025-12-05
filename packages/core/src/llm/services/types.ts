import { LanguageModel } from 'ai';
import type { LLMProvider } from '../types.js';

/**
 * Configuration object returned by LLMService.getConfig()
 */
export type LLMServiceConfig = {
    provider: LLMProvider;
    model: LanguageModel;
    configuredMaxInputTokens?: number | null;
    modelMaxInputTokens?: number | null;
};

/**
 * Token usage statistics from LLM
 */
export interface LLMTokenUsage {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    totalTokens: number;
}
