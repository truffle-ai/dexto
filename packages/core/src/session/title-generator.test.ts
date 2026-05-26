import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import { LLMConfigSchema } from '../llm/schemas.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { generateSessionTitle } from './title-generator.js';

function createMockModel(modelId: string): LanguageModel {
    return {
        specificationVersion: 'v2',
        provider: 'mock-provider',
        modelId,
        supportedUrls: {},
        doGenerate: vi.fn(),
        doStream: vi.fn(),
    };
}

const mocks = vi.hoisted(() => ({
    createVercelModel: vi.fn(() => createMockModel('default-model')),
    generateText: vi.fn(),
}));

vi.mock('ai', () => ({
    generateText: mocks.generateText,
}));

vi.mock('../llm/services/factory.js', () => ({
    createVercelModel: mocks.createVercelModel,
}));

describe('generateSessionTitle', () => {
    const logger = createMockLogger();
    const llmConfig = LLMConfigSchema.parse({
        provider: 'openai',
        model: 'gpt-5',
        apiKey: 'test-key',
        maxIterations: 50,
        maxInputTokens: 128000,
    });

    beforeEach(() => {
        vi.resetAllMocks();
        mocks.createVercelModel.mockReturnValue(createMockModel('default-model'));
        mocks.generateText.mockResolvedValue({ text: 'Default title' });
    });

    test('passes a host-provided languageModelFactory through to direct text generation', async () => {
        const hostedModel = createMockModel('hosted-model');
        const languageModelFactory = vi.fn(() => hostedModel);
        mocks.generateText.mockResolvedValue({ text: 'Hosted transport title' });

        const result = await generateSessionTitle(llmConfig, 'help me debug this session', logger, {
            languageModelFactory,
            providerContext: { sessionId: 'session-123', clientSource: 'web' },
        });

        expect(result).toEqual({ title: 'Hosted transport title' });
        expect(languageModelFactory).toHaveBeenCalledWith({
            config: llmConfig,
            context: { sessionId: 'session-123', clientSource: 'web' },
            createDefaultLanguageModel: expect.any(Function),
        });
        expect(mocks.generateText).toHaveBeenCalledWith(
            expect.objectContaining({
                model: hostedModel,
                prompt: expect.stringContaining('help me debug this session'),
                maxOutputTokens: 32,
            })
        );
    });

    test('uses the default model factory without constructing a session LLM service', async () => {
        const defaultModel = createMockModel('default-model');
        mocks.createVercelModel.mockReturnValue(defaultModel);

        const result = await generateSessionTitle(llmConfig, 'generate a title', logger);

        expect(result).toEqual({ title: 'Default title' });
        expect(mocks.createVercelModel).toHaveBeenCalledWith(llmConfig, {});
        expect(mocks.generateText).toHaveBeenCalledWith(
            expect.objectContaining({
                model: defaultModel,
                prompt: expect.stringContaining('generate a title'),
            })
        );
    });
});
