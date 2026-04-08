import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMConfigSchema } from '../schemas.js';
import type { LLMProvider } from '../types.js';
import { createVercelModel } from './factory.js';
import {
    ANTHROPIC_BETA_HEADER,
    ANTHROPIC_INTERLEAVED_THINKING_BETA,
} from '../reasoning/anthropic-betas.js';

const sdkMocks = vi.hoisted(() => {
    const openAIResponsesModel = vi.fn((modelId: string) => ({
        modelId,
        doGenerate: vi.fn(),
    }));
    const openAIChatModel = vi.fn((modelId: string) => ({
        modelId,
        doGenerate: vi.fn(),
    }));
    const createOpenAI = vi.fn((options: unknown) => ({
        responses: openAIResponsesModel,
        chat: openAIChatModel,
        options,
    }));

    const openAICompatibleChatModel = vi.fn((modelId: string) => ({
        modelId,
        doGenerate: vi.fn(),
    }));
    const createOpenAICompatible = vi.fn((options: unknown) => ({
        chatModel: openAICompatibleChatModel,
        options,
    }));

    const anthropicModel = vi.fn((modelId: string) => ({
        modelId,
        doGenerate: vi.fn(),
    }));
    const createAnthropic = vi.fn((options: unknown) => {
        const modelFactory = (modelId: string) => anthropicModel(modelId);
        return Object.assign(modelFactory, { options });
    });

    const openRouterChatModel = vi.fn((modelId: string) => ({
        modelId,
        doGenerate: vi.fn(),
    }));
    const createOpenRouter = vi.fn((options: unknown) => ({
        chat: openRouterChatModel,
        options,
    }));

    const bedrockModel = vi.fn((modelId: string) => ({
        modelId,
        doGenerate: vi.fn(),
    }));
    const createAmazonBedrock = vi.fn((options: unknown) => {
        const modelFactory = (modelId: string) => bedrockModel(modelId);
        return Object.assign(modelFactory, { options });
    });

    const vertexAnthropicModel = vi.fn((modelId: string) => ({
        modelId,
        doGenerate: vi.fn(),
    }));
    const createVertexAnthropic = vi.fn((options: unknown) => {
        const modelFactory = (modelId: string) => vertexAnthropicModel(modelId);
        return Object.assign(modelFactory, { options });
    });

    const createCodexLanguageModel = vi.fn((config: unknown) => ({
        modelId: 'codex',
        doGenerate: vi.fn(),
        config,
    }));

    return {
        openAIResponsesModel,
        openAIChatModel,
        createOpenAI,
        openAICompatibleChatModel,
        createOpenAICompatible,
        anthropicModel,
        createAnthropic,
        openRouterChatModel,
        createOpenRouter,
        bedrockModel,
        createAmazonBedrock,
        vertexAnthropicModel,
        createVertexAnthropic,
        createCodexLanguageModel,
    };
});

vi.mock('@ai-sdk/openai', () => ({
    createOpenAI: sdkMocks.createOpenAI,
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
    createOpenAICompatible: sdkMocks.createOpenAICompatible,
}));

vi.mock('@ai-sdk/anthropic', () => ({
    createAnthropic: sdkMocks.createAnthropic,
}));

vi.mock('@openrouter/ai-sdk-provider', () => ({
    createOpenRouter: sdkMocks.createOpenRouter,
}));

vi.mock('@ai-sdk/amazon-bedrock', () => ({
    createAmazonBedrock: sdkMocks.createAmazonBedrock,
}));

vi.mock('@ai-sdk/google-vertex/anthropic', () => ({
    createVertexAnthropic: sdkMocks.createVertexAnthropic,
}));

vi.mock('../providers/codex-app-server.js', () => ({
    createCodexLanguageModel: sdkMocks.createCodexLanguageModel,
}));

function makeConfig(config: {
    provider: LLMProvider;
    model: string;
    apiKey?: string | undefined;
    baseURL?: string | undefined;
}) {
    return LLMConfigSchema.parse({
        provider: config.provider,
        model: config.model,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        maxIterations: 1,
    });
}

