import type { LanguageModel } from 'ai';
import type { ContentInput } from '../../agent/types.js';
import type { ContextManager } from '../../context/manager.js';
import type { CompactionStrategy } from '../../context/compaction/types.js';
import type { SessionEventBus } from '../../events/index.js';
import type { Logger } from '../../logger/v2/types.js';
import type { ResourceManager } from '../../resources/index.js';
import type { ConversationHistoryProvider } from '../../session/history/types.js';
import type { MessageQueueService } from '../../session/message-queue.js';
import type { SystemPromptManager } from '../../systemPrompt/manager.js';
import type { ToolManager } from '../../tools/tool-manager.js';
import type { ToolSet } from '../../tools/types.js';
import type { LLMProvider } from '../types.js';
import type { ValidatedLLMConfig } from '../schemas.js';

/**
 * Configuration object returned by LLMService.getConfig()
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

export interface LLMService {
    stream(content: ContentInput, options?: { signal?: AbortSignal }): Promise<{ text: string }>;
    getAllTools(): Promise<ToolSet>;
    getEnabledTools(): Promise<ToolSet>;
    getConfig(): LLMServiceConfig;
    getContextManager(): ContextManager<unknown>;
    getMessageQueue(): MessageQueueService;
    getCompactionStrategy(): CompactionStrategy | null;
    getLanguageModel(): LanguageModel;
}

export interface LLMServiceFactoryInput {
    config: ValidatedLLMConfig;
    toolManager: ToolManager;
    systemPromptManager: SystemPromptManager;
    historyProvider: ConversationHistoryProvider;
    sessionEventBus: SessionEventBus;
    sessionId: string;
    resourceManager: ResourceManager;
    logger: Logger;
    options: CreateLLMServiceOptions;
}

export interface LLMServiceFactoryContext extends LLMServiceFactoryInput {
    createDefaultLLMService: () => LLMService;
}

export type LLMServiceFactory = (context: LLMServiceFactoryContext) => LLMService;

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
