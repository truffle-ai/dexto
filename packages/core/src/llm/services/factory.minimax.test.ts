import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVercelModel } from './factory.js';
import type { ValidatedLLMConfig } from '../schemas.js';

// Mock @ai-sdk/openai to capture createOpenAI calls
const mockChat = vi.fn(() => ({ modelId: 'MiniMax-M2.7', doGenerate: vi.fn() }));
vi.mock('@ai-sdk/openai', () => ({
    createOpenAI: vi.fn(() => ({
        chat: mockChat,
        responses: vi.fn(() => ({ modelId: 'test', doGenerate: vi.fn() })),
    })),
}));

// Mock other providers to avoid import errors
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn() }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock('@ai-sdk/groq', () => ({ createGroq: vi.fn() }));
vi.mock('@ai-sdk/xai', () => ({ createXai: vi.fn() }));
vi.mock('@ai-sdk/cohere', () => ({ createCohere: vi.fn() }));
vi.mock('@ai-sdk/google-vertex', () => ({ createVertex: vi.fn() }));
vi.mock('@ai-sdk/google-vertex/anthropic', () => ({ createVertexAnthropic: vi.fn() }));
vi.mock('@ai-sdk/amazon-bedrock', () => ({ createAmazonBedrock: vi.fn() }));
vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: vi.fn() }));
vi.mock('@openrouter/ai-sdk-provider', () => ({ createOpenRouter: vi.fn() }));
vi.mock('../providers/local/ai-sdk-adapter.js', () => ({
    createLocalLanguageModel: vi.fn(),
}));
vi.mock('../providers/codex-app-server.js', () => ({
    createCodexLanguageModel: vi.fn(),
}));
vi.mock('../providers/codex-base-url.js', () => ({
    isCodexBaseURL: vi.fn(() => false),
}));
vi.mock('../../utils/execution-context.js', () => ({
    findDextoProjectRoot: vi.fn(() => '/tmp'),
}));
vi.mock('../providers/openrouter-model-registry.js', () => ({
    getCachedOpenRouterModelsWithInfo: vi.fn(() => null),
    getOpenRouterModelCacheInfo: vi.fn(() => ({
        lastFetchedAt: null,
        modelCount: 0,
        isFresh: false,
    })),
    getOpenRouterModelContextLength: vi.fn(),
    scheduleOpenRouterModelRefresh: vi.fn(),
}));

describe('createVercelModel — MiniMax provider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockChat.mockReturnValue({ modelId: 'MiniMax-M2.7', doGenerate: vi.fn() });
    });

    const baseConfig: ValidatedLLMConfig = {
        provider: 'minimax',
        model: 'MiniMax-M2.7',
        apiKey: 'test-minimax-key',
        maxIterations: 10,
        temperature: 0.7,
        maxOutputTokens: 4096,
    } as ValidatedLLMConfig;

    it('creates model using OpenAI-compatible SDK with correct base URL', async () => {
        const { createOpenAI } = await import('@ai-sdk/openai');
        createVercelModel(baseConfig);

        expect(createOpenAI).toHaveBeenCalledWith({
            apiKey: 'test-minimax-key',
            baseURL: 'https://api.minimax.io/v1',
        });
        expect(mockChat).toHaveBeenCalledWith('MiniMax-M2.7');
    });

    it('uses api.minimax.io, not api.minimax.chat', async () => {
        const { createOpenAI } = await import('@ai-sdk/openai');
        createVercelModel(baseConfig);

        const call = vi.mocked(createOpenAI).mock.calls[0]![0]!;
        expect(call.baseURL).toBe('https://api.minimax.io/v1');
        expect(call.baseURL).not.toContain('minimax.chat');
    });

    it('respects custom baseURL when provided', async () => {
        const { createOpenAI } = await import('@ai-sdk/openai');
        const customConfig = {
            ...baseConfig,
            baseURL: 'https://custom-proxy.example.com/v1',
        };
        createVercelModel(customConfig);

        expect(createOpenAI).toHaveBeenCalledWith({
            apiKey: 'test-minimax-key',
            baseURL: 'https://custom-proxy.example.com/v1',
        });
    });

    it('works with M2.7-highspeed model', async () => {
        createVercelModel({ ...baseConfig, model: 'MiniMax-M2.7-highspeed' });
        expect(mockChat).toHaveBeenCalledWith('MiniMax-M2.7-highspeed');
    });
});
