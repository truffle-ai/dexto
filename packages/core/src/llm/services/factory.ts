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
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { VercelLLMService } from './vercel.js';
import { LanguageModel } from 'ai';
import { SessionEventBus } from '../../events/index.js';
import { createCohere } from '@ai-sdk/cohere';
import { createLocalLanguageModel } from '../providers/local/ai-sdk-adapter.js';
import type { IConversationHistoryProvider } from '../../session/history/types.js';
import type { SystemPromptManager } from '../../systemPrompt/manager.js';
import type { Logger } from '../../logger/v2/types.js';
import { requiresApiKey } from '../registry/index.js';
import { getPrimaryApiKeyEnvVar, resolveApiKeyForProvider } from '../../utils/api-key-resolver.js';

// Dexto Gateway headers for usage tracking
const DEXTO_GATEWAY_HEADERS = {
    SESSION_ID: 'X-Dexto-Session-ID',
    CLIENT_SOURCE: 'X-Dexto-Source',
    CLIENT_VERSION: 'X-Dexto-Version',
} as const;

/**
 * Context for model creation, including session info for usage tracking.
 */
export interface DextoProviderContext {
    /** Session ID for usage tracking */
    sessionId?: string;
    /** Client source for usage attribution (cli, web, sdk) */
    clientSource?: 'cli' | 'web' | 'sdk';
}

/**
 * Create a Vercel AI SDK LanguageModel from config.
 *
 * With explicit providers, the config's provider field directly determines
 * where requests go. No auth-dependent routing - what you configure is what runs.
 *
 * @param llmConfig - LLM configuration from agent config
 * @param context - Optional context for usage tracking (session ID, etc.)
 * @returns Vercel AI SDK LanguageModel instance
 */
