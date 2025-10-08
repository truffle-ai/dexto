import { ToolManager } from '../../tools/tool-manager.js';
import { ILLMService } from './types.js';
import { ValidatedLLMConfig } from '../schemas.js';
import { LLMError } from '../errors.js';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGroq } from '@ai-sdk/groq';
import { createXai } from '@ai-sdk/xai';
import { VercelLLMService } from './vercel.js';
import { OpenAIService } from './openai.js';
import { AnthropicService } from './anthropic.js';
import { LanguageModel } from 'ai';
import { SessionEventBus } from '../../events/index.js';
import type { LLMRouter } from '../types.js';
import { createCohere } from '@ai-sdk/cohere';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { IConversationHistoryProvider } from '../../session/history/types.js';
import type { SystemPromptManager } from '../../systemPrompt/manager.js';

/**
 * Create an instance of one of our in-built LLM services
 * @param config LLM configuration from the config file
 * @param toolManager Unified tool manager instance
 * @param systemPromptManager Prompt manager for system prompts
 * @param historyProvider History provider for conversation persistence
 * @param sessionEventBus Session-level event bus for emitting LLM events
 * @param sessionId Session ID
 * @param resourceManager Resource manager for blob storage and resource access
 * @returns ILLMService instance
 */
function _createInBuiltLLMService(
    config: ValidatedLLMConfig,
    toolManager: ToolManager,
    systemPromptManager: SystemPromptManager,
    historyProvider: IConversationHistoryProvider,
    sessionEventBus: SessionEventBus,
    sessionId: string,
    resourceManager?: import('../../resources/index.js').ResourceManager
): ILLMService {
    const apiKey = config.apiKey;

    switch (config.provider.toLowerCase()) {
        case 'openai': {
            // Regular OpenAI - no baseURL support
            const openai = new OpenAI({ apiKey });
            return new OpenAIService(
                toolManager,
                openai,
                systemPromptManager,
                historyProvider,
                sessionEventBus,
                config,
                sessionId,
                resourceManager
            );
        }
        case 'openai-compatible': {
            // OpenAI-compatible - requires baseURL
            const baseURL = getOpenAICompatibleBaseURL(config);
            const openai = new OpenAI({ apiKey, baseURL });
            return new OpenAIService(
                toolManager,
                openai,
                systemPromptManager,
                historyProvider,
                sessionEventBus,
                config,
                sessionId,
                resourceManager
            );
        }
        case 'anthropic': {
            const anthropic = new Anthropic({ apiKey });
            return new AnthropicService(
                toolManager,
                anthropic,
                systemPromptManager,
                historyProvider,
                sessionEventBus,
                config,
                sessionId,
                resourceManager
            );
        }
        default:
            throw LLMError.unsupportedRouter('in-built', config.provider);
    }
}

function _createVercelModel(llmConfig: ValidatedLLMConfig): LanguageModel {
    const provider = llmConfig.provider;
    const model = llmConfig.model;
    const apiKey = llmConfig.apiKey;

    switch (provider.toLowerCase()) {
        case 'openai': {
            // Regular OpenAI - strict compatibility, no baseURL
            return createOpenAI({ apiKey })(model);
        }
        case 'openai-compatible': {
            // OpenAI-compatible - requires baseURL, uses compatible mode
            const baseURL = getOpenAICompatibleBaseURL(llmConfig);
            if (!baseURL) {
                throw LLMError.baseUrlMissing('openai-compatible');
            }
            return createOpenAI({ apiKey, baseURL })(model);
        }
        case 'anthropic':
            return createAnthropic({ apiKey })(model);
        case 'google':
            return createGoogleGenerativeAI({ apiKey })(model);
        case 'groq':
            return createGroq({ apiKey })(model);
        case 'xai':
            return createXai({ apiKey })(model);
        case 'cohere':
            return createCohere({ apiKey })(model);
        default:
            throw LLMError.unsupportedRouter('vercel', provider);
    }
}

/**
 * Overrides a default base URL for OpenAI compatible models - this allows adding openai compatibles
 * Hierarchy: we first check the config file, then the environment variable
 * Regex checks for trailing slashes and removes them
 * @param llmConfig LLM configuration from the config file
 * @returns Base URL or empty string if not found
 */
function getOpenAICompatibleBaseURL(llmConfig: ValidatedLLMConfig): string {
    if (llmConfig.baseURL) {
        return llmConfig.baseURL.replace(/\/$/, '');
    }
    // Check for environment variable as fallback
    if (process.env.OPENAI_BASE_URL) {
        return process.env.OPENAI_BASE_URL.replace(/\/$/, '');
    }
    return '';
}

function _createVercelLLMService(
    config: ValidatedLLMConfig,
    toolManager: ToolManager,
    systemPromptManager: SystemPromptManager,
    historyProvider: IConversationHistoryProvider,
    sessionEventBus: SessionEventBus,
    sessionId: string,
    // TODO: (355) Make resourceManager argument mandatory everywhere. it's always defined
    // https://github.com/truffle-ai/dexto/pull/355#discussion_r2413029197
    resourceManager?: import('../../resources/index.js').ResourceManager
): VercelLLMService {
    const model = _createVercelModel(config);

    return new VercelLLMService(
        toolManager,
        model,
        systemPromptManager,
        historyProvider,
        sessionEventBus,
        config,
        sessionId,
        resourceManager
    );
}

/**
 * Enum/type for LLM routing backend selection.
 */
export function createLLMService(
    config: ValidatedLLMConfig,
    router: LLMRouter,
    toolManager: ToolManager,
    systemPromptManager: SystemPromptManager,
    historyProvider: IConversationHistoryProvider,
    sessionEventBus: SessionEventBus,
    sessionId: string,
    // TODO: (355) Mandatory
    // https://github.com/truffle-ai/dexto/pull/355#discussion_r2413030069
    resourceManager?: import('../../resources/index.js').ResourceManager
): ILLMService {
    if (router === 'vercel') {
        return _createVercelLLMService(
            config,
            toolManager,
            systemPromptManager,
            historyProvider,
            sessionEventBus,
            sessionId,
            resourceManager
        );
    } else {
        return _createInBuiltLLMService(
            config,
            toolManager,
            systemPromptManager,
            historyProvider,
            sessionEventBus,
            sessionId,
            resourceManager
        );
    }
}
