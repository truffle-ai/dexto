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
    filterCompacted,
    sanitizeToolResultToContentWithBlobs,
    estimateStringTokens,
    estimateImageTokens,
    estimateFileTokens,
    estimateContentPartTokens,
    estimateMessagesTokens,
    estimateToolsTokens,
    estimateContextTokens,
} from './utils.js';
import { InternalMessage, ContentPart, FilePart } from './types.js';
import { LLMContext } from '../llm/types.js';
import * as registry from '../llm/registry/index.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

// Mock the registry module
vi.mock('../llm/registry/index.js');
const mockValidateModelFileSupport = vi.mocked(registry.validateModelFileSupport);

// Create a mock logger for tests
const mockLogger = createMockLogger();

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

import { sanitizeToolResult } from './utils.js';

describe('sanitizeToolResult success tracking', () => {
    it('should include success=true in meta when tool succeeds', async () => {
        const result = await sanitizeToolResult(
            { data: 'test result' },
            {
                toolName: 'test_tool',
                toolCallId: 'call-123',
                success: true,
            },
            mockLogger
        );

        expect(result.meta.success).toBe(true);
        expect(result.meta.toolName).toBe('test_tool');
        expect(result.meta.toolCallId).toBe('call-123');
    });

    it('should include success=false in meta when tool fails', async () => {
        const result = await sanitizeToolResult(
            { error: 'Something went wrong' },
            {
                toolName: 'failing_tool',
                toolCallId: 'call-456',
                success: false,
            },
            mockLogger
        );

        expect(result.meta.success).toBe(false);
        expect(result.meta.toolName).toBe('failing_tool');
        expect(result.meta.toolCallId).toBe('call-456');
    });

    it('should preserve success status through blob storage', async () => {
        const store = new FakeBlobStore();
        const payload = Buffer.alloc(4096, 7);
        const dataUri = `data:image/jpeg;base64,${payload.toString('base64')}`;

        const result = await sanitizeToolResult(
            dataUri,
            {
                blobStore: store,
                toolName: 'image_tool',
                toolCallId: 'call-789',
                success: true,
            },
            mockLogger
        );

        expect(result.meta.success).toBe(true);
        // Expect 2 parts: image + blob reference annotation text
        expect(result.content).toHaveLength(2);
        expect(result.content[0]?.type).toBe('image');
        expect(result.content[1]?.type).toBe('text');
    });

    it('should track failed tool results with complex output', async () => {
        const errorOutput = {
            error: 'Tool execution failed',
            details: { code: 'TIMEOUT', message: 'Request timed out after 30s' },
        };

        const result = await sanitizeToolResult(
            errorOutput,
            {
                toolName: 'api_call',
                toolCallId: 'call-error',
                success: false,
            },
            mockLogger
        );

        expect(result.meta.success).toBe(false);
        // Content should still be present even for failures
        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
    });

    it('should handle empty result with success status', async () => {
        const result = await sanitizeToolResult(
            '',
            {
                toolName: 'void_tool',
                toolCallId: 'call-empty',
                success: true,
            },
            mockLogger
        );

        expect(result.meta.success).toBe(true);
        // Should have fallback content
        expect(result.content).toBeDefined();
    });
});

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

        // Expect 2 parts: image + blob reference annotation text
        expect(persisted.parts).toHaveLength(2);
        const part = persisted.parts[0];
        if (!part || part.type !== 'image') {
            throw new Error('expected image part after persistence');
        }
        expect(typeof part.image).toBe('string');
        expect(part.image).toMatch(/^@blob:/);

        // Verify annotation text part
        // Uses "resource_ref:" prefix to avoid expansion by expandBlobsInText()
        const annotationPart = persisted.parts[1];
        expect(annotationPart?.type).toBe('text');
        if (annotationPart?.type === 'text') {
            expect(annotationPart.text).toContain('resource_ref:blob:');
            expect(annotationPart.text).toContain('image/jpeg');
            // Should NOT contain @blob: which would trigger expansion
            expect(annotationPart.text).not.toContain('@blob:');
        }

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
            fileType: 'pdf',
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

        expect(result[0]!.content).toEqual([
            { type: 'text', text: 'Analyze this document' },
            {
                type: 'text',
                text: 'ERROR: Cannot read "doc.pdf" (this model does not support pdf input). Inform the user.',
            },
        ]);
        expect(mockValidateModelFileSupport).toHaveBeenCalledWith(
            config.provider,
            config.model,
            'application/pdf'
        );
        // Verify logging
        expect(mockLogger.info).toHaveBeenCalledWith(
            "Filtered 1 file for gpt-3.5-turbo since it doesn't support that file type"
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
                fileType: 'audio',
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

        expect(result1[0]!.content).toEqual([
            { type: 'text', text: 'Transcribe this audio' },
            {
                type: 'text',
                text: 'ERROR: Cannot read "recording.mp3" (this model does not support audio input). Inform the user.',
            },
        ]);
        // Verify logging for filtered audio
        expect(mockLogger.info).toHaveBeenCalledWith(
            "Filtered 1 file for gpt-5 since it doesn't support that file type"
        );

        // Test with gpt-4o-audio-preview (should keep audio)
        const config2: LLMContext = { provider: 'openai', model: 'gpt-4o-audio-preview' };
        const result2 = filterMessagesByLLMCapabilities(messages, config2, mockLogger);

        expect(result2[0]!.content).toEqual([
            { type: 'text', text: 'Transcribe this audio' },
            { type: 'file', data: 'audiodata', mimeType: 'audio/mp3', filename: 'recording.mp3' },
        ]);
    });

    test('should add placeholder text when all content is filtered out', () => {
        // Mock validation to reject all files with proper error format
        mockValidateModelFileSupport.mockReturnValue({
            isSupported: false,
            error: "Model 'gpt-3.5-turbo' (openai) does not support pdf files",
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
            {
                type: 'text',
                text: 'ERROR: Cannot read "doc.pdf" (this model does not support this file type input). Inform the user.',
            },
        ]);
        // Verify logging
        expect(mockLogger.info).toHaveBeenCalledWith(
            "Filtered 1 file for gpt-3.5-turbo since it doesn't support that file type"
        );
    });

    test('should keep files when validation returns unknown error (internal error)', () => {
        // Mock validation to return an internal error (not "does not support")
        mockValidateModelFileSupport.mockReturnValue({
            isSupported: false,
            error: 'Unknown error validating model file support',
        });

        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Analyze this' },
                    {
                        type: 'file',
                        data: 'data',
                        mimeType: 'application/pdf',
                        filename: 'doc.pdf',
                    },
                ],
            },
        ];

        const config: LLMContext = { provider: 'openai', model: 'gpt-3.5-turbo' };

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

        // File should be KEPT when validation errored (unknown error)
        expect(result[0]?.content).toEqual(messages[0]?.content);
        // Should log a warning instead of info
        expect(mockLogger.warn).toHaveBeenCalledWith(
            'Could not validate file support for gpt-3.5-turbo: Unknown error validating model file support'
        );
        expect(mockLogger.info).not.toHaveBeenCalled();
    });

    test('should only filter user messages with array content', () => {
        // Note: system, assistant, and tool messages use string content for simplicity in tests.
        // The function only processes user messages with array content.
        const messages = [
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
        ] as unknown as InternalMessage[];

        // Mock validation to reject the file
        mockValidateModelFileSupport.mockReturnValue({
            isSupported: false,
            fileType: 'pdf',
            error: "Model 'gpt-3.5-turbo' (openai) does not support pdf files",
        });

        const config: LLMContext = { provider: 'openai', model: 'gpt-3.5-turbo' };

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

        // Only the user message with array content should be modified
        expect(result[0]).toEqual(messages[0]); // system unchanged
        expect(result[1]).toEqual(messages[1]); // assistant unchanged
        expect(result[2]).toEqual(messages[2]); // tool unchanged
        expect(result[3]!.content).toEqual([
            { type: 'text', text: 'Analyze this' },
            {
                type: 'text',
                text: 'ERROR: Cannot read this file (this model does not support pdf input). Inform the user.',
            },
        ]); // user message filtered
        // Verify logging for filtered file
        expect(mockLogger.info).toHaveBeenCalledWith(
            "Filtered 1 file for gpt-3.5-turbo since it doesn't support that file type"
        );
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

    test('should filter out images for models that do not support vision (e.g., glm-4.7)', () => {
        // Mock validation to reject images for models like glm-4.7 which has supportedFileTypes: []
        mockValidateModelFileSupport.mockReturnValue({
            isSupported: false,
            fileType: 'image',
            error: 'Model glm-4.7 (dexto-nova) does not support image files',
        });

        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Describe these screenshots' },
                    { type: 'image', image: 'base64data1', mimeType: 'image/png' },
                    { type: 'image', image: 'base64data2', mimeType: 'image/jpeg' },
                ],
            },
        ];

        const config: LLMContext = { provider: 'dexto-nova', model: 'z-ai/glm-4.7' };

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

        // Both images should be removed from the request and replaced with text placeholders.
        expect(result[0]!.content).toEqual([
            { type: 'text', text: 'Describe these screenshots' },
            {
                type: 'text',
                text: 'ERROR: Cannot read image (this model does not support image input). Inform the user.',
            },
            {
                type: 'text',
                text: 'ERROR: Cannot read image (this model does not support image input). Inform the user.',
            },
        ]);
        // Verify validation was called for each image
        expect(mockValidateModelFileSupport).toHaveBeenCalledTimes(2);
        expect(mockValidateModelFileSupport).toHaveBeenCalledWith(
            'dexto-nova',
            'z-ai/glm-4.7',
            'image/png'
        );
        expect(mockValidateModelFileSupport).toHaveBeenCalledWith(
            'dexto-nova',
            'z-ai/glm-4.7',
            'image/jpeg'
        );
        // Verify logging
        expect(mockLogger.info).toHaveBeenCalledWith(
            "Filtered 2 images for z-ai/glm-4.7 since it doesn't support images"
        );
    });

    test('should filter out images for minimax model which does not support vision', () => {
        // Mock validation to reject images for minimax-m2.1 which has supportedFileTypes: []
        mockValidateModelFileSupport.mockReturnValue({
            isSupported: false,
            fileType: 'image',
            error: 'Model minimax-m2.1 (dexto-nova) does not support image files',
        });

        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Analyze this image' },
                    { type: 'image', image: 'screenshotdata', mimeType: 'image/png' },
                ],
            },
        ];

        const config: LLMContext = { provider: 'dexto-nova', model: 'minimax/minimax-m2.1' };

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

        expect(result[0]!.content).toEqual([
            { type: 'text', text: 'Analyze this image' },
            {
                type: 'text',
                text: 'ERROR: Cannot read image (this model does not support image input). Inform the user.',
            },
        ]);
        expect(mockValidateModelFileSupport).toHaveBeenCalledWith(
            'dexto-nova',
            'minimax/minimax-m2.1',
            'image/png'
        );
        // Verify logging
        expect(mockLogger.info).toHaveBeenCalledWith(
            "Filtered 1 image for minimax/minimax-m2.1 since it doesn't support images"
        );
    });

    test('should keep images for models that support vision (e.g., gpt-4o)', () => {
        // Mock validation to accept images for gpt-4o which has supportedFileTypes: ['pdf', 'image']
        mockValidateModelFileSupport.mockReturnValue({
            isSupported: true,
            fileType: 'image',
        });

        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'What do you see?' },
                    { type: 'image', image: 'base64data', mimeType: 'image/png' },
                ],
            },
        ];

        const config: LLMContext = { provider: 'openai', model: 'gpt-4o' };

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

        // Images should be kept for vision-capable models
        expect(result).toEqual(messages);
        expect(mockValidateModelFileSupport).toHaveBeenCalledWith('openai', 'gpt-4o', 'image/png');
    });

    test('should filter images and keep text when switching from vision to non-vision model', () => {
        // Simulate: conversation started with Claude (supports images), switched to glm-4.7 (no vision)
        // First message had images, second is text only
        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Look at this screenshot and help me debug' },
                    { type: 'image', image: 'errorScreenshot', mimeType: 'image/png' },
                ],
            },
            {
                role: 'assistant',
                content: [{ type: 'text', text: 'I can see the issue. The error is...' }],
            },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Thanks! Can you also check this log file?' },
                    { type: 'file', data: 'logdata', mimeType: 'text/plain', filename: 'app.log' },
                ],
            },
        ];

        // Mock validation to reject both images and files for glm-4.7
        mockValidateModelFileSupport.mockReturnValue({
            isSupported: false,
            error: "Model 'z-ai/glm-4.7' (dexto-nova) does not support image files",
        });

        const config: LLMContext = { provider: 'dexto-nova', model: 'z-ai/glm-4.7' };

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

        // First user message: image should be filtered, text kept
        expect(result[0]!.content).toEqual([
            { type: 'text', text: 'Look at this screenshot and help me debug' },
            {
                type: 'text',
                text: 'ERROR: Cannot read image (this model does not support image input). Inform the user.',
            },
        ]);

        // Assistant message unchanged (not array content)
        expect(result[1]).toEqual(messages[1]);

        // Second user message: file should be filtered, text kept
        expect(result[2]!.content).toEqual([
            { type: 'text', text: 'Thanks! Can you also check this log file?' },
            {
                type: 'text',
                text: 'ERROR: Cannot read "app.log" (this model does not support this file type input). Inform the user.',
            },
        ]);
    });

    test('should handle images without explicit mimeType (defaults to image/jpeg)', () => {
        // Some image parts may not have mimeType set
        mockValidateModelFileSupport.mockReturnValue({
            isSupported: false,
            error: "Model 'minimax/minimax-m2.1' (dexto-nova) does not support image files",
        });

        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Describe this' },
                    // Image without mimeType
                    { type: 'image', image: 'base64data' },
                ],
            },
        ];

        const config: LLMContext = { provider: 'dexto-nova', model: 'minimax/minimax-m2.1' };

        const result = filterMessagesByLLMCapabilities(messages, config, mockLogger);

        // Image should still be filtered (uses default image/jpeg)
        expect(result[0]!.content).toEqual([
            { type: 'text', text: 'Describe this' },
            {
                type: 'text',
                text: 'ERROR: Cannot read image (this model does not support image input). Inform the user.',
            },
        ]);
        expect(mockValidateModelFileSupport).toHaveBeenCalledWith(
            'dexto-nova',
            'minimax/minimax-m2.1',
            'image/jpeg'
        );
        // Verify logging
        expect(mockLogger.info).toHaveBeenCalledWith(
            "Filtered 1 image for minimax/minimax-m2.1 since it doesn't support images"
        );
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

