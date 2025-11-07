import { describe, expect, it, test, beforeEach, vi } from 'vitest';
import type {
    BlobStore,
    BlobInput,
    BlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
    StoredBlobMetadata,
} from '../storage/blob/types.js';
import {
    normalizeToolResult,
    persistToolMedia,
    filterMessagesByLLMCapabilities,
    parseDataUri,
    isLikelyBase64String,
    getFileMediaKind,
    getResourceKind,
    matchesMimePattern,
    matchesAnyMimePattern,
    fileTypesToMimePatterns,
} from './utils.js';
import { InternalMessage } from './types.js';
import { LLMContext } from '../llm/types.js';
import * as registry from '../llm/registry.js';
import { IDextoLogger } from '../logger/v2/types.js';

// Mock the registry module
vi.mock('../llm/registry.js');
const mockValidateModelFileSupport = vi.mocked(registry.validateModelFileSupport);

// Create a mock logger for tests
const mockLogger: IDextoLogger = {
    debug: vi.fn(),
    silly: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trackException: vi.fn(),
    createChild: vi.fn(),
    destroy: vi.fn(),
};

class FakeBlobStore implements BlobStore {
    private counter = 0;
    private connected = true;
    private readonly storage = new Map<string, Buffer>();
    private readonly metadata = new Map<string, StoredBlobMetadata>();

    async store(input: BlobInput, metadata: BlobMetadata = {}): Promise<BlobReference> {
        const buffer = this.toBuffer(input);
        const id = `fake-${this.counter++}`;
        const storedMetadata: StoredBlobMetadata = {
            id,
            mimeType: metadata.mimeType ?? 'application/octet-stream',
            originalName: metadata.originalName,
            createdAt: metadata.createdAt ?? new Date(),
            size: buffer.length,
            hash: id,
            source: metadata.source,
        };

        this.storage.set(id, buffer);
        this.metadata.set(id, storedMetadata);

        return {
            id,
            uri: `blob:${id}`,
            metadata: storedMetadata,
        };
    }

    async retrieve(
        _reference: string,
        _format?: 'base64' | 'buffer' | 'path' | 'stream' | 'url'
    ): Promise<BlobData> {
        throw new Error('Not implemented in FakeBlobStore');
    }

    async exists(reference: string): Promise<boolean> {
        return this.storage.has(this.parse(reference));
    }

    async delete(reference: string): Promise<void> {
        const id = this.parse(reference);
        this.storage.delete(id);
        this.metadata.delete(id);
    }

    async cleanup(_olderThan?: Date | undefined): Promise<number> {
        const count = this.storage.size;
        this.storage.clear();
        this.metadata.clear();
        return count;
    }

    async getStats(): Promise<BlobStats> {
        let totalSize = 0;
        for (const buffer of this.storage.values()) {
            totalSize += buffer.length;
        }
        return {
            count: this.storage.size,
            totalSize,
            backendType: 'fake',
            storePath: 'memory://fake',
        };
    }

    async listBlobs(): Promise<BlobReference[]> {
        return Array.from(this.metadata.values()).map((meta) => ({
            id: meta.id,
            uri: `blob:${meta.id}`,
            metadata: meta,
        }));
    }

    getStoragePath(): string | undefined {
        return undefined;
    }

    async connect(): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'fake';
    }

    private toBuffer(input: BlobInput): Buffer {
        if (Buffer.isBuffer(input)) {
            return input;
        }
        if (input instanceof Uint8Array) {
            return Buffer.from(input);
        }
        if (input instanceof ArrayBuffer) {
            return Buffer.from(new Uint8Array(input));
        }
        if (typeof input === 'string') {
            try {
                return Buffer.from(input, 'base64');
            } catch {
                return Buffer.from(input, 'utf-8');
            }
        }
        throw new Error('Unsupported blob input');
    }

    private parse(reference: string): string {
        return reference.startsWith('blob:') ? reference.slice(5) : reference;
    }
}

