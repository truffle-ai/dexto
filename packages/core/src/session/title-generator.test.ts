import { beforeEach, describe, expect, test, vi } from 'vitest';
import { LLMConfigSchema } from '../llm/schemas.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { generateSessionTitle } from './title-generator.js';

vi.mock('../llm/services/factory.js', () => ({
    createLLMService: vi.fn(),
}));

import { createLLMService } from '../llm/services/factory.js';

const mockCreateLLMService = vi.mocked(createLLMService);

describe('generateSessionTitle', () => {
    const logger = createMockLogger();
    const llmConfig = LLMConfigSchema.parse({
        provider: 'openai',
        model: 'gpt-5',
        apiKey: 'test-key',
        maxIterations: 50,
        maxInputTokens: 128000,
    });

    let mockToolManager: any;
    let mockSystemPromptManager: any;
    let mockResourceManager: any;
    let mockLLMService: any;

    beforeEach(() => {
        vi.resetAllMocks();

        mockToolManager = {
            getAllTools: vi.fn().mockResolvedValue({}),
        };
        mockSystemPromptManager = {
            getSystemPrompt: vi.fn().mockReturnValue('System prompt'),
        };
        mockResourceManager = {
            getBlobStore: vi.fn(),
            readResource: vi.fn(),
            listResources: vi.fn(),
        };
        mockLLMService = {
            stream: vi.fn().mockResolvedValue({ text: 'Default title' }),
        };

        mockCreateLLMService.mockReturnValue(mockLLMService);
    });

    test('passes a host-provided languageModelFactory through to createLLMService', async () => {
        const languageModelFactory = vi.fn();
        mockLLMService.stream.mockResolvedValue({ text: 'Hosted transport title' });

        const result = await generateSessionTitle(
            llmConfig,
            mockToolManager,
            mockSystemPromptManager,
            mockResourceManager,
            'help me debug this session',
            logger,
            { languageModelFactory }
        );

        expect(result).toEqual({ title: 'Hosted transport title' });
        expect(mockCreateLLMService).toHaveBeenCalledWith(
            llmConfig,
            mockToolManager,
            mockSystemPromptManager,
            expect.any(Object),
            expect.any(Object),
            expect.stringMatching(/^titlegen-/),
            mockResourceManager,
            logger,
            expect.objectContaining({
                messageQueue: expect.any(Object),
            }),
            languageModelFactory
        );
    });

    test('falls back to createLLMService when no override is provided', async () => {
        const result = await generateSessionTitle(
            llmConfig,
            mockToolManager,
            mockSystemPromptManager,
            mockResourceManager,
            'generate a title',
            logger
        );

        expect(result).toEqual({ title: 'Default title' });
        expect(mockCreateLLMService).toHaveBeenCalledWith(
            llmConfig,
            mockToolManager,
            mockSystemPromptManager,
            expect.any(Object),
            expect.any(Object),
            expect.stringMatching(/^titlegen-/),
            mockResourceManager,
            logger,
            expect.objectContaining({
                messageQueue: expect.any(Object),
            }),
            undefined
        );
    });
});