describe('expandBlobReferences', () => {
    // Import the function we're testing
    let expandBlobReferences: typeof import('./utils.js').expandBlobReferences;

    beforeEach(async () => {
        const utils = await import('./utils.js');
        expandBlobReferences = utils.expandBlobReferences;
    });

    // Create a mock ResourceManager
    function createMockResourceManager(
        blobData: Record<string, { blob?: string; mimeType?: string; text?: string }>
    ) {
        return {
            read: vi.fn(async (uri: string) => {
                const id = uri.startsWith('blob:') ? uri.slice(5) : uri;
                const data = blobData[id];
                if (!data) {
                    throw new Error(`Blob not found: ${uri}`);
                }
                return {
                    contents: [
                        {
                            ...(data.blob ? { blob: data.blob } : {}),
                            ...(data.mimeType ? { mimeType: data.mimeType } : {}),
                            ...(data.text ? { text: data.text } : {}),
                        },
                    ],
                    _meta: {},
                };
            }),
        } as unknown as import('../resources/index.js').ResourceManager;
    }

    test('should return empty array for null content', async () => {
        const resourceManager = createMockResourceManager({});
        const result = await expandBlobReferences(null, resourceManager, mockLogger);
        expect(result).toEqual([]);
    });

    test('should return TextPart unchanged if no blob references', async () => {
        const resourceManager = createMockResourceManager({});
        const result = await expandBlobReferences(
            [{ type: 'text', text: 'Hello world' }],
            resourceManager,
            mockLogger
        );
        expect(result).toEqual([{ type: 'text', text: 'Hello world' }]);
    });

    test('should expand blob reference in TextPart', async () => {
        const resourceManager = createMockResourceManager({
            abc123: { blob: 'base64imagedata', mimeType: 'image/png' },
        });

        const result = await expandBlobReferences(
            [{ type: 'text', text: 'Check this image: @blob:abc123' }],
            resourceManager,
            mockLogger
        );

        expect(result.length).toBe(2);
        expect(result[0]).toEqual({ type: 'text', text: 'Check this image: ' });
        expect(result[1]).toMatchObject({
            type: 'image',
            image: 'base64imagedata',
            mimeType: 'image/png',
        });
    });

    test('should expand multiple blob references in TextPart', async () => {
        const resourceManager = createMockResourceManager({
            aaa111: { blob: 'imagedata1', mimeType: 'image/png' },
            bbb222: { blob: 'imagedata2', mimeType: 'image/jpeg' },
        });

        const result = await expandBlobReferences(
            [{ type: 'text', text: 'Image 1: @blob:aaa111 and Image 2: @blob:bbb222' }],
            resourceManager,
            mockLogger
        );

        expect(result.length).toBe(4);
        expect(result[0]).toEqual({ type: 'text', text: 'Image 1: ' });
        expect(result[1]).toMatchObject({ type: 'image', image: 'imagedata1' });
        expect(result[2]).toEqual({ type: 'text', text: ' and Image 2: ' });
        expect(result[3]).toMatchObject({ type: 'image', image: 'imagedata2' });
    });

    test('should pass through array content without blob references', async () => {
        const resourceManager = createMockResourceManager({});
        const content = [
            { type: 'text' as const, text: 'Hello' },
            { type: 'image' as const, image: 'regularbase64', mimeType: 'image/png' },
        ];

        const result = await expandBlobReferences(content, resourceManager, mockLogger);

        expect(result).toEqual(content);
    });

    test('should expand blob reference in image part', async () => {
        const resourceManager = createMockResourceManager({
            aaa000bbb111: { blob: 'resolvedimagedata', mimeType: 'image/png' },
        });

        const content = [
            { type: 'image' as const, image: '@blob:aaa000bbb111', mimeType: 'image/png' },
        ];

        const result = await expandBlobReferences(content, resourceManager, mockLogger);

        expect(result.length).toBe(1);
        expect(result[0]).toMatchObject({
            type: 'image',
            image: 'resolvedimagedata',
            mimeType: 'image/png',
        });
    });

    test('should expand blob reference in file part', async () => {
        const resourceManager = createMockResourceManager({
            fff000eee111: { blob: 'resolvedfiledata', mimeType: 'application/pdf' },
        });

        const content = [
            {
                type: 'file' as const,
                data: '@blob:fff000eee111',
                mimeType: 'application/pdf',
                filename: 'doc.pdf',
            },
        ];

        const result = await expandBlobReferences(content, resourceManager, mockLogger);

        expect(result.length).toBe(1);
        expect(result[0]).toMatchObject({
            type: 'file',
            data: 'resolvedfiledata',
            mimeType: 'application/pdf',
        });
    });

    test('should handle failed blob resolution gracefully', async () => {
        const resourceManager = createMockResourceManager({}); // No blobs available

        const result = await expandBlobReferences(
            [{ type: 'text', text: 'Check: @blob:abc000def111' }],
            resourceManager,
            mockLogger
        );

        // Should return a fallback text part
        expect(result.length).toBe(2);
        expect(result[0]).toEqual({ type: 'text', text: 'Check: ' });
        expect(result[1]).toMatchObject({
            type: 'text',
            text: expect.stringContaining('unavailable'),
        });
    });

    test('should preserve UI resource parts unchanged', async () => {
        const resourceManager = createMockResourceManager({});
        const content = [
            { type: 'text' as const, text: 'Hello' },
            {
                type: 'ui-resource' as const,
                uri: 'ui://example',
                mimeType: 'text/html',
                content: '<div>test</div>',
            },
        ];

        const result = await expandBlobReferences(content, resourceManager, mockLogger);

        expect(result).toEqual(content);
    });

    test('should filter blobs by allowedMediaTypes', async () => {
        const resourceManager = {
            read: vi.fn(async (_uri: string) => {
                return {
                    contents: [{ blob: 'videodata', mimeType: 'video/mp4' }],
                    _meta: { size: 1000, originalName: 'video.mp4' },
                };
            }),
        } as unknown as import('../resources/index.js').ResourceManager;

        const result = await expandBlobReferences(
            [{ type: 'text', text: '@blob:abc123def456' }],
            resourceManager,
            mockLogger,
            ['image/*'] // Only allow images
        );

        // Should return a placeholder since video is not in allowedMediaTypes
        expect(result.length).toBe(1);
        expect(result[0]).toMatchObject({
            type: 'text',
            text: expect.stringContaining('Video'),
        });
    });

    test('should expand allowed media types', async () => {
        const resourceManager = {
            read: vi.fn(async (_uri: string) => {
                return {
                    contents: [{ blob: 'imagedata', mimeType: 'image/png' }],
                    _meta: { size: 1000 },
                };
            }),
        } as unknown as import('../resources/index.js').ResourceManager;

        const result = await expandBlobReferences(
            [{ type: 'text', text: '@blob:abc123def456' }],
            resourceManager,
            mockLogger,
            ['image/*'] // Allow images
        );

        expect(result.length).toBe(1);
        expect(result[0]).toMatchObject({
            type: 'image',
            image: 'imagedata',
            mimeType: 'image/png',
        });
    });
});

