import { ToolManager } from '../../tools/tool-manager.js';
import { ValidatedLLMConfig } from '../schemas.js';
import { LLMError } from '../errors.js';
import { createOpenAI } from '@ai-sdk/openai';
import { resolveRouting } from '../routing.js';

// Dexto Gateway headers for usage tracking
const DEXTO_GATEWAY_HEADERS = {
    SESSION_ID: 'X-Dexto-Session-ID',
    CLIENT_SOURCE: 'X-Dexto-Source',
    CLIENT_VERSION: 'X-Dexto-Version',
} as const;

/**
 * Context for model creation, including session info for usage tracking.
 *
 * Dexto routing is handled automatically by the routing module, which reads
 * DEXTO_API_KEY from the environment (set by CLI from auth.json if logged in).
 *
 * @see packages/core/src/llm/routing.ts for routing logic
 */
export interface DextoProviderContext {
    /** Session ID for usage tracking */
    sessionId?: string;
}
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
import type { IDextoLogger } from '../../logger/v2/types.js';
import { requiresApiKey, resolveModelOrigin, transformModelNameForProvider } from '../registry.js';
import { getPrimaryApiKeyEnvVar } from '../../utils/api-key-resolver.js';
import type { CompactionConfigInput } from '../../context/compaction/schemas.js';

export function createVercelModel(
    llmConfig: ValidatedLLMConfig,
    context?: DextoProviderContext
): LanguageModel {
    // Resolve routing: if user is logged into Dexto (DEXTO_API_KEY env var set)
    // and provider is routeable, automatically route through api.dexto.ai
    const routingDecision = resolveRouting({
        provider: llmConfig.provider,
        model: llmConfig.model,
        directApiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseURL,
        // dextoApiKey read from process.env.DEXTO_API_KEY by routing module
    });

    // Use effective values from routing decision
    const provider = routingDecision.effectiveProvider;
    const model = routingDecision.effectiveModel;
    const apiKey = routingDecision.apiKey;
    const baseURL = routingDecision.baseURL;

    // Runtime check: if provider requires API key but none is configured, fail with helpful message
    // This catches cases where relaxed validation allowed app to start without API key
    if (requiresApiKey(provider) && !apiKey?.trim()) {
        const envVar = getPrimaryApiKeyEnvVar(provider);
        throw LLMError.apiKeyMissing(provider, envVar);
    }

    switch (provider.toLowerCase()) {
        case 'openai': {
            // Regular OpenAI - strict compatibility, no baseURL
            // API key is required - use empty string if not provided (SDK will fail with clear error)
            return createOpenAI({ apiKey: apiKey ?? '' })(model);
        }
        case 'openai-compatible': {
            // OpenAI-compatible - requires baseURL, uses chat completions endpoint
            // Must use .chat() as most compatible endpoints (like Ollama) don't support Responses API
            // API key is optional - local providers like Ollama don't need one
            // Strip trailing slashes from config baseURL, fallback to env var
            const compatibleBaseURL =
                baseURL?.replace(/\/$/, '') || process.env.OPENAI_BASE_URL?.replace(/\/$/, '');
            if (!compatibleBaseURL) {
                throw LLMError.baseUrlMissing('openai-compatible');
            }
            return createOpenAI({ apiKey: apiKey ?? '', baseURL: compatibleBaseURL }).chat(model);
        }
        case 'openrouter': {
            // OpenRouter - unified API gateway for 100+ models
            // baseURL is auto-injected by resolver, but we validate it here as well
            const orBaseURL = baseURL || 'https://openrouter.ai/api/v1';
            return createOpenAI({ apiKey: apiKey ?? '', baseURL: orBaseURL }).chat(model);
        }
        case 'litellm': {
            // LiteLLM - OpenAI-compatible proxy for 100+ LLM providers
            // User must provide their own LiteLLM proxy URL
            // API key is optional - proxy handles auth internally
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
        case 'dexto': {
            // Dexto Gateway - OpenAI-compatible proxy with per-request billing
            // Routes through api.dexto.ai to OpenRouter, deducts from user balance
            // Requires DEXTO_API_KEY from `dexto login`
            //
            // Model name transformation:
            // - If model is from another provider (e.g., 'gpt-5-mini'), transform to OpenRouter format
            // - If model already has prefix (e.g., 'openai/gpt-5-mini'), use as-is
            const dextoBaseURL = 'https://api.dexto.ai/v1';

            // Resolve the model's original provider and transform the name
            const origin = resolveModelOrigin(model, 'dexto');
            const transformedModel = origin
                ? transformModelNameForProvider(model, origin.provider, 'dexto')
                : model; // If not found in registry, use as-is (custom model)

            // Build headers for usage tracking
            const headers: Record<string, string> = {
                [DEXTO_GATEWAY_HEADERS.CLIENT_SOURCE]: 'cli',
            };
            if (context?.sessionId) {
                headers[DEXTO_GATEWAY_HEADERS.SESSION_ID] = context.sessionId;
            }
            if (process.env.DEXTO_CLI_VERSION) {
                headers[DEXTO_GATEWAY_HEADERS.CLIENT_VERSION] = process.env.DEXTO_CLI_VERSION;
            }

            return createOpenAI({ apiKey: apiKey ?? '', baseURL: dextoBaseURL, headers }).chat(
                transformedModel
            );
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
            // API key required - SDK will fail with clear error if empty
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
    logger: IDextoLogger,
    compactionStrategy?: import('../../context/compaction/types.js').ICompactionStrategy | null,
    compactionConfig?: CompactionConfigInput
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
        compactionStrategy,
        compactionConfig
    );
}
