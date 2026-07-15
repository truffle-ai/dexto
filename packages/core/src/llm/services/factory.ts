import { ToolManager } from '../../tools/tool-manager.js';
import { ValidatedLLMConfig } from '../schemas.js';
import { LLMError } from '../errors.js';
import { VercelLLMService } from './vercel.js';
import type { LanguageModel } from 'ai';
import { SessionEventBus } from '../../events/index.js';
import type { ConversationStore } from '../../storage/conversation/types.js';
import type { SystemPromptManager } from '../../systemPrompt/manager.js';
import type { Logger } from '../../logger/v2/types.js';
import type {
    CreateLLMServiceOptions,
    DextoProviderContext,
    LanguageModelFactory,
} from './types.js';
import type { LlmRuntimeAuthOverrides } from '../auth/types.js';
import {
    ANTHROPIC_BETA_HEADER,
    ANTHROPIC_INTERLEAVED_THINKING_BETA,
    requiresApiKey,
    supportsAnthropicInterleavedThinking,
    type LLMProvider,
} from '@dexto/llm';
import { getPrimaryApiKeyEnvVar, resolveApiKeyForProvider } from '../../utils/api-key-resolver.js';
import { isCodexBaseURL } from '../providers/codex-base-url.js';
import { findDextoProjectRoot } from '../../utils/execution-context.js';

function isLanguageModel(value: unknown): value is LanguageModel {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate['modelId'] === 'string' &&
        (typeof candidate['doGenerate'] === 'function' ||
            typeof candidate['doStream'] === 'function')
    );
}

const DEFAULT_DEXTO_GATEWAY_BASE_URL = 'https://app.dexto.ai/v1';

function trimTrailingSlash(value: string): string {
    return value.trim().replace(/\/$/, '');
}

function resolveDextoGatewayBaseURL(baseURL?: string): string {
    if (baseURL?.trim()) {
        return trimTrailingSlash(baseURL);
    }

    const envBaseURL = process.env.DEXTO_API_URL?.trim();
    if (!envBaseURL) {
        return DEFAULT_DEXTO_GATEWAY_BASE_URL;
    }

    const normalizedEnvBaseURL = trimTrailingSlash(envBaseURL);
    if (normalizedEnvBaseURL.endsWith('/v1')) {
        return normalizedEnvBaseURL;
    }

    return `${normalizedEnvBaseURL}/v1`;
}

// Dexto Gateway headers for usage tracking
const DEXTO_GATEWAY_HEADERS = {
    SESSION_ID: 'X-Dexto-Session-ID',
    CLIENT_SOURCE: 'X-Dexto-Source',
    CLIENT_VERSION: 'X-Dexto-Version',
} as const;

function resolveProviderWorkingDirectory(explicitCwd?: string): string {
    if (explicitCwd && explicitCwd.trim().length > 0) {
        return explicitCwd;
    }

    return findDextoProjectRoot(process.cwd()) ?? process.cwd();
}

function mergeHeaders(
    base: Record<string, string> | undefined,
    override: Record<string, string> | undefined
): Record<string, string> | undefined {
    const merged = {
        ...(base ?? {}),
        ...(override ?? {}),
    };
    return Object.keys(merged).length > 0 ? merged : undefined;
}

function logRuntimeAuthResolution(input: {
    context?: DextoProviderContext | undefined;
    provider: LLMProvider;
    model: string;
    configApiKey?: string | undefined;
    resolvedApiKey?: string | undefined;
    runtimeAuth: LlmRuntimeAuthOverrides | null;
    effectiveBaseURL?: string | undefined;
}): void {
    const {
        context,
        provider,
        model,
        configApiKey,
        resolvedApiKey,
        runtimeAuth,
        effectiveBaseURL,
    } = input;
    if (!context?.logger) {
        return;
    }

    const auth =
        runtimeAuth?.auth ??
        (configApiKey?.trim()
            ? { source: 'config_api_key' }
            : resolvedApiKey?.trim()
              ? { source: 'environment', envVar: getPrimaryApiKeyEnvVar(provider) }
              : { source: 'none' });

    context.logger.info('LLM runtime auth resolved', {
        provider,
        model,
        auth,
        runtime: {
            hasRuntimeFetch: Boolean(runtimeAuth?.fetch),
            hasRuntimeHeaders: Boolean(runtimeAuth?.headers),
            hasRuntimeBaseURL: Boolean(runtimeAuth?.baseURL),
            hasEffectiveBaseURL: Boolean(effectiveBaseURL),
        },
    });
}