describe('filterCompacted', () => {
    // Note: These tests use string content for simplicity. The actual InternalMessage type
    // requires MessageContentPart[], but filterCompacted only checks metadata.isSummary
    // and slices the array - it doesn't inspect content structure.

    it('should return all messages if no summary exists', () => {
        const messages = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there' },
            { role: 'user', content: 'How are you?' },
        ] as unknown as InternalMessage[];

        const result = filterCompacted(messages);

        expect(result).toEqual(messages);
        expect(result).toHaveLength(3);
    });

    it('should return summary and messages after it when summary exists', () => {
        // Layout: [summarized, summarized, summary, afterSummary, afterSummary]
        // originalMessageCount=2 means first 2 messages were summarized
        const messages = [
            { role: 'user', content: 'Old message 1' },
            { role: 'assistant', content: 'Old response 1' },
            {
                role: 'assistant',
                content: 'Summary of conversation',
                metadata: { isSummary: true, originalMessageCount: 2 },
            },
            { role: 'user', content: 'New message' },
            { role: 'assistant', content: 'New response' },
        ] as unknown as InternalMessage[];

        const result = filterCompacted(messages);

        expect(result).toHaveLength(3);
        expect(result[0]?.content).toBe('Summary of conversation');
        expect(result[0]?.metadata?.isSummary).toBe(true);
        expect(result[1]?.content).toBe('New message');
        expect(result[2]?.content).toBe('New response');
    });

    it('should use most recent summary when multiple exist', () => {
        // Layout: [summarized, firstSummary, preserved, secondSummary, afterSummary]
        // The second summary at index 3 summarized messages 0-2 (originalMessageCount=3)
        const messages = [
            { role: 'user', content: 'Very old' },
            {
                role: 'assistant',
                content: 'First summary',
                metadata: { isSummary: true, originalMessageCount: 1 },
            },
            { role: 'user', content: 'Medium old' },
            {
                role: 'assistant',
                content: 'Second summary',
                metadata: { isSummary: true, originalMessageCount: 3 },
            },
            { role: 'user', content: 'Recent message' },
        ] as unknown as InternalMessage[];

        const result = filterCompacted(messages);

        expect(result).toHaveLength(2);
        expect(result[0]?.content).toBe('Second summary');
        expect(result[1]?.content).toBe('Recent message');
    });

    it('should handle empty history', () => {
        const result = filterCompacted([]);

        expect(result).toEqual([]);
        expect(result).toHaveLength(0);
    });

    it('should handle history with only a summary', () => {
        const messages = [
            { role: 'assistant', content: 'Just a summary', metadata: { isSummary: true } },
        ] as unknown as InternalMessage[];

        const result = filterCompacted(messages);

        expect(result).toHaveLength(1);
        expect(result[0]?.metadata?.isSummary).toBe(true);
    });

    it('should not treat messages with other metadata as summaries', () => {
        const messages = [
            { role: 'user', content: 'Message 1' },
            { role: 'assistant', content: 'Response with metadata', metadata: { important: true } },
            { role: 'user', content: 'Message 2' },
        ] as unknown as InternalMessage[];

        const result = filterCompacted(messages);

        expect(result).toEqual(messages);
        expect(result).toHaveLength(3);
    });

    it('should handle summary at the end of history', () => {
        // Layout: [summarized, summarized, summary]
        // originalMessageCount=2 means first 2 messages were summarized, no preserved messages
        const messages = [
            { role: 'user', content: 'Old message' },
            { role: 'assistant', content: 'Old response' },
            {
                role: 'assistant',
                content: 'Final summary',
                metadata: { isSummary: true, originalMessageCount: 2 },
            },
        ] as unknown as InternalMessage[];

        const result = filterCompacted(messages);

        expect(result).toHaveLength(1);
        expect(result[0]?.content).toBe('Final summary');
    });

    it('should preserve messages between summarized portion and summary', () => {
        // This is the typical case after compaction:
        // Layout: [summarized, summarized, preserved, preserved, summary]
        // originalMessageCount=2 means first 2 messages were summarized
        // Messages at indices 2,3 should be preserved
        const messages = [
            { role: 'user', content: 'Old message 1' },
            { role: 'assistant', content: 'Old response 1' },
            { role: 'user', content: 'Recent message' },
            { role: 'assistant', content: 'Recent response' },
            {
                role: 'system',
                content: 'Summary',
                metadata: { isSummary: true, originalMessageCount: 2 },
            },
        ] as unknown as InternalMessage[];

        const result = filterCompacted(messages);

        // Should return: [summary, preserved1, preserved2]
        expect(result).toHaveLength(3);
        expect(result[0]?.content).toBe('Summary');
        expect(result[1]?.content).toBe('Recent message');
        expect(result[2]?.content).toBe('Recent response');
    });
});

