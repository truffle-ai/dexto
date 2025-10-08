import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
    filterMessagesByLLMCapabilities,
    parseDataUri,
    isLikelyBase64String,
    getImageDataWithBlobSupport,
    getFileDataWithBlobSupport,
    expandBlobReferences,
} from './utils.js';
import { InternalMessage } from './types.js';
import { LLMContext } from '../llm/types.js';
import * as registry from '../llm/registry.js';
import type { ResourceManager } from '../resources/manager.js';

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

describe('getImageDataWithBlobSupport', () => {
    let mockResourceManager: ResourceManager;

    beforeEach(() => {
        mockResourceManager = {
            read: vi.fn(),
        } as any;
    });

    test('should resolve blob reference and return base64 data', async () => {
        const mockBlob = 'base64ImageData';
        vi.mocked(mockResourceManager.read).mockResolvedValue({
            contents: [{ blob: mockBlob }],
        } as any);

        const result = await getImageDataWithBlobSupport(
            { image: '@blob:abc123' },
            mockResourceManager
        );

        expect(result).toBe(mockBlob);
        expect(mockResourceManager.read).toHaveBeenCalledWith('blob:abc123');
    });

    test('should handle blob reference with blob: prefix already', async () => {
        const mockBlob = 'base64Data';
        vi.mocked(mockResourceManager.read).mockResolvedValue({
            contents: [{ blob: mockBlob }],
        } as any);

        const result = await getImageDataWithBlobSupport(
            { image: '@blob:xyz789' },
            mockResourceManager
        );

        expect(result).toBe(mockBlob);
        expect(mockResourceManager.read).toHaveBeenCalledWith('blob:xyz789');
    });

    test('should fallback to getImageData when blob resolution fails', async () => {
        vi.mocked(mockResourceManager.read).mockRejectedValue(new Error('Not found'));

        await getImageDataWithBlobSupport({ image: '@blob:notfound' }, mockResourceManager);

        // Should fall back and attempt to process as regular image data
        // This will fail gracefully in getImageData, but the test verifies fallback occurs
        expect(mockResourceManager.read).toHaveBeenCalled();
    });

    test('should fallback when blob content is missing', async () => {
        vi.mocked(mockResourceManager.read).mockResolvedValue({
            contents: [{ text: 'not a blob' }],
        } as any);

        await getImageDataWithBlobSupport({ image: '@blob:abc123' }, mockResourceManager);

        // Falls back to getImageData
        expect(mockResourceManager.read).toHaveBeenCalled();
    });

    test('should fallback when blob content is not a string', async () => {
        vi.mocked(mockResourceManager.read).mockResolvedValue({
            contents: [{ blob: 12345 }],
        } as any);

        await getImageDataWithBlobSupport({ image: '@blob:abc123' }, mockResourceManager);

        expect(mockResourceManager.read).toHaveBeenCalled();
    });

    test('should pass through non-blob image data to getImageData', async () => {
        const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';

        const result = await getImageDataWithBlobSupport(
            { image: base64Image },
            mockResourceManager
        );

        // Should not call resource manager for non-blob references
        expect(mockResourceManager.read).not.toHaveBeenCalled();
        expect(result).toBe(base64Image);
    });

    test('should handle Buffer image data', async () => {
        const buffer = Buffer.from('test image data');

        const result = await getImageDataWithBlobSupport({ image: buffer }, mockResourceManager);

        expect(mockResourceManager.read).not.toHaveBeenCalled();
        expect(result).toBe(buffer.toString('base64'));
    });

    test('should handle Uint8Array image data', async () => {
        const uint8Array = new Uint8Array([1, 2, 3, 4]);

        const result = await getImageDataWithBlobSupport(
            { image: uint8Array },
            mockResourceManager
        );

        expect(mockResourceManager.read).not.toHaveBeenCalled();
        expect(result).toBe(Buffer.from(uint8Array).toString('base64'));
    });
});