/**
 * Create a Vercel AI SDK LanguageModel from config.
 *
 * With explicit providers, the config's provider field directly determines
 * where requests go. No auth-dependent routing - what you configure is what runs.
 *
 * @param llmConfig - LLM configuration from agent config
 * @param context - Optional context for usage tracking (session ID, etc.)
 * @returns Promise resolving to a Vercel AI SDK LanguageModel instance
 */
export async function createVercelModel(
    llmConfig: ValidatedLLMConfig,
    context?: DextoProviderContext
): Promise<LanguageModel> {
    const { provider, model, baseURL } = llmConfig;
    const runtimeAuth =
        context?.authResolver?.resolveRuntimeAuth({
            provider,
            model,
            apiKey: llmConfig.apiKey,
            baseURL,
        }) ?? null;
    const resolvedProviderApiKey = resolveApiKeyForProvider(provider);
    const apiKey = runtimeAuth?.apiKey || llmConfig.apiKey || resolvedProviderApiKey;
    const runtimeBaseURL = runtimeAuth?.baseURL;
    const runtimeHeaders = runtimeAuth?.headers;
    const runtimeFetch = runtimeAuth?.fetch;
    const effectiveBaseURL = runtimeBaseURL?.replace(/\/$/, '') || baseURL?.replace(/\/$/, '');
    const usesCodexRuntimeAuth = runtimeBaseURL ? isCodexBaseURL(runtimeBaseURL) : false;

    logRuntimeAuthResolution({
        context,
        provider,
        model,
        configApiKey: llmConfig.apiKey,
        resolvedApiKey: resolvedProviderApiKey,
        runtimeAuth,
        effectiveBaseURL,
    });

    // Runtime check: if provider requires API key but none is configured, fail with helpful message
    if (requiresApiKey(provider) && !usesCodexRuntimeAuth && !apiKey?.trim()) {
        const envVar = getPrimaryApiKeyEnvVar(provider);
        throw LLMError.apiKeyMissing(provider, envVar);
    }

    switch (provider.toLowerCase()) {
        case 'openai': {
            if (usesCodexRuntimeAuth && runtimeBaseURL) {
                const { createCodexLanguageModel } = await import(
                    '../providers/codex-app-server.js'
                );
                return createCodexLanguageModel({
                    modelId: model,
                    baseURL: runtimeBaseURL,
                    cwd: resolveProviderWorkingDirectory(context?.cwd),
                    ...(context?.onCodexRateLimitStatus
                        ? { onRateLimitStatus: context.onCodexRateLimitStatus }
                        : {}),
                });
            }

            // Regular OpenAI - strict compatibility, no baseURL
            // Explicitly use the Responses API (default in AI SDK 5+).
            const { createOpenAI } = await import('@ai-sdk/openai');
            return createOpenAI({
                apiKey: apiKey ?? '',
                ...(effectiveBaseURL ? { baseURL: effectiveBaseURL } : {}),
                ...(runtimeHeaders ? { headers: runtimeHeaders } : {}),
                ...(runtimeFetch ? { fetch: runtimeFetch } : {}),
            }).responses(model);
        }
        case 'openai-compatible': {
            const compatibleBaseURL =
                effectiveBaseURL || process.env.OPENAI_BASE_URL?.replace(/\/$/, '');
            if (!compatibleBaseURL) {
                throw LLMError.baseUrlMissing('openai-compatible');
            }

            // Use the OpenAI-compatible provider so providerOptions can be keyed per-endpoint.
            // This also avoids mixing OpenAI Responses defaults into compatibility endpoints.
            const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
            const provider = createOpenAICompatible({
                name: 'openaiCompatible',
                baseURL: compatibleBaseURL,
                ...(apiKey?.trim() ? { apiKey } : {}),
                ...(runtimeHeaders ? { headers: runtimeHeaders } : {}),
                ...(runtimeFetch ? { fetch: runtimeFetch } : {}),
            });
            return provider.chatModel(model);
        }
        case 'openrouter': {
            // OpenRouter - unified API gateway for 100+ models (BYOK)
            // Model IDs are in OpenRouter format (e.g., 'anthropic/claude-sonnet-4-5-20250929')
            const orBaseURL = baseURL || 'https://openrouter.ai/api/v1';
            const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
            const provider = createOpenRouter({
                apiKey: apiKey ?? '',
                baseURL: orBaseURL,
                compatibility: 'strict',
            });
            const chatModel = provider.chat(model);
            if (!isLanguageModel(chatModel)) {
                throw LLMError.generationFailed(
                    'OpenRouter provider returned an invalid language model instance',
                    'openrouter',
                    model
                );
            }
            return chatModel;
        }
        case 'minimax': {
            // MiniMax - OpenAI-compatible endpoint
            const minimaxBaseURL = effectiveBaseURL || 'https://api.minimax.chat/v1';
            const { createOpenAI } = await import('@ai-sdk/openai');
            return createOpenAI({
                apiKey: apiKey ?? '',
                baseURL: minimaxBaseURL,
                ...(runtimeHeaders ? { headers: runtimeHeaders } : {}),
                ...(runtimeFetch ? { fetch: runtimeFetch } : {}),
            }).chat(model);
        }
        case 'glm': {
            // Zhipu AI (GLM) - OpenAI-compatible endpoint
            const glmBaseURL = effectiveBaseURL || 'https://open.bigmodel.cn/api/paas/v4';
            const { createOpenAI } = await import('@ai-sdk/openai');
            return createOpenAI({
                apiKey: apiKey ?? '',
                baseURL: glmBaseURL,
                ...(runtimeHeaders ? { headers: runtimeHeaders } : {}),
                ...(runtimeFetch ? { fetch: runtimeFetch } : {}),
            }).chat(model);
        }
        case 'litellm': {
            // LiteLLM - OpenAI-compatible proxy for 100+ LLM providers
            // User must provide their own LiteLLM proxy URL
            if (!effectiveBaseURL) {
                throw LLMError.baseUrlMissing('litellm');
            }
            const { createOpenAI } = await import('@ai-sdk/openai');
            return createOpenAI({
                apiKey: apiKey ?? '',
                baseURL: effectiveBaseURL,
                ...(runtimeHeaders ? { headers: runtimeHeaders } : {}),
                ...(runtimeFetch ? { fetch: runtimeFetch } : {}),
            }).chat(model);
        }
        case 'glama': {
            // Glama - OpenAI-compatible gateway for multiple LLM providers
            // Fixed endpoint, no user configuration needed
            const glamaBaseURL = effectiveBaseURL || 'https://glama.ai/api/gateway/openai/v1';
            const { createOpenAI } = await import('@ai-sdk/openai');
            return createOpenAI({
                apiKey: apiKey ?? '',
                baseURL: glamaBaseURL,
                ...(runtimeHeaders ? { headers: runtimeHeaders } : {}),
                ...(runtimeFetch ? { fetch: runtimeFetch } : {}),
            }).chat(model);
        }
        case 'dexto-nova': {
            // Dexto Gateway - OpenAI-compatible proxy with per-request billing
            // Routes through app.dexto.ai/v1 to OpenRouter, deducts from user balance
            // Requires DEXTO_API_KEY from `dexto login`
            //
            // Model IDs are in OpenRouter format (e.g., 'anthropic/claude-sonnet-4-5-20250929')
            // Users explicitly choose `provider: dexto-nova` in their config
            //
            // Note: 402 "insufficient credits" errors are handled in turn-executor.ts mapProviderError()
            const dextoBaseURL = resolveDextoGatewayBaseURL(baseURL);

            // Build headers for usage tracking
            const headers: Record<string, string> = {
                ...(runtimeHeaders ?? {}),
                [DEXTO_GATEWAY_HEADERS.CLIENT_SOURCE]: context?.clientSource ?? 'cli',
            };
            if (context?.sessionId) {
                headers[DEXTO_GATEWAY_HEADERS.SESSION_ID] = context.sessionId;
            }
            if (process.env.DEXTO_CLI_VERSION) {
                headers[DEXTO_GATEWAY_HEADERS.CLIENT_VERSION] = process.env.DEXTO_CLI_VERSION;
            }

            // Dexto Gateway accepts OpenRouter's multimodal chat-completions content dialect.
            // The generic OpenAI-compatible provider rejects non-image file parts before sending.
            const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
            const provider = createOpenRouter({
                baseURL: dextoBaseURL,
                compatibility: 'strict',
                headers,
                ...(apiKey?.trim() ? { apiKey } : {}),
                ...(runtimeFetch ? { fetch: runtimeFetch } : {}),
            });
            const chatModel = provider.chat(model);
            if (!isLanguageModel(chatModel)) {
                throw LLMError.generationFailed(
                    'Dexto gateway provider returned an invalid language model instance',
                    'dexto-nova',
                    model
                );
            }
            return chatModel;
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
                const headers = supportsAnthropicInterleavedThinking(model)
                    ? { [ANTHROPIC_BETA_HEADER]: ANTHROPIC_INTERLEAVED_THINKING_BETA }
                    : undefined;
                const { createVertexAnthropic } = await import('@ai-sdk/google-vertex/anthropic');
                return createVertexAnthropic({
                    project: projectId,
                    location: location || 'us-east5',
                    ...(headers ? { headers } : {}),
                })(model);
            }

            // Gemini models use the main export
            // Default to us-central1 for Gemini (widely available)
            const { createVertex } = await import('@ai-sdk/google-vertex');
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
            const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock');
            return createAmazonBedrock({ region })(modelId);
        }
        case 'anthropic': {
            const headers = mergeHeaders(
                supportsAnthropicInterleavedThinking(model)
                    ? { [ANTHROPIC_BETA_HEADER]: ANTHROPIC_INTERLEAVED_THINKING_BETA }
                    : undefined,
                runtimeHeaders
            );
            const { createAnthropic } = await import('@ai-sdk/anthropic');
            return createAnthropic({
                apiKey: apiKey ?? '',
                ...(effectiveBaseURL ? { baseURL: effectiveBaseURL } : {}),
                ...(headers ? { headers } : {}),
                ...(runtimeFetch ? { fetch: runtimeFetch } : {}),
            })(model);
        }
        case 'google': {
            const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
            return createGoogleGenerativeAI({ apiKey: apiKey ?? '' })(model);
        }
        case 'groq': {
            const { createGroq } = await import('@ai-sdk/groq');
            return createGroq({ apiKey: apiKey ?? '' })(model);
        }
        case 'xai': {
            const { createXai } = await import('@ai-sdk/xai');
            return createXai({ apiKey: apiKey ?? '' })(model);
        }
        case 'cohere': {
            const { createCohere } = await import('@ai-sdk/cohere');
            return createCohere({ apiKey: apiKey ?? '' })(model);
        }
        case 'ollama': {
            // Ollama - local model server with OpenAI-compatible API
            // Uses the /v1 endpoint for AI SDK compatibility
            // Default URL: http://localhost:11434
            const ollamaBaseURL = effectiveBaseURL || 'http://localhost:11434/v1';
            // Ollama doesn't require an API key, but the SDK needs a non-empty string
            const { createOpenAI } = await import('@ai-sdk/openai');
            return createOpenAI({
                apiKey: apiKey ?? 'ollama',
                baseURL: ollamaBaseURL,
                ...(runtimeHeaders ? { headers: runtimeHeaders } : {}),
                ...(runtimeFetch ? { fetch: runtimeFetch } : {}),
            }).chat(model);
        }
        case 'local': {
            // Native node-llama-cpp execution via AI SDK adapter.
            // Model is loaded lazily on first use.
            const { createLocalLanguageModel } = await import(
                '../providers/local/ai-sdk-adapter.js'
            );
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
 * @param conversationStore Store for conversation persistence
 * @param sessionEventBus Session-level event bus for emitting LLM events
 * @param sessionId Session ID
 * @param resourceManager Resource manager for blob storage and resource access
 * @param logger Logger instance for dependency injection
 * @param options Session-scoped runtime options
 * @returns Promise resolving to a VercelLLMService instance
 */
export async function createLLMService(
    config: ValidatedLLMConfig,
    toolManager: ToolManager,
    systemPromptManager: SystemPromptManager,
    conversationStore: ConversationStore,
    sessionEventBus: SessionEventBus,
    sessionId: string,
    resourceManager: import('../../resources/index.js').ResourceManager,
    logger: Logger,
    options: CreateLLMServiceOptions,
    languageModelFactory?: LanguageModelFactory
): Promise<VercelLLMService> {
    const { usageScopeId, compactionStrategy, executionControl, steerQueue, followUpQueue } =
        options;

    const providerContext: DextoProviderContext = {
        sessionId,
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        authResolver: options.authResolver ?? null,
        logger,
        onCodexRateLimitStatus: (snapshot) => {
            sessionEventBus.emit('llm:rate-limit-status', {
                provider: config.provider,
                model: config.model,
                snapshot,
            });
        },
    };

    const model = await (languageModelFactory?.({
        config,
        context: providerContext,
        createDefaultLanguageModel: () => createVercelModel(config, providerContext),
    }) ?? createVercelModel(config, providerContext));

    return new VercelLLMService(
        toolManager,
        model,
        systemPromptManager,
        conversationStore,
        sessionEventBus,
        config,
        sessionId,
        resourceManager,
        logger,
        steerQueue,
        followUpQueue,
        usageScopeId,
        executionControl,
        compactionStrategy
    );
}