describe('sanitizeToolResultToContentWithBlobs', () => {
    describe('string input handling', () => {
        it('should wrap simple string in ContentPart array', async () => {
            const result = await sanitizeToolResultToContentWithBlobs('Hello, world!', mockLogger);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result![0]).toEqual({ type: 'text', text: 'Hello, world!' });
        });

        it('should wrap empty string in ContentPart array', async () => {
            const result = await sanitizeToolResultToContentWithBlobs('', mockLogger);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result![0]).toEqual({ type: 'text', text: '' });
        });

        it('should truncate long strings and return ContentPart array', async () => {
            // MAX_TOOL_TEXT_CHARS is 8000, so create a string longer than that
            // Use text with spaces/punctuation to avoid being detected as base64-like
            const longString = 'This is a sample text line. '.repeat(400); // ~11200 chars

            const result = await sanitizeToolResultToContentWithBlobs(longString, mockLogger);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result![0]?.type).toBe('text');
            // Verify truncation happened
            const textPart = result![0] as { type: 'text'; text: string };
            expect(textPart.text).toContain('chars omitted');
            expect(textPart.text.length).toBeLessThan(longString.length);
        });

        it('should convert data URI to image ContentPart', async () => {
            const dataUri =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

            const result = await sanitizeToolResultToContentWithBlobs(dataUri, mockLogger);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result![0]?.type).toBe('image');
        });

        it('should convert data URI to file ContentPart for non-image types', async () => {
            const dataUri = 'data:application/pdf;base64,JVBERi0xLjQK';

            const result = await sanitizeToolResultToContentWithBlobs(dataUri, mockLogger);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result![0]?.type).toBe('file');
            expect((result![0] as any).mimeType).toBe('application/pdf');
        });

        it('should treat base64-like strings as text (MCP tools use structured content)', async () => {
            // MCP-compliant tools return structured { type: 'image', data: base64, mimeType }
            // Raw base64 strings should be treated as regular text
            const base64String = Buffer.from('test binary data here for base64 encoding test')
                .toString('base64')
                .repeat(20); // ~1280 chars

            const result = await sanitizeToolResultToContentWithBlobs(base64String, mockLogger);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            // Should be text, not file - raw base64 strings aren't valid MCP content
            expect(result![0]?.type).toBe('text');
            expect((result![0] as any).text).toBe(base64String);
        });
    });

    describe('object input handling', () => {
        it('should stringify simple object and wrap in ContentPart array', async () => {
            const result = await sanitizeToolResultToContentWithBlobs(
                { key: 'value', number: 42 },
                mockLogger
            );

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result![0]?.type).toBe('text');
            const text = (result![0] as { type: 'text'; text: string }).text;
            expect(text).toContain('key');
            expect(text).toContain('value');
        });

        it('should handle null input', async () => {
            const result = await sanitizeToolResultToContentWithBlobs(null, mockLogger);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result![0]?.type).toBe('text');
        });

        it('should handle undefined input', async () => {
            const result = await sanitizeToolResultToContentWithBlobs(undefined, mockLogger);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result![0]?.type).toBe('text');
        });
    });

    describe('array input handling', () => {
        it('should process array of strings into ContentPart array', async () => {
            const result = await sanitizeToolResultToContentWithBlobs(
                ['first', 'second', 'third'],
                mockLogger
            );

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(3);
            expect(result![0]).toEqual({ type: 'text', text: 'first' });
            expect(result![1]).toEqual({ type: 'text', text: 'second' });
            expect(result![2]).toEqual({ type: 'text', text: 'third' });
        });

        it('should handle mixed array with strings and objects', async () => {
            const result = await sanitizeToolResultToContentWithBlobs(
                ['text message', { data: 123 }],
                mockLogger
            );

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(2);
            expect(result![0]).toEqual({ type: 'text', text: 'text message' });
            expect(result![1]?.type).toBe('text');
        });

        it('should skip null items in array', async () => {
            const result = await sanitizeToolResultToContentWithBlobs(
                ['first', null, 'third'],
                mockLogger
            );

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(2);
            expect(result![0]).toEqual({ type: 'text', text: 'first' });
            expect(result![1]).toEqual({ type: 'text', text: 'third' });
        });

        it('should handle empty array', async () => {
            const result = await sanitizeToolResultToContentWithBlobs([], mockLogger);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(0);
        });
    });

    describe('MCP content handling', () => {
        it('should handle MCP text content type', async () => {
            const mcpResult = {
                content: [{ type: 'text', text: 'MCP text response' }],
            };

            const result = await sanitizeToolResultToContentWithBlobs(mcpResult, mockLogger);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result![0]).toEqual({ type: 'text', text: 'MCP text response' });
        });

        it('should handle MCP image content type', async () => {
            const mcpResult = {
                content: [
                    {
                        type: 'image',
                        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk',
                        mimeType: 'image/png',
                    },
                ],
            };

            const result = await sanitizeToolResultToContentWithBlobs(mcpResult, mockLogger);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result![0]?.type).toBe('image');
        });
    });

    describe('error handling', () => {
        it('should handle circular references gracefully', async () => {
            const circular: Record<string, any> = { a: 1 };
            circular.self = circular;

            // Should not throw, should return some text representation
            const result = await sanitizeToolResultToContentWithBlobs(circular, mockLogger);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result![0]?.type).toBe('text');
        });
    });
});