describe('getFileDataWithBlobSupport', () => {
    let mockResourceManager: ResourceManager;

    beforeEach(() => {
        mockResourceManager = {
            read: vi.fn(),
        } as any;
    });

    test('should resolve blob reference and return base64 data', async () => {
        const mockBlob = 'base64FileData';
        vi.mocked(mockResourceManager.read).mockResolvedValue({
            contents: [{ blob: mockBlob }],
        } as any);

        const result = await getFileDataWithBlobSupport(
            { data: '@blob:file123' },
            mockResourceManager
        );

        expect(result).toBe(mockBlob);
        expect(mockResourceManager.read).toHaveBeenCalledWith('blob:file123');
    });

    test('should handle blob reference with blob: prefix', async () => {
        const mockBlob = 'pdfBase64Data';
        vi.mocked(mockResourceManager.read).mockResolvedValue({
            contents: [{ blob: mockBlob }],
        } as any);

        const result = await getFileDataWithBlobSupport(
            { data: '@blob:doc456' },
            mockResourceManager
        );

        expect(result).toBe(mockBlob);
    });

    test('should fallback when blob resolution fails', async () => {
        vi.mocked(mockResourceManager.read).mockRejectedValue(new Error('Blob not found'));

        await getFileDataWithBlobSupport({ data: '@blob:missing' }, mockResourceManager);

        expect(mockResourceManager.read).toHaveBeenCalled();
    });

    test('should fallback when blob content is missing', async () => {
        vi.mocked(mockResourceManager.read).mockResolvedValue({
            contents: [{}],
        } as any);

        await getFileDataWithBlobSupport({ data: '@blob:abc123' }, mockResourceManager);

        expect(mockResourceManager.read).toHaveBeenCalled();
    });

    test('should pass through non-blob file data to getFileData', async () => {
        const base64File = 'JVBERi0xLjQKJdPr6eEK'; // PDF header in base64

        const result = await getFileDataWithBlobSupport({ data: base64File }, mockResourceManager);

        expect(mockResourceManager.read).not.toHaveBeenCalled();
        expect(result).toBe(base64File);
    });

    test('should handle Buffer file data', async () => {
        const buffer = Buffer.from('file content');

        const result = await getFileDataWithBlobSupport({ data: buffer }, mockResourceManager);

        expect(mockResourceManager.read).not.toHaveBeenCalled();
        expect(result).toBe(buffer.toString('base64'));
    });

    test('should handle Uint8Array file data', async () => {
        const uint8Array = new Uint8Array([80, 68, 70, 45]); // PDF signature

        const result = await getFileDataWithBlobSupport({ data: uint8Array }, mockResourceManager);

        expect(mockResourceManager.read).not.toHaveBeenCalled();
        expect(result).toBe(Buffer.from(uint8Array).toString('base64'));
    });
});

