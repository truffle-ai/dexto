import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
    filterMessagesByLLMCapabilities,
    parseDataUri,
    isLikelyBase64String,
    sanitizeToolResultToContent,
} from './utils.js';
import { InternalMessage } from './types.js';
import { LLMContext } from '@core/llm/types.js';
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

describe('parseDataUri', () => {
    test('should parse valid data URI with image/png', () => {
        const dataUri =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
        const result = parseDataUri(dataUri);

        expect(result).toEqual({
            mediaType: 'image/png',
            base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        });
    });

    test('should parse valid data URI with application/pdf', () => {
        const dataUri =
            'data:application/pdf;base64,JVBERi0xLjQKJdPr6eEKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKdHJhaWxlcgo8PAovU2l6ZSAxCi9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgo5CiUlRU9G';
        const result = parseDataUri(dataUri);

        expect(result).toEqual({
            mediaType: 'application/pdf',
            base64: 'JVBERi0xLjQKJdPr6eEKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKdHJhaWxlcgo8PAovU2l6ZSAxCi9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgo5CiUlRU9G',
        });
    });

    test('should default to application/octet-stream when no mediaType specified', () => {
        const dataUri = 'data:;base64,SGVsbG9Xb3JsZA==';
        const result = parseDataUri(dataUri);

        expect(result).toEqual({
            mediaType: 'application/octet-stream',
            base64: 'SGVsbG9Xb3JsZA==',
        });
    });

    test('should return null for non-data URI strings', () => {
        expect(parseDataUri('https://example.com/image.png')).toBeNull();
        expect(parseDataUri('SGVsbG9Xb3JsZA==')).toBeNull();
        expect(parseDataUri('plain text')).toBeNull();
    });

    test('should return null for malformed data URIs without comma', () => {
        expect(parseDataUri('data:image/png;base64')).toBeNull();
        expect(parseDataUri('data:image/png')).toBeNull();
    });

    test('should return null for data URIs without base64 encoding', () => {
        expect(parseDataUri('data:text/plain,Hello World')).toBeNull();
        expect(parseDataUri('data:image/png;charset=utf8,test')).toBeNull();
    });

    test('should handle case insensitive base64 suffix', () => {
        const dataUri =
            'data:image/png;BASE64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
        const result = parseDataUri(dataUri);

        expect(result).toEqual({
            mediaType: 'image/png',
            base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        });
    });
});

describe('isLikelyBase64String', () => {
    test('should identify valid base64 strings above minimum length', () => {
        // Valid base64 string longer than default minimum (512 chars)
        const longBase64 =
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='.repeat(
                10
            );
        expect(isLikelyBase64String(longBase64)).toBe(true);
    });

    test('should reject regular text even if long', () => {
        const longText = 'This is a regular sentence with normal words and punctuation. '.repeat(
            10
        );
        expect(isLikelyBase64String(longText)).toBe(false);
    });

    test('should reject short strings regardless of content', () => {
        expect(isLikelyBase64String('SGVsbG8=')).toBe(false); // Short but valid base64
        expect(isLikelyBase64String('abc123')).toBe(false);
    });

    test('should accept custom minimum length', () => {
        const shortBase64 = 'SGVsbG9Xb3JsZA=='; // "HelloWorld" in base64
        expect(isLikelyBase64String(shortBase64, 10)).toBe(true);
        expect(isLikelyBase64String(shortBase64, 20)).toBe(false);
    });

    test('should handle null and undefined gracefully', () => {
        expect(isLikelyBase64String('')).toBe(false);
        expect(isLikelyBase64String(null as any)).toBe(false);
        expect(isLikelyBase64String(undefined as any)).toBe(false);
    });

    test('should identify data URIs as base64-like content', () => {
        const dataUri =
            'data:image/png;base64,' +
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='.repeat(
                10
            );
        expect(isLikelyBase64String(dataUri)).toBe(true);
    });

    test('should use heuristic to distinguish base64 from natural text', () => {
        // Base64 has high ratio of alphanumeric chars and specific padding
        const base64Like =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=='.repeat(10);
        expect(isLikelyBase64String(base64Like)).toBe(true);

        // Natural text has more variety and word boundaries
        const naturalText =
            'The quick brown fox jumps over the lazy dog multiple times in this long sentence that repeats itself.'.repeat(
                5
            );
        expect(isLikelyBase64String(naturalText)).toBe(false);
    });
});