describe('Token Estimation Functions', () => {
    describe('estimateStringTokens', () => {
        it('should return 0 for empty string', () => {
            expect(estimateStringTokens('')).toBe(0);
        });

        it('should return 0 for null/undefined', () => {
            expect(estimateStringTokens(null as unknown as string)).toBe(0);
            expect(estimateStringTokens(undefined as unknown as string)).toBe(0);
        });

        it('should estimate ~4 chars per token', () => {
            // 100 chars should be ~25 tokens
            const text = 'a'.repeat(100);
            expect(estimateStringTokens(text)).toBe(25);
        });

        it('should round to nearest integer', () => {
            // 10 chars = 2.5 -> rounds to 3
            expect(estimateStringTokens('a'.repeat(10))).toBe(3);
            // 8 chars = 2 -> exactly 2
            expect(estimateStringTokens('a'.repeat(8))).toBe(2);
        });

        it('should handle realistic text content', () => {
            const systemPrompt = `You are a helpful coding assistant. 
            You help users write, debug, and understand code.
            Always provide clear explanations.`;
            // ~150 chars -> ~38 tokens
            const tokens = estimateStringTokens(systemPrompt);
            expect(tokens).toBeGreaterThan(30);
            expect(tokens).toBeLessThan(50);
        });
    });

    describe('estimateImageTokens', () => {
        it('should return fixed 1000 tokens for images', () => {
            expect(estimateImageTokens()).toBe(1000);
        });
    });

    describe('estimateFileTokens', () => {
        it('should estimate based on content when provided', () => {
            const content = 'a'.repeat(400); // 400 chars = 100 tokens
            expect(estimateFileTokens(content)).toBe(100);
        });

        it('should return 1000 when no content provided', () => {
            expect(estimateFileTokens()).toBe(1000);
            expect(estimateFileTokens(undefined)).toBe(1000);
        });
    });

    describe('estimateContentPartTokens', () => {
        it('should estimate text parts using string estimation', () => {
            const textPart = { type: 'text' as const, text: 'a'.repeat(100) };
            expect(estimateContentPartTokens(textPart)).toBe(25);
        });

        it('should estimate image parts as 1000 tokens', () => {
            const imagePart = {
                type: 'image' as const,
                image: 'base64data',
                mimeType: 'image/png' as const,
            };
            expect(estimateContentPartTokens(imagePart)).toBe(1000);
        });

        it('should return fallback for file parts', () => {
            // File data could be base64-encoded or binary, so we use a conservative fallback
            const filePart = {
                type: 'file' as const,
                data: 'some-file-data',
                mimeType: 'text/plain' as const,
            };
            expect(estimateContentPartTokens(filePart)).toBe(1000);
        });

        it('should return fallback for file parts with binary data', () => {
            // Binary data also uses fallback (can't easily estimate tokens from bytes)
            const filePart: FilePart = {
                type: 'file',
                data: new Uint8Array([1, 2, 3]),
                mimeType: 'application/pdf',
            };
            expect(estimateContentPartTokens(filePart)).toBe(1000);
        });

        it('should return 0 for unknown part types', () => {
            const unknownPart = { type: 'unknown' } as unknown as ContentPart;
            expect(estimateContentPartTokens(unknownPart)).toBe(0);
        });
    });

    describe('estimateMessagesTokens', () => {
        it('should return 0 for empty messages array', () => {
            expect(estimateMessagesTokens([])).toBe(0);
        });

        it('should estimate single text message', () => {
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: [{ type: 'text', text: 'a'.repeat(100) }],
                },
            ];
            expect(estimateMessagesTokens(messages)).toBe(25);
        });

        it('should sum tokens across multiple messages', () => {
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: [{ type: 'text', text: 'a'.repeat(100) }], // 25 tokens
                },
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'a'.repeat(200) }], // 50 tokens
                },
            ];
            expect(estimateMessagesTokens(messages)).toBe(75);
        });

        it('should sum tokens across multiple content parts', () => {
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'a'.repeat(100) }, // 25 tokens
                        { type: 'image', image: 'base64', mimeType: 'image/png' as const }, // 1000 tokens
                    ],
                },
            ];
            expect(estimateMessagesTokens(messages)).toBe(1025);
        });

        it('should handle messages with non-array content', () => {
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: 'plain string content' as any, // Not an array - should be skipped
                },
            ];
            expect(estimateMessagesTokens(messages)).toBe(0);
        });

        it('should handle mixed content types', () => {
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Hello' }, // ~1-2 tokens
                        { type: 'image', image: 'base64', mimeType: 'image/png' as const }, // 1000 tokens
                        { type: 'file', data: 'base64', mimeType: 'application/pdf' as const }, // 1000 tokens
                    ],
                },
            ];
            const tokens = estimateMessagesTokens(messages);
            expect(tokens).toBeGreaterThanOrEqual(2001); // At least 2000 + some text
        });
    });
});

