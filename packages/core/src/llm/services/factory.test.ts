import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMConfigSchema } from '../schemas.js';
import { createVercelModel } from './factory.js';

const { createOpenAICompatibleMock } = vi.hoisted(() => {
    return {
        createOpenAICompatibleMock: vi.fn(),
    };
});

vi.mock('@ai-sdk/openai-compatible', () => ({
    createOpenAICompatible: createOpenAICompatibleMock,
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
    const lastCall = createOpenAICompatibleMock.mock.calls.at(-1)?.[0];
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

        createOpenAICompatibleMock.mockImplementation(({ baseURL }) => ({
            chatModel: (model: string) => createLanguageModelStub(`${baseURL}:${model}`),
        }));
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

        expect(createOpenAICompatibleMock).toHaveBeenCalledWith({
            apiKey: 'dxt_test_key',
            baseURL: 'http://localhost:3001/v1',
            headers: {
                'X-Dexto-Session-ID': 'session-test',
                'X-Dexto-Source': 'web',
            },
            name: 'dexto-nova',
        });
    });
});
