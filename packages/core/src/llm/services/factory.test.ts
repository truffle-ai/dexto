import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import { LLMConfigSchema } from '../schemas.js';
import { createVercelModel } from './factory.js';

const sdkMocks = vi.hoisted(() => {
    return {
        createOpenRouter: vi.fn(),
        createOpenAI: vi.fn(),
        createOpenAICompatible: vi.fn(),
        createCodexLanguageModel: vi.fn(),
        openAIResponsesModel: vi.fn(),
        openAICompatibleChatModel: vi.fn(),
    };
});

vi.mock('@openrouter/ai-sdk-provider', () => ({
    createOpenRouter: sdkMocks.createOpenRouter,
}));

vi.mock('@ai-sdk/openai', () => ({
    createOpenAI: sdkMocks.createOpenAI,
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
    createOpenAICompatible: sdkMocks.createOpenAICompatible,
}));

vi.mock('../providers/codex-app-server.js', () => ({
    createCodexLanguageModel: sdkMocks.createCodexLanguageModel,
}));

function createLanguageModelStub(modelId: string) {
    return {
        modelId,
        doGenerate: vi.fn(),
    };
}

function buildDextoConfig(overrides: Record<string, unknown> = {}) {
    return LLMConfigSchema.parse({
        provider: 'dexto-nova',
        model: 'openai/gpt-5.4',
        apiKey: 'dxt_test_key',
        ...overrides,
    });
}

function getLastDextoNovaBaseUrl(): string {
    const lastCall = sdkMocks.createOpenAICompatible.mock.calls.at(-1)?.[0];
    if (!lastCall || typeof lastCall !== 'object' || !('baseURL' in lastCall)) {
        throw new Error('createOpenAICompatible call did not capture baseURL');
    }

    const { baseURL } = lastCall;
    if (typeof baseURL !== 'string') {
        throw new Error('Expected createOpenRouter baseURL to be a string');
    }

    return baseURL;
}