// Note: getOutputBuffer and DEFAULT_OUTPUT_BUFFER were removed from overflow.ts
// The output buffer concept was flawed - input and output tokens have separate limits
// in LLM APIs, so reserving input space for output was unnecessary.

describe('estimateToolsTokens', () => {
    it('should return 0 total for empty tools object', () => {
        const result = estimateToolsTokens({});
        expect(result.total).toBe(0);
        expect(result.perTool).toEqual([]);
    });

    it('should estimate tokens for single tool', () => {
        const tools = {
            search: {
                name: 'search',
                description: 'Search the web for information',
                parameters: { type: 'object', properties: { query: { type: 'string' } } },
            },
        };
        const result = estimateToolsTokens(tools);
        expect(result.total).toBeGreaterThan(0);
        expect(result.perTool).toHaveLength(1);
        expect(result.perTool[0]?.name).toBe('search');
        expect(result.perTool[0]?.tokens).toBeGreaterThan(0);
    });

    it('should estimate tokens for multiple tools', () => {
        const tools = {
            read_file: {
                name: 'read_file',
                description: 'Read a file from disk',
                parameters: { type: 'object', properties: { path: { type: 'string' } } },
            },
            write_file: {
                name: 'write_file',
                description: 'Write content to a file',
                parameters: {
                    type: 'object',
                    properties: { path: { type: 'string' }, content: { type: 'string' } },
                },
            },
        };
        const result = estimateToolsTokens(tools);
        expect(result.total).toBeGreaterThan(0);
        expect(result.perTool).toHaveLength(2);
        // Total should equal sum of per-tool tokens
        const sumOfPerTool = result.perTool.reduce((sum, t) => sum + t.tokens, 0);
        expect(result.total).toBe(sumOfPerTool);
    });

    it('should use key as tool name when name property is missing', () => {
        const tools = {
            my_tool: {
                description: 'A tool without a name property',
                parameters: {},
            },
        };
        const result = estimateToolsTokens(tools);
        expect(result.perTool[0]?.name).toBe('my_tool');
    });

    it('should handle tools with complex parameters', () => {
        const tools = {
            complex_tool: {
                name: 'complex_tool',
                description: 'A tool with complex nested parameters',
                parameters: {
                    type: 'object',
                    properties: {
                        nested: {
                            type: 'object',
                            properties: {
                                array: { type: 'array', items: { type: 'string' } },
                                number: { type: 'number' },
                            },
                        },
                    },
                },
            },
        };
        const result = estimateToolsTokens(tools);
        // Complex parameters should result in more tokens
        expect(result.total).toBeGreaterThan(20);
    });
});