describe('expandBlobReferences', () => {
    let mockResourceManager: ResourceManager;

    beforeEach(() => {
        mockResourceManager = {
            read: vi.fn(),
        } as any;
    });

    test('should expand blob reference in string content', async () => {
        vi.mocked(mockResourceManager.read).mockResolvedValue({
            contents: [{ blob: 'expandedBlobData', mimeType: 'image/png' }],
        } as any);

        const result = await expandBlobReferences(
            'Check this image: @blob:abc123ef',
            mockResourceManager
        );

        expect(Array.isArray(result)).toBe(true);
        if (Array.isArray(result)) {
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ type: 'text', text: 'Check this image: ' });
            expect(result[1]).toEqual({
                type: 'image',
                image: 'data:image/png;base64,expandedBlobData',
                mimeType: 'image/png',
            });
        }
    });

    test('should expand multiple blob references in string', async () => {
        vi.mocked(mockResourceManager.read)
            .mockResolvedValueOnce({
                contents: [{ blob: 'blob1Data', mimeType: 'image/png' }],
            } as any)
            .mockResolvedValueOnce({
                contents: [{ blob: 'blob2Data', mimeType: 'image/jpeg' }],
            } as any);

        const result = await expandBlobReferences(
            '@blob:abc123 and @blob:def456',
            mockResourceManager
        );

        expect(Array.isArray(result)).toBe(true);
        if (Array.isArray(result)) {
            expect(result).toHaveLength(3);
            expect(result[0]).toMatchObject({
                type: 'image',
                image: 'data:image/png;base64,blob1Data',
            });
            expect(result[1]).toEqual({ type: 'text', text: ' and ' });
            expect(result[2]).toMatchObject({
                type: 'image',
                image: 'data:image/jpeg;base64,blob2Data',
            });
        }
    });

    test('should handle blob references in array content with image parts', async () => {
        vi.mocked(mockResourceManager.read).mockResolvedValue({
            contents: [{ blob: 'resolvedImageData', mimeType: 'image/png' }],
        } as any);

        const content = [
            { type: 'text' as const, text: 'Look at this' },
            { type: 'image' as const, image: '@blob:abc123ef' },
        ];

        const result = await expandBlobReferences(content, mockResourceManager);

        expect(Array.isArray(result)).toBe(true);
        if (Array.isArray(result)) {
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ type: 'text', text: 'Look at this' });
            expect(result[1]).toMatchObject({
                type: 'image',
                image: 'data:image/png;base64,resolvedImageData',
            });
        }
    });

    test('should handle blob references in file parts', async () => {
        vi.mocked(mockResourceManager.read).mockResolvedValue({
            contents: [{ blob: 'resolvedFileData', mimeType: 'application/pdf' }],
        } as any);

        const content = [
            { type: 'file' as const, data: '@blob:mydoc', mimeType: 'application/pdf' },
        ];

        const result = await expandBlobReferences(content, mockResourceManager);

        expect(Array.isArray(result)).toBe(true);
        if (Array.isArray(result)) {
            expect(result[0]).toMatchObject({
                type: 'file',
                data: 'resolvedFileData',
            });
        }
    });

    test('should cache resolved blob references', async () => {
        vi.mocked(mockResourceManager.read).mockResolvedValue({
            contents: [{ blob: 'cachedData', mimeType: 'image/png' }],
        } as any);

        await expandBlobReferences('@blob:abcdef @blob:abcdef', mockResourceManager);

        // Should only call read once due to caching
        expect(mockResourceManager.read).toHaveBeenCalledTimes(1);
        expect(mockResourceManager.read).toHaveBeenCalledWith('blob:abcdef');
    });

    test('should handle failed blob resolution gracefully', async () => {
        vi.mocked(mockResourceManager.read).mockRejectedValue(new Error('Not found'));

        const result = await expandBlobReferences(
            'Text with @blob:abcdef reference',
            mockResourceManager
        );

        expect(Array.isArray(result)).toBe(true);
        if (Array.isArray(result)) {
            // Should include placeholder text for unavailable attachment
            const textParts = result.filter((p: any) => p.type === 'text');
            expect(textParts.length).toBeGreaterThan(0);
            const fallbackText = textParts.find((p: any) =>
                p.text.includes('[Attachment unavailable')
            );
            expect(fallbackText).toBeDefined();
        }
    });

    test('should return content unchanged when no blob references', async () => {
        const content = 'Plain text with no blobs';

        const result = await expandBlobReferences(content, mockResourceManager);

        expect(result).toBe(content);
        expect(mockResourceManager.read).not.toHaveBeenCalled();
    });

    test('should return array unchanged when no blob references in parts', async () => {
        const content = [
            { type: 'text' as const, text: 'Hello' },
            { type: 'text' as const, text: 'World' },
        ];

        const result = await expandBlobReferences(content, mockResourceManager);

        expect(result).toEqual(content);
        expect(mockResourceManager.read).not.toHaveBeenCalled();
    });

    test('should handle nested blob references in text parts', async () => {
        vi.mocked(mockResourceManager.read).mockResolvedValue({
            contents: [{ blob: 'nestedBlobData', mimeType: 'image/png' }],
        } as any);

        const content = [{ type: 'text' as const, text: 'Before @blob:abcdef After' }];

        const result = await expandBlobReferences(content, mockResourceManager);

        expect(Array.isArray(result)).toBe(true);
        if (Array.isArray(result)) {
            // Should expand nested blob reference within text part
            expect(result.length).toBeGreaterThan(1);
            const imagePart = result.find((p: any) => p.type === 'image');
            expect(imagePart).toBeDefined();
        }
    });
});
