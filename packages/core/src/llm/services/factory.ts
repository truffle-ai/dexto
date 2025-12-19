import { ToolManager } from '../../tools/tool-manager.js';
import { ValidatedLLMConfig } from '../schemas.js';
import { LLMError } from '../errors.js';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGroq } from '@ai-sdk/groq';
import { createXai } from '@ai-sdk/xai';
import { createVertex } from '@ai-sdk/google-vertex';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import { VercelLLMService } from './vercel.js';
import { LanguageModel } from 'ai';
import { SessionEventBus } from '../../events/index.js';
import { createCohere } from '@ai-sdk/cohere';
import type { IConversationHistoryProvider } from '../../session/history/types.js';
import type { SystemPromptManager } from '../../systemPrompt/manager.js';
import type { IDextoLogger } from '../../logger/v2/types.js';

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
            // OpenAI-compatible - requires baseURL, uses chat completions endpoint
            // Must use .chat() as most compatible endpoints (like Ollama) don't support Responses API
            const baseURL = getOpenAICompatibleBaseURL(llmConfig);
            if (!baseURL) {
                throw LLMError.baseUrlMissing('openai-compatible');
            }
            return createOpenAI({ apiKey, baseURL }).chat(model);
        }
        case 'openrouter': {
            // OpenRouter - unified API gateway for 100+ models
            // baseURL is auto-injected by resolver, but we validate it here as well
            const baseURL = llmConfig.baseURL || 'https://openrouter.ai/api/v1';
            return createOpenAI({ apiKey, baseURL }).chat(model);
        }
        case 'litellm': {
            // LiteLLM - OpenAI-compatible proxy for 100+ LLM providers
            // User must provide their own LiteLLM proxy URL
            const baseURL = llmConfig.baseURL;
            if (!baseURL) {
                throw LLMError.baseUrlMissing('litellm');
            }
            return createOpenAI({ apiKey, baseURL }).chat(model);
        }
        case 'glama': {
            // Glama - OpenAI-compatible gateway for multiple LLM providers
            // Fixed endpoint, no user configuration needed
            const baseURL = 'https://glama.ai/api/gateway/openai/v1';
            return createOpenAI({ apiKey, baseURL }).chat(model);
        }
        case 'vertex': {
            // Google Vertex AI - supports both Gemini and Claude models
            // Auth via Application Default Credentials (ADC)
            // TODO: Integrate with agent config (llmConfig.vertex?.projectId) as primary,
            // falling back to env vars. This would allow per-agent Vertex configuration.
            const projectId = process.env.GOOGLE_VERTEX_PROJECT;
            if (!projectId) {
                throw LLMError.missingConfig(
                    'vertex',
                    'GOOGLE_VERTEX_PROJECT environment variable'
                );
            }
            const location = process.env.GOOGLE_VERTEX_LOCATION;

            // Route based on model type: Claude models use /anthropic subpath
            if (model.includes('claude')) {
                // Claude models on Vertex use the /anthropic subpath export
                // Default to us-east5 for Claude (limited region availability)
                return createVertexAnthropic({
                    project: projectId,
                    location: location || 'us-east5',
                })(model);
            }

            // Gemini models use the main export
            // Default to us-central1 for Gemini (widely available)
            return createVertex({
                project: projectId,
                location: location || 'us-central1',
            })(model);
        }
        // TODO: Add 'dexto' case (similar to openrouter, uses https://api.dexto.ai/v1)
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
            throw LLMError.unsupportedProvider(provider);
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

/**
 * Create an LLM service instance using the Vercel AI SDK.
 * All providers are routed through the unified Vercel service.
 *
 * @param config LLM configuration from the config file
 * @param toolManager Unified tool manager instance
 * @param systemPromptManager Prompt manager for system prompts
 * @param historyProvider History provider for conversation persistence
 * @param sessionEventBus Session-level event bus for emitting LLM events
 * @param sessionId Session ID
 * @param resourceManager Resource manager for blob storage and resource access
 * @param logger Logger instance for dependency injection
 * @returns VercelLLMService instance
 */
export function createLLMService(
    config: ValidatedLLMConfig,
    toolManager: ToolManager,
    systemPromptManager: SystemPromptManager,
    historyProvider: IConversationHistoryProvider,
    sessionEventBus: SessionEventBus,
    sessionId: string,
    resourceManager: import('../../resources/index.js').ResourceManager,
    logger: IDextoLogger
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
        resourceManager,
        logger
    );
}