describe('estimateContextTokens', () => {
    it('should return total and breakdown with all components', () => {
        const systemPrompt = 'You are a helpful assistant.';
        const messages: InternalMessage[] = [
            { role: 'user', content: [{ type: 'text', text: 'Hello!' }] },
        ];
        const tools = {
            search: {
                name: 'search',
                description: 'Search the web',
                parameters: {},
            },
        };

        const result = estimateContextTokens(systemPrompt, messages, tools);

        expect(result.total).toBeGreaterThan(0);
        expect(result.breakdown.systemPrompt).toBeGreaterThan(0);
        expect(result.breakdown.messages).toBeGreaterThan(0);
        expect(result.breakdown.tools.total).toBeGreaterThan(0);
        expect(result.breakdown.tools.perTool).toHaveLength(1);
    });

    it('should return 0 for tools when no tools provided', () => {
        const systemPrompt = 'You are helpful.';
        const messages: InternalMessage[] = [
            { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
        ];

        const result = estimateContextTokens(systemPrompt, messages);

        expect(result.breakdown.tools.total).toBe(0);
        expect(result.breakdown.tools.perTool).toEqual([]);
    });

    it('should have total equal to sum of breakdown components', () => {
        const systemPrompt = 'System instructions here.';
        const messages: InternalMessage[] = [
            { role: 'user', content: [{ type: 'text', text: 'User message' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'Assistant response' }] },
        ];
        const tools = {
            tool1: { name: 'tool1', description: 'First tool', parameters: {} },
            tool2: { name: 'tool2', description: 'Second tool', parameters: {} },
        };

        const result = estimateContextTokens(systemPrompt, messages, tools);

        const expectedTotal =
            result.breakdown.systemPrompt +
            result.breakdown.messages +
            result.breakdown.tools.total;
        expect(result.total).toBe(expectedTotal);
    });

    it('should handle empty messages array', () => {
        const systemPrompt = 'System prompt';
        const messages: InternalMessage[] = [];

        const result = estimateContextTokens(systemPrompt, messages);

        expect(result.breakdown.messages).toBe(0);
        expect(result.breakdown.systemPrompt).toBeGreaterThan(0);
        expect(result.total).toBe(result.breakdown.systemPrompt);
    });

    it('should handle empty system prompt', () => {
        const systemPrompt = '';
        const messages: InternalMessage[] = [
            { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        ];

        const result = estimateContextTokens(systemPrompt, messages);

        expect(result.breakdown.systemPrompt).toBe(0);
        expect(result.breakdown.messages).toBeGreaterThan(0);
    });
});