export function createVercelModel(
    llmConfig: ValidatedLLMConfig,
    context?: DextoProviderContext
): LanguageModel {
    const { provider, model, baseURL } = llmConfig;
    const apiKey = llmConfig.apiKey || resolveApiKeyForProvider(provider);

    // Runtime check: if provider requires API key but none is configured, fail with helpful message
    if (requiresApiKey(provider) && !apiKey?.trim()) {
        const envVar = getPrimaryApiKeyEnvVar(provider);
        throw LLMError.apiKeyMissing(provider, envVar);
    }

    switch (provider.toLowerCase()) {
        case 'openai': {
            // Regular OpenAI - strict compatibility, no baseURL
            // Explicitly use the Responses API (default in AI SDK 5+).
            return createOpenAI({ apiKey: apiKey ?? '' }).responses(model);
        }
        case 'openai-compatible': {
            // OpenAI-compatible - requires baseURL, uses chat completions endpoint
            // Must use .chat() as most compatible endpoints (like Ollama) don't support Responses API
            const compatibleBaseURL =
                baseURL?.replace(/\/$/, '') || process.env.OPENAI_BASE_URL?.replace(/\/$/, '');
            if (!compatibleBaseURL) {
                throw LLMError.baseUrlMissing('openai-compatible');
            }
            return createOpenAI({ apiKey: apiKey ?? '', baseURL: compatibleBaseURL }).chat(model);
        }
        case 'openrouter': {
            // OpenRouter - unified API gateway for 100+ models (BYOK)
            // Model IDs are in OpenRouter format (e.g., 'anthropic/claude-sonnet-4-5-20250929')
            const orBaseURL = baseURL || 'https://openrouter.ai/api/v1';
            // Use Responses API (OpenAI-compatible) via /api/v1/responses
            return createOpenAI({ apiKey: apiKey ?? '', baseURL: orBaseURL }).responses(model);
        }
        case 'minimax': {
            // MiniMax - OpenAI-compatible endpoint
            const minimaxBaseURL = baseURL || 'https://api.minimax.chat/v1';
            return createOpenAI({ apiKey: apiKey ?? '', baseURL: minimaxBaseURL }).chat(model);
        }
        case 'glm': {
            // Zhipu AI (GLM) - OpenAI-compatible endpoint
            const glmBaseURL = baseURL || 'https://open.bigmodel.cn/api/paas/v4';
            return createOpenAI({ apiKey: apiKey ?? '', baseURL: glmBaseURL }).chat(model);
        }
        case 'litellm': {
            // LiteLLM - OpenAI-compatible proxy for 100+ LLM providers
            // User must provide their own LiteLLM proxy URL
            if (!baseURL) {
                throw LLMError.baseUrlMissing('litellm');
            }
            return createOpenAI({ apiKey: apiKey ?? '', baseURL }).chat(model);
        }
        case 'glama': {
            // Glama - OpenAI-compatible gateway for multiple LLM providers
            // Fixed endpoint, no user configuration needed
            const glamaBaseURL = 'https://glama.ai/api/gateway/openai/v1';
            return createOpenAI({ apiKey: apiKey ?? '', baseURL: glamaBaseURL }).chat(model);
        }
        case 'dexto-nova': {
            // Dexto Gateway - OpenAI-compatible proxy with per-request billing
            // Routes through api.dexto.ai to OpenRouter, deducts from user balance
            // Requires DEXTO_API_KEY from `dexto login`
            //
            // Model IDs are in OpenRouter format (e.g., 'anthropic/claude-sonnet-4-5-20250929')
            // Users explicitly choose `provider: dexto-nova` in their config
            //
            // Note: 402 "insufficient credits" errors are handled in turn-executor.ts mapProviderError()
            const dextoBaseURL = 'https://api.dexto.ai/v1';

            // Build headers for usage tracking
            const headers: Record<string, string> = {
                [DEXTO_GATEWAY_HEADERS.CLIENT_SOURCE]: context?.clientSource ?? 'cli',
            };
            if (context?.sessionId) {
                headers[DEXTO_GATEWAY_HEADERS.SESSION_ID] = context.sessionId;
            }
            if (process.env.DEXTO_CLI_VERSION) {
                headers[DEXTO_GATEWAY_HEADERS.CLIENT_VERSION] = process.env.DEXTO_CLI_VERSION;
            }

            // Model is already in OpenRouter format - pass through directly
            return createOpenAI({ apiKey: apiKey ?? '', baseURL: dextoBaseURL, headers }).chat(
                model
            );
        }
        case 'vertex': {
            // Google Vertex AI - supports both Gemini and Claude models
            // Auth via Application Default Credentials (ADC)
            //
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
        case 'bedrock': {
            // Amazon Bedrock - AWS-hosted gateway for Claude, Nova, Llama, Mistral
            // Auth via AWS credentials (env vars or credential provider)
            //
            // TODO: Add credentialProvider support for:
            // - ~/.aws/credentials file profiles (fromIni)
            // - AWS SSO sessions (fromSSO)
            // - IAM roles on EC2/Lambda (fromNodeProviderChain)
            // This would require adding @aws-sdk/credential-providers dependency
            // and exposing a config option like llmConfig.bedrock?.credentialProvider
            //
            // Current implementation: SDK reads directly from env vars:
            // - AWS_REGION (required)
            // - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (required)
            // - AWS_SESSION_TOKEN (optional, for temporary credentials)
            const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
            if (!region) {
                throw LLMError.missingConfig(
                    'bedrock',
                    'AWS_REGION or AWS_DEFAULT_REGION environment variable'
                );
            }

            // Auto-detect cross-region inference profile prefix based on user's region
            // Users can override by explicitly using prefixed model IDs (e.g., eu.anthropic.claude...)
            let modelId = model;
            const hasRegionPrefix =
                model.startsWith('eu.') || model.startsWith('us.') || model.startsWith('global.');
            if (!hasRegionPrefix) {
                const prefix = region.startsWith('eu-') ? 'eu.' : 'us.';
                modelId = `${prefix}${model}`;
            }

            // SDK automatically reads AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN
            return createAmazonBedrock({ region })(modelId);
        }
        case 'anthropic':
            return createAnthropic({ apiKey: apiKey ?? '' })(model);
        case 'google':
            return createGoogleGenerativeAI({ apiKey: apiKey ?? '' })(model);
        case 'groq':
            return createGroq({ apiKey: apiKey ?? '' })(model);
        case 'xai':
            return createXai({ apiKey: apiKey ?? '' })(model);
        case 'cohere':
            return createCohere({ apiKey: apiKey ?? '' })(model);
        case 'ollama': {
            // Ollama - local model server with OpenAI-compatible API
            // Uses the /v1 endpoint for AI SDK compatibility
            // Default URL: http://localhost:11434
            const ollamaBaseURL = baseURL || 'http://localhost:11434/v1';
            // Ollama doesn't require an API key, but the SDK needs a non-empty string
            return createOpenAI({ apiKey: 'ollama', baseURL: ollamaBaseURL }).chat(model);
        }
        case 'local': {
            // Native node-llama-cpp execution via AI SDK adapter.
            // Model is loaded lazily on first use.
            return createLocalLanguageModel({
                modelId: model,
            });
        }
        default:
            throw LLMError.unsupportedProvider(provider);
    }
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
 * @param compactionStrategy Optional compaction strategy for context management
 * @param compactionConfig Optional compaction configuration for thresholds
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
    logger: Logger,
    compactionStrategy?: import('../../context/compaction/types.js').CompactionStrategy | null
): VercelLLMService {
    const model = createVercelModel(config, { sessionId });

    return new VercelLLMService(
        toolManager,
        model,
        systemPromptManager,
        historyProvider,
        sessionEventBus,
        config,
        sessionId,
        resourceManager,
        logger,
        compactionStrategy
    );
}