describe('sanitizeToolResultToContent', () => {
    test('should convert data URI to image part for image types', () => {
        const imageDataUri =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
        const result = sanitizeToolResultToContent(imageDataUri);

        expect(result).toEqual([
            {
                type: 'image',
                image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
                mimeType: 'image/png',
            },
        ]);
    });

    test('should convert data URI to file part for non-image types', () => {
        const pdfDataUri =
            'data:application/pdf;base64,JVBERi0xLjQKJdPr6eEKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKdHJhaWxlcgo8PAovU2l6ZSAxCi9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgo5CiUlRU9G';
        const result = sanitizeToolResultToContent(pdfDataUri);

        expect(result).toEqual([
            {
                type: 'file',
                data: 'JVBERi0xLjQKJdPr6eEKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKdHJhaWxlcgo8PAovU2l6ZSAxCi9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgo5CiUlRU9G',
                mimeType: 'application/pdf',
            },
        ]);
    });

    test('should convert base64-like strings to file parts', () => {
        const longBase64 =
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='.repeat(
                10
            );
        const result = sanitizeToolResultToContent(longBase64);

        expect(result).toEqual([
            {
                type: 'file',
                data: longBase64,
                mimeType: 'application/octet-stream',
                filename: 'tool-output.bin',
            },
        ]);
    });

    test('should preserve regular text strings as-is', () => {
        const textResult = 'This is a normal tool output with some information.';
        const result = sanitizeToolResultToContent(textResult);

        expect(result).toBe(textResult);
    });

    test('should handle array of mixed content types', () => {
        const mixedArray = [
            'Regular text',
            'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD',
            { type: 'text', text: 'Structured text' },
            { type: 'image', image: 'base64data', mimeType: 'image/png' },
        ];

        const result = sanitizeToolResultToContent(mixedArray);

        expect(Array.isArray(result)).toBe(true);
        const parts = result as any[];
        expect(parts[0]).toEqual({ type: 'text', text: 'Regular text' });
        expect(parts[1]).toEqual({
            type: 'image',
            image: '/9j/4AAQSkZJRgABAQEAYABgAAD',
            mimeType: 'image/jpeg',
        });
        expect(parts[2]).toEqual({ type: 'text', text: 'Structured text' });
        expect(parts[3]).toEqual({
            type: 'image',
            image: expect.any(String),
            mimeType: 'image/png',
        });
    });

    test('should handle objects with image properties', () => {
        const objectWithImage = { image: 'base64imagedata', mimeType: 'image/png' };
        const result = sanitizeToolResultToContent(objectWithImage);

        expect(Array.isArray(result)).toBe(true);
        const parts = result as any[];
        expect(parts).toHaveLength(1);
        expect(parts[0].type).toBe('image');
        expect(parts[0].mimeType).toBe('image/png');
    });

    test('should handle objects with file properties', () => {
        const objectWithFile = {
            type: 'file',
            data: 'filedata',
            mimeType: 'application/pdf',
            filename: 'document.pdf',
        };
        const result = sanitizeToolResultToContent(objectWithFile);

        expect(Array.isArray(result)).toBe(true);
        const parts = result as any[];
        expect(parts).toHaveLength(1);
        expect(parts[0]).toEqual({
            type: 'file',
            data: expect.any(String),
            mimeType: 'application/pdf',
            filename: 'document.pdf',
        });
    });

    test('should gracefully handle null and undefined', () => {
        expect(sanitizeToolResultToContent(null)).toBe('""');
        expect(sanitizeToolResultToContent(undefined)).toBe('""');
    });

    test('should handle complex nested objects safely', () => {
        const complexObject = {
            status: 'success',
            data: {
                results: [
                    { id: 1, name: 'Item 1' },
                    {
                        id: 2,
                        name: 'Item 2',
                        attachment: 'data:text/plain;base64,SGVsbG8gV29ybGQ=',
                    },
                ],
            },
        };

        const result = sanitizeToolResultToContent(complexObject);
        expect(typeof result).toBe('string'); // Falls back to JSON string for complex objects
    });

    test('should handle errors gracefully and provide fallback', () => {
        // Create an object that will cause JSON.stringify to throw
        const circularObject: any = { name: 'test' };
        circularObject.self = circularObject;

        const result = sanitizeToolResultToContent(circularObject);
        expect(typeof result).toBe('string');
        expect(result).toContain('[object Object]'); // String() fallback
    });
});