describe('createVercelModel dexto-nova base URL resolution', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.DEXTO_API_URL;

        sdkMocks.createOpenRouter.mockImplementation(({ baseURL }) => ({
            chat: (model: string) => createLanguageModelStub(`${baseURL}:${model}`),
        }));
        sdkMocks.createOpenAI.mockReturnValue({
            responses: sdkMocks.openAIResponsesModel,
        });
        sdkMocks.createOpenAICompatible.mockReturnValue({
            chatModel: sdkMocks.openAICompatibleChatModel,
        });
        sdkMocks.createCodexLanguageModel.mockReturnValue(createLanguageModelStub('codex-model'));
        sdkMocks.openAIResponsesModel.mockImplementation((model: string) =>
            createLanguageModelStub(`openai:${model}`)
        );
        sdkMocks.openAICompatibleChatModel.mockImplementation((model: string) =>
            createLanguageModelStub(`compatible:${model}`)
        );
    });

    afterEach(() => {
        delete process.env.DEXTO_API_URL;
    });

    it('uses the production gateway by default', () => {
        createVercelModel(buildDextoConfig());

        expect(getLastDextoNovaBaseUrl()).toBe('https://api.dexto.ai/v1');
    });

    it('uses llm.baseURL when explicitly provided', () => {
        createVercelModel(
            buildDextoConfig({
                baseURL: 'http://localhost:3001/v1/',
            })
        );

        expect(getLastDextoNovaBaseUrl()).toBe('http://localhost:3001/v1');
    });

    it('uses DEXTO_API_URL when no explicit baseURL is set', () => {
        process.env.DEXTO_API_URL = 'http://localhost:3001';

        createVercelModel(buildDextoConfig());

        expect(getLastDextoNovaBaseUrl()).toBe('http://localhost:3001/v1');
    });

    it('preserves DEXTO_API_URL when it already includes /v1', () => {
        process.env.DEXTO_API_URL = 'https://api.preview.dexto.ai/v1/';

        createVercelModel(buildDextoConfig());

        expect(getLastDextoNovaBaseUrl()).toBe('https://api.preview.dexto.ai/v1');
    });

    it('prefers explicit baseURL over DEXTO_API_URL', () => {
        process.env.DEXTO_API_URL = 'https://api.preview.dexto.ai';

        createVercelModel(
            buildDextoConfig({
                baseURL: 'http://localhost:3001/v1',
            })
        );

        expect(getLastDextoNovaBaseUrl()).toBe('http://localhost:3001/v1');
    });

    it('uses an OpenAI-compatible provider named dexto-nova with gateway headers', () => {
        createVercelModel(
            buildDextoConfig({
                baseURL: 'http://localhost:3001/v1',
            }),
            {
                clientSource: 'web',
                sessionId: 'session-test',
            }
        );

        expect(sdkMocks.createOpenAICompatible).toHaveBeenCalledWith({
            apiKey: 'dxt_test_key',
            baseURL: 'http://localhost:3001/v1',
            headers: {
                'X-Dexto-Session-ID': 'session-test',
                'X-Dexto-Source': 'web',
            },
            name: 'dexto-nova',
        });
    });

    it('projects OpenAI ChatGPT Login through runtime auth instead of config baseURL', () => {
        const authResolver = {
            resolveRuntimeAuth: vi.fn(() => ({
                baseURL: 'codex://chatgpt',
            })),
        };

        createVercelModel(
            LLMConfigSchema.parse({
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
                modelId: 'gpt-5.4',
                baseURL: 'codex://chatgpt',
            })
        );
        expect(sdkMocks.createOpenAI).not.toHaveBeenCalled();
    });

    it('passes runtime auth overrides to OpenAI clients', () => {
        const runtimeFetch = async (): Promise<Response> => new Response(null);
        const logger = createMockLogger();

        createVercelModel(
            LLMConfigSchema.parse({
                provider: 'openai',
                model: 'gpt-5.4',
                apiKey: 'config-key',
            }),
            {
                authResolver: {
                    resolveRuntimeAuth: () => ({
                        headers: { authorization: 'Bearer oauth-token' },
                        fetch: runtimeFetch,
                        auth: {
                            source: 'profile',
                            profileId: 'openai:chatgpt_login',
                            providerId: 'openai',
                            methodId: 'chatgpt_login',
                            credentialType: 'oauth',
                        },
                    }),
                },
                logger,
            }
        );

        expect(sdkMocks.createOpenAI).toHaveBeenCalledWith({
            apiKey: 'config-key',
            headers: { authorization: 'Bearer oauth-token' },
            fetch: runtimeFetch,
        });
        expect(sdkMocks.openAIResponsesModel).toHaveBeenCalledWith('gpt-5.4');
        expect(logger.info).toHaveBeenCalledWith(
            'LLM runtime auth resolved',
            expect.objectContaining({
                provider: 'openai',
                model: 'gpt-5.4',
                auth: {
                    source: 'profile',
                    profileId: 'openai:chatgpt_login',
                    providerId: 'openai',
                    methodId: 'chatgpt_login',
                    credentialType: 'oauth',
                },
                runtime: {
                    hasRuntimeFetch: true,
                    hasRuntimeHeaders: true,
                    hasRuntimeBaseURL: false,
                    hasEffectiveBaseURL: false,
                },
            })
        );
    });

    it('passes runtime auth overrides to OpenAI-compatible clients', () => {
        const runtimeFetch = async (): Promise<Response> => new Response(null);

        createVercelModel(
            LLMConfigSchema.parse({
                provider: 'openai-compatible',
                model: 'custom-model',
                baseURL: 'https://proxy.example/v1',
            }),
            {
                authResolver: {
                    resolveRuntimeAuth: () => ({
                        apiKey: 'runtime-key',
                        headers: { 'x-provider-account': 'acct_123' },
                        fetch: runtimeFetch,
                    }),
                },
            }
        );

        expect(sdkMocks.createOpenAICompatible).toHaveBeenCalledWith({
            name: 'openaiCompatible',
            apiKey: 'runtime-key',
            baseURL: 'https://proxy.example/v1',
            headers: { 'x-provider-account': 'acct_123' },
            fetch: runtimeFetch,
        });
        expect(sdkMocks.openAICompatibleChatModel).toHaveBeenCalledWith('custom-model');
    });
});
