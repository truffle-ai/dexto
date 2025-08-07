import { describe, test, expect, beforeEach, vi } from 'vitest';
import { filterMessagesByLLMCapabilities } from './utils.js';
import { InternalMessage } from './types.js';
import { LLMContext } from '@core/llm/types.js';
import { ContextErrorCode, ErrorScope, ErrorType } from '@core/errors/index.js';
import * as registry from '@core/llm/registry.js';

// Mock the registry module
vi.mock('@core/llm/registry.js');
const mockValidateModelFileSupport = vi.mocked(registry.validateModelFileSupport);

describe('filterMessagesByLLMCapabilities', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('should keep text and image parts unchanged', () => {
        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Hello' },
                    { type: 'image', image: 'base64data', mimeType: 'image/png' },
                ],
            },
        ];

        const config: LLMContext = { provider: 'openai', model: 'gpt-4' };

        const result = filterMessagesByLLMCapabilities(messages, config);

        expect(result).toEqual(messages);
    });

    test('should filter out unsupported file attachments', () => {
        // Mock validation to reject PDF files for gpt-3.5-turbo
        mockValidateModelFileSupport.mockReturnValue({
            isSupported: false,
            error: 'Model gpt-3.5-turbo does not support PDF files',
        });

        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Analyze this document' },
                    {
                        type: 'file',
                        data: 'pdfdata',
                        mimeType: 'application/pdf',
                        filename: 'doc.pdf',
                    },
                ],
            },
        ];

        const config: LLMContext = { provider: 'openai', model: 'gpt-3.5-turbo' };

        const result = filterMessagesByLLMCapabilities(messages, config);

        expect(result[0]!.content).toEqual([{ type: 'text', text: 'Analyze this document' }]);
        expect(mockValidateModelFileSupport).toHaveBeenCalledWith(
            config.provider,
            config.model,
            'application/pdf'
        );
    });

    test('should keep supported file attachments for models that support them', () => {
        // Mock validation to accept PDF files for gpt-4o
        mockValidateModelFileSupport.mockReturnValue({
            isSupported: true,
            fileType: 'pdf',
        });

        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Analyze this document' },
                    {
                        type: 'file',
                        data: 'pdfdata',
                        mimeType: 'application/pdf',
                        filename: 'doc.pdf',
                    },
                ],
            },
        ];

        const config: LLMContext = { provider: 'openai', model: 'gpt-4o' };

        const result = filterMessagesByLLMCapabilities(messages, config);

        expect(result[0]!.content).toEqual([
            { type: 'text', text: 'Analyze this document' },
            { type: 'file', data: 'pdfdata', mimeType: 'application/pdf', filename: 'doc.pdf' },
        ]);
    });

    test('should handle audio file filtering for different models', () => {
        // Mock validation to reject audio for regular models but accept for audio-preview models
        mockValidateModelFileSupport
            .mockReturnValueOnce({
                isSupported: false,
                error: 'Model gpt-4 does not support audio files',
            })
            .mockReturnValueOnce({
                isSupported: true,
                fileType: 'audio',
            });

        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Transcribe this audio' },
                    {
                        type: 'file',
                        data: 'audiodata',
                        mimeType: 'audio/mp3',
                        filename: 'recording.mp3',
                    },
                ],
            },
        ];

        // Test with regular gpt-4 (should filter out audio)
        const config1: LLMContext = { provider: 'openai', model: 'gpt-4' };
        const result1 = filterMessagesByLLMCapabilities(messages, config1);

        expect(result1[0]!.content).toEqual([{ type: 'text', text: 'Transcribe this audio' }]);

        // Test with gpt-4o-audio-preview (should keep audio)
        const config2: LLMContext = { provider: 'openai', model: 'gpt-4o-audio-preview' };
        const result2 = filterMessagesByLLMCapabilities(messages, config2);

        expect(result2[0]!.content).toEqual([
            { type: 'text', text: 'Transcribe this audio' },
            { type: 'file', data: 'audiodata', mimeType: 'audio/mp3', filename: 'recording.mp3' },
        ]);
    });

    test('should add placeholder text when all content is filtered out', () => {
        // Mock validation to reject all files
        mockValidateModelFileSupport.mockReturnValue({
            isSupported: false,
            error: 'File type not supported by current LLM',
        });

        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    {
                        type: 'file',
                        data: 'pdfdata',
                        mimeType: 'application/pdf',
                        filename: 'doc.pdf',
                    },
                ],
            },
        ];

        const config: LLMContext = { provider: 'openai', model: 'gpt-3.5-turbo' };

        const result = filterMessagesByLLMCapabilities(messages, config);

        expect(result[0]!.content).toEqual([
            { type: 'text', text: '[File attachment removed - not supported by gpt-3.5-turbo]' },
        ]);
    });

    test('should throw error when no model specified', () => {
        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    {
                        type: 'file',
                        data: 'audiodata',
                        mimeType: 'audio/mp3',
                        filename: 'song.mp3',
                    },
                ],
            },
        ];

        // Create an invalid config at runtime to test the error
        const config = { provider: 'anthropic' } as any; // No model specified

        expect(() => filterMessagesByLLMCapabilities(messages, config)).toThrow(
            expect.objectContaining({
                code: ContextErrorCode.PROVIDER_MODEL_REQUIRED,
                scope: ErrorScope.CONTEXT,
                type: ErrorType.USER,
            })
        );
    });

    test('should only filter user messages with array content', () => {
        const messages: InternalMessage[] = [
            {
                role: 'system',
                content: 'You are a helpful assistant',
            },
            {
                role: 'assistant',
                content: 'Hello! How can I help you?',
            },
            {
                role: 'tool',
                content: 'Tool result',
                name: 'search',
                toolCallId: 'call_123',
            },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Analyze this' },
                    { type: 'file', data: 'data', mimeType: 'application/pdf' },
                ],
            },
        ];

        // Mock validation to reject the file
        mockValidateModelFileSupport.mockReturnValue({
            isSupported: false,
            error: 'PDF not supported',
        });

        const config: LLMContext = { provider: 'openai', model: 'gpt-3.5-turbo' };

        const result = filterMessagesByLLMCapabilities(messages, config);

        // Only the user message with array content should be modified
        expect(result[0]).toEqual(messages[0]); // system unchanged
        expect(result[1]).toEqual(messages[1]); // assistant unchanged
        expect(result[2]).toEqual(messages[2]); // tool unchanged
        expect(result[3]!.content).toEqual([{ type: 'text', text: 'Analyze this' }]); // user message filtered
    });

    test('should keep unknown part types unchanged', () => {
        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Hello' },
                    { type: 'custom', data: 'some data' } as any, // Test case: unknown message part type
                ],
            },
        ];

        const config: LLMContext = { provider: 'openai', model: 'gpt-4' };

        const result = filterMessagesByLLMCapabilities(messages, config);

        expect(result).toEqual(messages);
    });

    test('should handle files without mimeType gracefully', () => {
        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Hello' },
                    { type: 'file', data: 'data' } as any, // Test case: file without mimeType property
                ],
            },
        ];

        const config: LLMContext = { provider: 'openai', model: 'gpt-4' };

        const result = filterMessagesByLLMCapabilities(messages, config);

        // Should keep the malformed file part since it doesn't have mimeType to validate
        expect(result).toEqual(messages);
    });

    test('should handle validation errors gracefully', () => {
        // Mock validation to throw an error
        mockValidateModelFileSupport.mockImplementation(() => {
            throw new Error('Validation service unavailable');
        });

        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Hello' },
                    { type: 'file', data: 'data', mimeType: 'application/pdf' },
                ],
            },
        ];

        const config: LLMContext = { provider: 'openai', model: 'gpt-4' };

        // Should return original messages when validation fails
        const result = filterMessagesByLLMCapabilities(messages, config);

        expect(result).toEqual(messages);
    });

    test('should handle empty message content array', () => {
        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [],
            },
        ];

        const config: LLMContext = { provider: 'openai', model: 'gpt-4' };

        const result = filterMessagesByLLMCapabilities(messages, config);

        // Should add placeholder text for empty content
        expect(result[0]!.content).toEqual([
            { type: 'text', text: '[File attachment removed - not supported by gpt-4]' },
        ]);
    });
});
