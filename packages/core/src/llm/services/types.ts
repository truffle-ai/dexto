import type { CompactionStrategy } from '../../context/compaction/types.js';
import type { LanguageModel } from 'ai';
import type { CodexRateLimitSnapshot } from '../providers/codex-app-server.js';
import type { ValidatedLLMConfig } from '../schemas.js';
import type { LlmAuthResolver } from '../auth/types.js';
import type { Logger } from '../../logger/v2/types.js';
import type { LLMProvider } from '@dexto/llm';
import type { MessageQueueService } from '../../session/message-queue.js';
import type { AgentRunContext } from '../../runtime/run-context.js';
import type { TurnDriverState } from '../executor/turn-executor.js';

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
    executionControl?: LLMExecutionControl | undefined;
    cwd?: string | undefined;
    authResolver?: LlmAuthResolver | null | undefined;
    steerQueue: MessageQueueService;
    followUpQueue: MessageQueueService;
}

export type LLMExecutionControl = {
    /**
     * Local/CLI sessions can let core continue the same executor turn with queued follow-ups.
     * Hosted runtimes should keep follow-ups durable and promote them as separate runs.
     */
    followUpQueueMode?: 'core-continuation' | 'host-run' | undefined;
};

export type CreateTurnDriverOptions = {
    streaming?: boolean;
    signal?: AbortSignal;
    runContext?: AgentRunContext;
    state?: TurnDriverState;
};

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
    /** Runtime auth resolver for profile-backed API keys, OAuth, and external accounts. */
    authResolver?: LlmAuthResolver | null;
    /** Logger for non-secret runtime provider/auth observability. */
    logger?: Logger | undefined;
    /** Optional callback for ChatGPT Login rate-limit status updates from Codex. */
    onCodexRateLimitStatus?: (snapshot: CodexRateLimitSnapshot) => void;
}

export interface LanguageModelFactoryInput {
    config: ValidatedLLMConfig;
    context: DextoProviderContext;
}

export interface LanguageModelFactoryContext extends LanguageModelFactoryInput {
    createDefaultLanguageModel: () => Promise<LanguageModel>;
}

export type LanguageModelFactory = (context: LanguageModelFactoryContext) => Promise<LanguageModel>;

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