describe('createVercelModel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllEnvs();
    });

    it('routes openai models through the Responses API', () => {
        createVercelModel(
            makeConfig({
                provider: 'openai',
                model: 'gpt-5',
                apiKey: 'openai-key',
            })
        );

        expect(sdkMocks.createOpenAI).toHaveBeenCalledWith({
            apiKey: 'openai-key',
        });
        expect(sdkMocks.openAIResponsesModel).toHaveBeenCalledWith('gpt-5');
        expect(sdkMocks.openAIChatModel).not.toHaveBeenCalled();
    });

    it('routes openai ChatGPT Login configs through the Codex app-server without requiring an apiKey', () => {
        const authResolver = {
            resolveRuntimeAuth: vi.fn(() => ({
                baseURL: 'codex://chatgpt',
            })),
        };

        createVercelModel(
            makeConfig({
                provider: 'openai',
                model: 'gpt-5.4',
            }),
            { authResolver }
        );

        expect(authResolver.resolveRuntimeAuth).toHaveBeenCalledWith({
            provider: 'openai',
            model: 'gpt-5.4',
            apiKey: undefined,
            baseURL: undefined,
        });
        expect(sdkMocks.createCodexLanguageModel).toHaveBeenCalledWith(
            expect.objectContaining({
                providerId: 'openai',
                modelId: 'gpt-5.4',
                baseURL: 'codex://chatgpt',
            })
        );
        expect(sdkMocks.createOpenAI).not.toHaveBeenCalled();
    });

    it('routes Anthropic-compatible providers through shared runtime-auth-aware construction', () => {
        const runtimeFetch = async (): Promise<Response> => new Response(null);
        const authResolver = {
            resolveRuntimeAuth: vi.fn(() => ({
                apiKey: 'oauth-token',
                baseURL: 'https://oauth.example/anthropic/v1',
                headers: { authorization: 'Bearer oauth-token' },
                fetch: runtimeFetch,
            })),
        };

        createVercelModel(
            makeConfig({
                provider: 'minimax',
                model: 'MiniMax-M2.1',
            }),
            { authResolver }
        );

        expect(authResolver.resolveRuntimeAuth).toHaveBeenCalledWith({
            provider: 'minimax',
            model: 'MiniMax-M2.1',
        });
        expect(sdkMocks.createAnthropic).toHaveBeenCalledWith({
            apiKey: 'oauth-token',
            baseURL: 'https://oauth.example/anthropic/v1',
            headers: { authorization: 'Bearer oauth-token' },
            fetch: runtimeFetch,
        });
        expect(sdkMocks.anthropicModel).toHaveBeenCalledWith('MiniMax-M2.1');
    });

    it('routes representative OpenAI-chat-compatible providers to the expected endpoints', () => {
        const cases = [
            {
                provider: 'zhipuai-coding-plan' as const,
                model: 'glm-4.7',
                apiKey: 'zhipu-key',
                expectedBaseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
                expectedApiKey: 'zhipu-key',
            },
            {
                provider: 'moonshotai-cn' as const,
                model: 'kimi-k2.5',
                apiKey: 'moonshot-key',
                expectedBaseURL: 'https://api.moonshot.cn/v1',
                expectedApiKey: 'moonshot-key',
            },
            {
                provider: 'glama' as const,
                model: 'openai/gpt-4o',
                apiKey: 'glama-key',
                expectedBaseURL: 'https://glama.ai/api/gateway/openai/v1',
                expectedApiKey: 'glama-key',
            },
            {
                provider: 'ollama' as const,
                model: 'llama3.2',
                expectedBaseURL: 'http://localhost:11434/v1',
                expectedApiKey: 'ollama',
            },
        ];

        for (const testCase of cases) {
            sdkMocks.createOpenAI.mockClear();
            sdkMocks.openAIChatModel.mockClear();

            createVercelModel(
                makeConfig({
                    provider: testCase.provider,
                    model: testCase.model,
                    ...(testCase.apiKey ? { apiKey: testCase.apiKey } : {}),
                })
            );

            expect(sdkMocks.createOpenAI).toHaveBeenCalledWith({
                apiKey: testCase.expectedApiKey,
                baseURL: testCase.expectedBaseURL,
            });
            expect(sdkMocks.openAIChatModel).toHaveBeenCalledWith(testCase.model);
        }
    });

    it('requires a custom base URL for LiteLLM', () => {
        expect(() =>
            createVercelModel(
                makeConfig({
                    provider: 'litellm',
                    model: 'gpt-4',
                    apiKey: 'litellm-key',
                })
            )
        ).toThrow(/litellm/i);
    });

    it('passes runtime headers and fetch overrides into openai-compatible clients', () => {
        const runtimeFetch = async (): Promise<Response> => new Response(null);

        createVercelModel(
            makeConfig({
                provider: 'openai-compatible',
                model: 'gpt-5-mini',
                baseURL: 'https://proxy.example/v1',
            }),
            {
                authResolver: {
                    resolveRuntimeAuth: () => ({
                        headers: { authorization: 'Bearer runtime-token' },
                        fetch: runtimeFetch,
                    }),
                },
            }
        );

        expect(sdkMocks.createOpenAICompatible).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'openaiCompatible',
                baseURL: 'https://proxy.example/v1',
                headers: { authorization: 'Bearer runtime-token' },
                fetch: runtimeFetch,
            })
        );
        expect(sdkMocks.openAICompatibleChatModel).toHaveBeenCalledWith('gpt-5-mini');
    });

    it('adds Dexto gateway usage headers for dexto-nova requests', () => {
        vi.stubEnv('DEXTO_CLI_VERSION', '1.2.3');

        createVercelModel(
            makeConfig({
                provider: 'dexto-nova',
                model: 'anthropic/claude-4.5-sonnet',
                apiKey: 'dexto-key',
            }),
            {
                sessionId: 'session-123',
                clientSource: 'web',
            }
        );

        expect(sdkMocks.createOpenRouter).toHaveBeenCalledWith({
            apiKey: 'dexto-key',
            baseURL: 'https://api.dexto.ai/v1',
            headers: {
                'X-Dexto-Source': 'web',
                'X-Dexto-Session-ID': 'session-123',
                'X-Dexto-Version': '1.2.3',
            },
            compatibility: 'strict',
        });
        expect(sdkMocks.openRouterChatModel).toHaveBeenCalledWith('anthropic/claude-4.5-sonnet');
    });

    it('auto-prefixes Bedrock Anthropic models from the active region', () => {
        vi.stubEnv('AWS_REGION', 'eu-west-1');

        createVercelModel(
            makeConfig({
                provider: 'amazon-bedrock',
                model: 'anthropic.claude-3-5-haiku-20241022-v1:0',
            })
        );

        expect(sdkMocks.createAmazonBedrock).toHaveBeenCalledWith({
            region: 'eu-west-1',
        });
        expect(sdkMocks.bedrockModel).toHaveBeenCalledWith(
            'eu.anthropic.claude-3-5-haiku-20241022-v1:0'
        );
    });

    it('applies the Anthropic beta header for Vertex Anthropic models that support it', () => {
        vi.stubEnv('GOOGLE_VERTEX_PROJECT', 'test-project');

        createVercelModel(
            makeConfig({
                provider: 'google-vertex-anthropic',
                model: 'claude-sonnet-4@20250514',
            })
        );

        expect(sdkMocks.createVertexAnthropic).toHaveBeenCalledWith({
            project: 'test-project',
            location: 'us-east5',
            headers: {
                [ANTHROPIC_BETA_HEADER]: ANTHROPIC_INTERLEAVED_THINKING_BETA,
            },
        });
        expect(sdkMocks.vertexAnthropicModel).toHaveBeenCalledWith('claude-sonnet-4@20250514');
    });
});