describe('tool result normalization pipeline', () => {
    it('normalizes data URI media into typed parts with inline media hints', async () => {
        const payload = Buffer.alloc(2048, 1);
        const dataUri = `data:image/png;base64,${payload.toString('base64')}`;

        const normalized = await normalizeToolResult(dataUri, mockLogger);

        expect(normalized.parts).toHaveLength(1);
        const part = normalized.parts[0];
        if (!part) {
            throw new Error('expected normalized image part');
        }
        expect(part.type).toBe('image');
        expect(normalized.inlineMedia).toHaveLength(1);
        const hint = normalized.inlineMedia[0];
        if (!hint) {
            throw new Error('expected inline media hint for data URI');
        }
        expect(hint.mimeType).toBe('image/png');
    });

    it('persists large inline media to the blob store and produces resource descriptors', async () => {
        const payload = Buffer.alloc(4096, 7);
        const dataUri = `data:image/jpeg;base64,${payload.toString('base64')}`;

        const normalized = await normalizeToolResult(dataUri, mockLogger);
        const store = new FakeBlobStore();

        const persisted = await persistToolMedia(
            normalized,
            {
                blobStore: store,
                toolName: 'image_tool',
                toolCallId: 'call-123',
            },
            mockLogger
        );

        expect(persisted.parts).toHaveLength(1);
        const part = persisted.parts[0];
        if (!part || part.type !== 'image') {
            throw new Error('expected image part after persistence');
        }
        expect(typeof part.image).toBe('string');
        expect(part.image).toMatch(/^@blob:/);
        expect(persisted.resources).toBeDefined();
        expect(persisted.resources?.[0]?.kind).toBe('image');
    });

    it('always persists video media regardless of payload size', async () => {
        const payload = Buffer.alloc(256, 3);
        const raw = [
            {
                type: 'file',
                data: payload.toString('base64'),
                mimeType: 'video/mp4',
            },
        ];

        const normalized = await normalizeToolResult(raw, mockLogger);
        const hint = normalized.inlineMedia[0];
        if (!hint) {
            throw new Error('expected inline media hint for video payload');
        }
        // Video should be persisted regardless of size
        expect(hint.mimeType).toBe('video/mp4');

        const store = new FakeBlobStore();
        const persisted = await persistToolMedia(
            normalized,
            {
                blobStore: store,
                toolName: 'video_tool',
                toolCallId: 'call-456',
            },
            mockLogger
        );

        const filePart = persisted.parts[0];
        if (!filePart || filePart.type !== 'file') {
            throw new Error('expected file part after persistence');
        }
        expect(typeof filePart.data).toBe('string');
        expect(filePart.data).toMatch(/^@blob:/);
        expect(persisted.resources?.[0]?.kind).toBe('video');
    });
});

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

        const config: LLMContext = { provider: 'openai', model: 'gpt-5' };

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

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

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

        expect(result[0]!.content).toEqual([{ type: 'text', text: 'Analyze this document' }]);
        expect(mockValidateModelFileSupport).toHaveBeenCalledWith(
            config.provider,
            config.model,
            'application/pdf'
        );
    });

    test('should keep supported file attachments for models that support them', () => {
        // Mock validation to accept PDF files for gpt-5
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

        const config: LLMContext = { provider: 'openai', model: 'gpt-5' };

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

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
                error: 'Model gpt-5 does not support audio files',
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

        // Test with regular gpt-5 (should filter out audio)
        const config1: LLMContext = { provider: 'openai', model: 'gpt-5' };
        const result1 = filterMessagesByLLMCapabilities(messages, config1, mockLogger);

        expect(result1[0]!.content).toEqual([{ type: 'text', text: 'Transcribe this audio' }]);

        // Test with gpt-4o-audio-preview (should keep audio)
        const config2: LLMContext = { provider: 'openai', model: 'gpt-4o-audio-preview' };
        const result2 = filterMessagesByLLMCapabilities(messages, config2, mockLogger);

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

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

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

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

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

        const config: LLMContext = { provider: 'openai', model: 'gpt-5' };

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

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

        const config: LLMContext = { provider: 'openai', model: 'gpt-5' };

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

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

        const config: LLMContext = { provider: 'openai', model: 'gpt-5' };

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

        // Should add placeholder text for empty content
        expect(result[0]!.content).toEqual([
            { type: 'text', text: '[File attachment removed - not supported by gpt-5]' },
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

describe('getFileMediaKind', () => {
    test('should detect audio from MIME type', () => {
        expect(getFileMediaKind('audio/mp3')).toBe('audio');
        expect(getFileMediaKind('audio/mpeg')).toBe('audio');
        expect(getFileMediaKind('audio/wav')).toBe('audio');
        expect(getFileMediaKind('audio/ogg')).toBe('audio');
    });

    test('should detect video from MIME type', () => {
        expect(getFileMediaKind('video/mp4')).toBe('video');
        expect(getFileMediaKind('video/webm')).toBe('video');
        expect(getFileMediaKind('video/quicktime')).toBe('video');
        expect(getFileMediaKind('video/x-msvideo')).toBe('video');
    });

    test('should default to binary for other types', () => {
        expect(getFileMediaKind('application/pdf')).toBe('binary');
        expect(getFileMediaKind('text/plain')).toBe('binary');
        expect(getFileMediaKind('application/json')).toBe('binary');
        expect(getFileMediaKind('image/png')).toBe('binary');
    });

    test('should handle undefined gracefully', () => {
        expect(getFileMediaKind(undefined)).toBe('binary');
    });

    test('should handle empty string', () => {
        expect(getFileMediaKind('')).toBe('binary');
    });
});

describe('getResourceKind', () => {
    test('should detect image from MIME type', () => {
        expect(getResourceKind('image/png')).toBe('image');
        expect(getResourceKind('image/jpeg')).toBe('image');
        expect(getResourceKind('image/gif')).toBe('image');
        expect(getResourceKind('image/webp')).toBe('image');
    });

    test('should detect audio from MIME type', () => {
        expect(getResourceKind('audio/mp3')).toBe('audio');
        expect(getResourceKind('audio/mpeg')).toBe('audio');
        expect(getResourceKind('audio/wav')).toBe('audio');
    });

    test('should detect video from MIME type', () => {
        expect(getResourceKind('video/mp4')).toBe('video');
        expect(getResourceKind('video/webm')).toBe('video');
        expect(getResourceKind('video/quicktime')).toBe('video');
    });

    test('should default to binary for other types', () => {
        expect(getResourceKind('application/pdf')).toBe('binary');
        expect(getResourceKind('text/plain')).toBe('binary');
        expect(getResourceKind('application/json')).toBe('binary');
    });

    test('should handle undefined gracefully', () => {
        expect(getResourceKind(undefined)).toBe('binary');
    });

    test('should handle empty string', () => {
        expect(getResourceKind('')).toBe('binary');
    });
});

describe('matchesMimePattern', () => {
    test('should match exact MIME types', () => {
        expect(matchesMimePattern('image/png', 'image/png')).toBe(true);
        expect(matchesMimePattern('video/mp4', 'video/mp4')).toBe(true);
        expect(matchesMimePattern('application/pdf', 'application/pdf')).toBe(true);
    });

    test('should match wildcard patterns', () => {
        expect(matchesMimePattern('image/png', 'image/*')).toBe(true);
        expect(matchesMimePattern('image/jpeg', 'image/*')).toBe(true);
        expect(matchesMimePattern('video/mp4', 'video/*')).toBe(true);
        expect(matchesMimePattern('audio/mpeg', 'audio/*')).toBe(true);
    });

    test('should match universal wildcard', () => {
        expect(matchesMimePattern('image/png', '*')).toBe(true);
        expect(matchesMimePattern('video/mp4', '*/*')).toBe(true);
        expect(matchesMimePattern('application/pdf', '*')).toBe(true);
    });

    test('should not match different types', () => {
        expect(matchesMimePattern('image/png', 'video/*')).toBe(false);
        expect(matchesMimePattern('video/mp4', 'image/*')).toBe(false);
        expect(matchesMimePattern('application/pdf', 'image/*')).toBe(false);
    });

    test('should be case insensitive', () => {
        expect(matchesMimePattern('IMAGE/PNG', 'image/*')).toBe(true);
        expect(matchesMimePattern('image/png', 'IMAGE/*')).toBe(true);
        expect(matchesMimePattern('Video/MP4', 'video/*')).toBe(true);
    });

    test('should handle undefined MIME type', () => {
        expect(matchesMimePattern(undefined, 'image/*')).toBe(false);
        expect(matchesMimePattern(undefined, '*')).toBe(false);
    });

    test('should trim whitespace', () => {
        expect(matchesMimePattern(' image/png ', 'image/*')).toBe(true);
        expect(matchesMimePattern('image/png', ' image/* ')).toBe(true);
    });
});

describe('matchesAnyMimePattern', () => {
    test('should match if any pattern matches', () => {
        expect(matchesAnyMimePattern('image/png', ['video/*', 'image/*'])).toBe(true);
        expect(matchesAnyMimePattern('video/mp4', ['image/*', 'video/*', 'audio/*'])).toBe(true);
    });

    test('should not match if no patterns match', () => {
        expect(matchesAnyMimePattern('image/png', ['video/*', 'audio/*'])).toBe(false);
        expect(matchesAnyMimePattern('application/pdf', ['image/*', 'video/*'])).toBe(false);
    });

    test('should handle empty pattern array', () => {
        expect(matchesAnyMimePattern('image/png', [])).toBe(false);
    });

    test('should handle exact and wildcard mix', () => {
        expect(matchesAnyMimePattern('image/png', ['video/mp4', 'image/*'])).toBe(true);
        expect(matchesAnyMimePattern('video/mp4', ['video/mp4', 'audio/*'])).toBe(true);
    });
});

describe('fileTypesToMimePatterns', () => {
    test('should convert image file type', () => {
        expect(fileTypesToMimePatterns(['image'], mockLogger)).toEqual(['image/*']);
    });

    test('should convert pdf file type', () => {
        expect(fileTypesToMimePatterns(['pdf'], mockLogger)).toEqual(['application/pdf']);
    });

    test('should convert audio file type', () => {
        expect(fileTypesToMimePatterns(['audio'], mockLogger)).toEqual(['audio/*']);
    });

    test('should convert video file type', () => {
        expect(fileTypesToMimePatterns(['video'], mockLogger)).toEqual(['video/*']);
    });

    test('should convert multiple file types', () => {
        expect(fileTypesToMimePatterns(['image', 'pdf', 'audio'], mockLogger)).toEqual([
            'image/*',
            'application/pdf',
            'audio/*',
        ]);
    });

    test('should handle empty array', () => {
        expect(fileTypesToMimePatterns([], mockLogger)).toEqual([]);
    });

    test('should skip unknown file types', () => {
        // Unknown types are logged as warnings but not added to patterns
        expect(fileTypesToMimePatterns(['image', 'unknown', 'pdf'], mockLogger)).toEqual([
            'image/*',
            'application/pdf',
        ]);
    });
});
