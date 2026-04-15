import type { CompactionStrategy } from '../../context/compaction/types.js';
import type { LanguageModel } from 'ai';
import type { CodexRateLimitSnapshot } from '../providers/codex-app-server.js';
import type { ValidatedLLMConfig } from '../schemas.js';
import type { LLMProvider } from '../types.js';

/**
 * Configuration object returned by the default session LLM service.
 */
export type LLMServiceConfig = {
    provider: LLMProvider;
    model: LanguageModel;
    configuredMaxInputTokens?: number | null;
    modelMaxInputTokens?: number | null;
};

export interface CreateLLMServiceOptions {
    usageScopeId?: string | undefined;
    compactionStrategy?: CompactionStrategy | null | undefined;
    cwd?: string | undefined;
}

/**
 * Context for model creation, including session info for usage tracking.
 */
export interface DextoProviderContext {
    /** Session ID for usage tracking */
    sessionId?: string;
    /** Client source for usage attribution (cli, web, sdk) */
    clientSource?: 'cli' | 'web' | 'sdk';
    /** Working directory for providers that need an explicit workspace root. */
    cwd?: string;
    /** Optional callback for ChatGPT Login rate-limit status updates from Codex. */
    onCodexRateLimitStatus?: (snapshot: CodexRateLimitSnapshot) => void;
}

export interface LanguageModelFactoryInput {
    config: ValidatedLLMConfig;
    context: DextoProviderContext;
}

export interface LanguageModelFactoryContext extends LanguageModelFactoryInput {
    createDefaultLanguageModel: () => LanguageModel;
}

export type LanguageModelFactory = (context: LanguageModelFactoryContext) => LanguageModel;

/**
 * Token usage statistics from LLM
 */
export interface LLMTokenUsage {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}
