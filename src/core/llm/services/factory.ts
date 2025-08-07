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
import { LanguageModelV1 } from 'ai';
import { SessionEventBus } from '../../events/index.js';
import { LLMRouter } from '../registry.js';
import { ContextManager } from '../../context/manager.js';
import { createCohere } from '@ai-sdk/cohere';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Create an instance of one of our in-built LLM services
 * @param config LLM configuration from the config file
 * @param toolManager Unified tool manager instance
 * @param sessionEventBus Session-level event bus for emitting LLM events
 * @param contextManager Message manager instance
 * @param sessionId Session ID
 * @returns ILLMService instance
 */
function _createInBuiltLLMService(
    config: ValidatedLLMConfig,
    toolManager: ToolManager,
    sessionEventBus: SessionEventBus,
    contextManager: ContextManager,
    sessionId: string
): ILLMService {
    const apiKey = config.apiKey;

    switch (config.provider.toLowerCase()) {
        case 'openai': {
            // Regular OpenAI - no baseURL support
            const openai = new OpenAI({ apiKey });
            return new OpenAIService(
                toolManager,
                openai,
                sessionEventBus,
                contextManager,
                config.model,
                config.maxIterations,
                sessionId
            );
        }
        case 'openai-compatible': {
            // OpenAI-compatible - requires baseURL
            const baseURL = getOpenAICompatibleBaseURL(config);
            const openai = new OpenAI({ apiKey, baseURL });
            return new OpenAIService(
                toolManager,
                openai,
                sessionEventBus,
                contextManager,
                config.model,
                config.maxIterations,
                sessionId
            );
        }
        case 'anthropic': {
            const anthropic = new Anthropic({ apiKey });
            return new AnthropicService(
                toolManager,
                anthropic,
                sessionEventBus,
                contextManager,
                config.model,
                config.maxIterations,
                sessionId
            );
        }
        default:
            throw LLMError.unsupportedRouter('in-built', config.provider);
    }
}

function _createVercelModel(llmConfig: ValidatedLLMConfig): LanguageModelV1 {
    const provider = llmConfig.provider;
    const model = llmConfig.model;
    const apiKey = llmConfig.apiKey;

    switch (provider.toLowerCase()) {
        case 'openai': {
            // Regular OpenAI - strict compatibility, no baseURL
            return createOpenAI({ apiKey, compatibility: 'strict' })(model);
        }
        case 'openai-compatible': {
            // OpenAI-compatible - requires baseURL, uses compatible mode
            const baseURL = getOpenAICompatibleBaseURL(llmConfig);
            return createOpenAI({ apiKey, baseURL, compatibility: 'compatible' })(model);
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
    sessionEventBus: SessionEventBus,
    contextManager: ContextManager,
    sessionId: string
): VercelLLMService {
    const model = _createVercelModel(config);

    return new VercelLLMService(
        toolManager,
        model,
        config.provider,
        sessionEventBus,
        contextManager,
        config.maxIterations,
        sessionId,
        config.temperature,
        config.maxOutputTokens,
        config.baseURL
    );
}

/**
 * Enum/type for LLM routing backend selection.
 */
export function createLLMService(
    config: ValidatedLLMConfig,
    router: LLMRouter,
    toolManager: ToolManager,
    sessionEventBus: SessionEventBus,
    contextManager: ContextManager,
    sessionId: string
): ILLMService {
    if (router === 'vercel') {
        return _createVercelLLMService(
            config,
            toolManager,
            sessionEventBus,
            contextManager,
            sessionId
        );
    } else {
        return _createInBuiltLLMService(
            config,
            toolManager,
            sessionEventBus,
            contextManager,
            sessionId
        );
    }
}
