import { describe, test, expect, vi } from 'vitest';
import { VercelMessageFormatter } from './vercel.js';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import type { InternalMessage } from '../../context/types.js';
import * as llm from '@dexto/llm';

vi.mock('@dexto/llm');
const mockValidateModelFileSupport = vi.mocked(llm.validateModelFileSupport);
mockValidateModelFileSupport.mockReturnValue({ isSupported: true, fileType: 'pdf' });

const mockLogger = createMockLogger();

describe('VercelMessageFormatter', () => {
    describe('URL string auto-detection', () => {
        test('should inline markdown file content as text for model messages', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const markdown = '# Project notes\n\n- keep this as markdown';
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Summarize this file' },
                        {
                            type: 'file',
                            data: Buffer.from(markdown, 'utf8').toString('base64'),
                            mimeType: 'text/markdown',
                            filename: 'notes.md',
                        },
                    ],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-5.4-mini' },
                'You are helpful'
            );

            const userMessage = result.find((m) => m.role === 'user');
            expect(userMessage).toBeDefined();
            if (!userMessage) throw new Error('Expected user message');

            const content = userMessage.content as Array<{ type: string; text?: string }>;
            expect(content).toHaveLength(2);
            expect(content.some((p) => p.type === 'file')).toBe(false);
            expect(content[0]).toEqual({ type: 'text', text: 'Summarize this file' });
            expect(content[1]).toEqual({
                type: 'text',
                text: `Attached file "notes.md" (text/markdown):\n\n${markdown}`,
            });
        });

        test('should inline plain string markdown file content verbatim', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const markdown = '# Project notes\n\nTEST\n\nAAAA';
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'file',
                            data: markdown,
                            mimeType: 'text/markdown',
                            filename: 'notes.md',
                        },
                    ],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-5.4-mini' },
                'You are helpful'
            );

            const userMessage = result.find((m) => m.role === 'user');
            expect(userMessage).toBeDefined();
            if (!userMessage) throw new Error('Expected user message');

            expect(userMessage.content).toEqual([
                {
                    type: 'text',
                    text: `Attached file "notes.md" (text/markdown):\n\n${markdown}`,
                },
            ]);
        });

        test('should convert image URL string to URL object', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Describe this image' },
                        {
                            type: 'image',
                            image: 'https://example.com/image.png',
                            mimeType: 'image/png',
                        },
                    ],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-4o' },
                'You are helpful'
            );

            // Find the user message
            const userMessage = result.find((m) => m.role === 'user');
            expect(userMessage).toBeDefined();

            const content = userMessage!.content as Array<{ type: string; image?: URL | string }>;
            const imagePart = content.find((p) => p.type === 'image');
            expect(imagePart).toBeDefined();
            expect(imagePart!.image).toBeInstanceOf(URL);
            expect((imagePart!.image as URL).href).toBe('https://example.com/image.png');
        });

        test('should convert file URL string to URL object', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Summarize this document' },
                        {
                            type: 'file',
                            data: 'https://example.com/document.pdf',
                            mimeType: 'application/pdf',
                        },
                    ],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-4o' },
                'You are helpful'
            );

            const userMessage = result.find((m) => m.role === 'user');
            expect(userMessage).toBeDefined();

            const content = userMessage!.content as Array<{ type: string; data?: URL | string }>;
            const filePart = content.find((p) => p.type === 'file');
            expect(filePart).toBeDefined();
            expect(filePart!.data).toBeInstanceOf(URL);
            expect((filePart!.data as URL).href).toBe('https://example.com/document.pdf');
        });

        test('should preserve base64 strings as-is', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const base64Image =
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: [{ type: 'image', image: base64Image, mimeType: 'image/png' }],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-4o' },
                'You are helpful'
            );

            const userMessage = result.find((m) => m.role === 'user');
            const content = userMessage!.content as Array<{ type: string; image?: string }>;
            const imagePart = content.find((p) => p.type === 'image');
            expect(imagePart!.image).toBe(base64Image);
            expect(typeof imagePart!.image).toBe('string');
        });

        test('should preserve data URI strings as-is', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const dataUri =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: [{ type: 'image', image: dataUri, mimeType: 'image/png' }],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-4o' },
                'You are helpful'
            );

            const userMessage = result.find((m) => m.role === 'user');
            const content = userMessage!.content as Array<{ type: string; image?: string }>;
            const imagePart = content.find((p) => p.type === 'image');
            expect(imagePart!.image).toBe(dataUri);
            expect(typeof imagePart!.image).toBe('string');
        });

        test('should handle http:// URLs (not just https://)', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            image: 'http://example.com/image.png',
                            mimeType: 'image/png',
                        },
                    ],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-4o' },
                'You are helpful'
            );

            const userMessage = result.find((m) => m.role === 'user');
            const content = userMessage!.content as Array<{ type: string; image?: URL }>;
            const imagePart = content.find((p) => p.type === 'image');
            expect(imagePart!.image).toBeInstanceOf(URL);
        });

        test('should preserve URL objects as-is', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const urlObj = new URL('https://example.com/image.png');
            const messages: InternalMessage[] = [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            image: urlObj as unknown as string,
                            mimeType: 'image/png',
                        },
                    ],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-4o' },
                'You are helpful'
            );

            const userMessage = result.find((m) => m.role === 'user');
            const content = userMessage!.content as Array<{ type: string; image?: URL }>;
            const imagePart = content.find((p) => p.type === 'image');
            // URL object should be preserved (or converted back to URL)
            expect(imagePart!.image).toBeInstanceOf(URL);
        });
    });

    describe('Tool call round-trip', () => {
        test('should pass through toolCall.providerOptions on tool-call parts', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const toolProviderOptions = { google: { thoughtSignature: 'sig_123' } };
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    assistantOutput: { status: 'complete' },
                    content: [{ type: 'text', text: 'Calling tool' }],
                    toolCalls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'search', arguments: '{"q":"test"}' },
                            providerOptions: toolProviderOptions,
                        },
                    ],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'google', model: 'gemini-3-flash-preview' },
                null
            );

            const assistantMessage = result.find((m) => m.role === 'assistant');
            const content = assistantMessage!.content as Array<{
                type: string;
                providerOptions?: Record<string, unknown>;
            }>;
            const toolCallPart = content.find((p) => p.type === 'tool-call');

            expect(toolCallPart).toBeDefined();
            expect(toolCallPart!.providerOptions).toEqual(toolProviderOptions);
        });

        test('should preserve mixed text and media tool results as content parts', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    assistantOutput: { status: 'complete' },
                    content: [{ type: 'text', text: 'Reading image' }],
                    toolCalls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'read_media_file', arguments: '{}' },
                        },
                    ],
                },
                {
                    role: 'tool',
                    toolCallId: 'call-1',
                    name: 'read_media_file',
                    success: true,
                    content: [
                        { type: 'text', text: 'Attached image: blob:abc123' },
                        { type: 'image', image: 'base64-image-data', mimeType: 'image/png' },
                        { type: 'text', text: '[Stored resource_ref:blob:abc123]' },
                    ],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-5.4-mini' },
                null
            );

            const toolMessage = result.find((m) => m.role === 'tool');
            expect(toolMessage).toBeDefined();

            const content = toolMessage!.content as Array<{
                type: string;
                output: {
                    type: string;
                    value: Array<{ type: string; text?: string; data?: string }>;
                };
            }>;
            const output = content[0]?.output;

            expect(output?.type).toBe('content');
            expect(output?.value).toEqual([
                { type: 'text', text: 'Attached image: blob:abc123' },
                { type: 'media', data: 'base64-image-data', mediaType: 'image/png' },
                { type: 'text', text: '[Stored resource_ref:blob:abc123]' },
            ]);
        });

        test('should strip data URI prefixes from tool-result media data', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    assistantOutput: { status: 'complete' },
                    content: [{ type: 'text', text: 'Reading image' }],
                    toolCalls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'read_media_file', arguments: '{}' },
                        },
                    ],
                },
                {
                    role: 'tool',
                    toolCallId: 'call-1',
                    name: 'read_media_file',
                    success: true,
                    content: [
                        {
                            type: 'image',
                            image: 'data:image/png;base64,base64-image-data',
                            mimeType: 'image/png',
                        },
                    ],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-5.4-mini' },
                null
            );
            const toolMessage = result.find((m) => m.role === 'tool');
            const content = toolMessage!.content as Array<{
                output: { type: string; value: Array<{ type: string; data?: string }> };
            }>;

            expect(content[0]?.output.value).toEqual([
                { type: 'media', data: 'base64-image-data', mediaType: 'image/png' },
            ]);
        });

        test('should send remote tool-result images as a following user message', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    assistantOutput: { status: 'complete' },
                    content: [{ type: 'text', text: 'Reading image' }],
                    toolCalls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'read_media_file', arguments: '{}' },
                        },
                    ],
                },
                {
                    role: 'tool',
                    toolCallId: 'call-1',
                    name: 'read_media_file',
                    success: true,
                    content: [
                        { type: 'text', text: 'Read image' },
                        {
                            type: 'image',
                            image: 'https://example.test/api/artifact-exports/signed-token',
                            mimeType: 'image/png',
                        },
                    ],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-5.4-mini' },
                null
            );

            expect(result.slice(-2)).toEqual([
                {
                    role: 'tool',
                    content: [
                        {
                            type: 'tool-result',
                            toolCallId: 'call-1',
                            toolName: 'read_media_file',
                            output: {
                                type: 'text',
                                value: 'Read image\nAttached image: https://example.test/api/artifact-exports/signed-token',
                            },
                        },
                    ],
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            image: new URL(
                                'https://example.test/api/artifact-exports/signed-token'
                            ),
                            mediaType: 'image/png',
                        },
                    ],
                },
            ]);
        });

        test('should keep parallel tool results together before remote media', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    assistantOutput: { status: 'complete' },
                    content: [],
                    toolCalls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'read_media_file', arguments: '{}' },
                        },
                        {
                            id: 'call-2',
                            type: 'function',
                            function: { name: 'search', arguments: '{}' },
                        },
                    ],
                },
                {
                    role: 'tool',
                    toolCallId: 'call-1',
                    name: 'read_media_file',
                    success: true,
                    content: [
                        {
                            type: 'image',
                            image: 'https://example.test/image.png',
                            mimeType: 'image/png',
                        },
                    ],
                },
                {
                    role: 'tool',
                    toolCallId: 'call-2',
                    name: 'search',
                    success: true,
                    content: [{ type: 'text', text: 'Search result' }],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-5.4-mini' },
                null
            );

            expect(result.map((message) => message.role)).toEqual([
                'assistant',
                'tool',
                'tool',
                'user',
            ]);
        });

        test('should keep tool-result URL media as text references', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    assistantOutput: { status: 'complete' },
                    content: [{ type: 'text', text: 'Reading image' }],
                    toolCalls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'read_media_file', arguments: '{}' },
                        },
                    ],
                },
                {
                    role: 'tool',
                    toolCallId: 'call-1',
                    name: 'read_media_file',
                    success: true,
                    content: [
                        {
                            type: 'image',
                            image: 'https://example.com/image.png',
                            mimeType: 'image/png',
                        },
                    ],
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-5.4-mini' },
                null
            );
            const toolMessage = result.find((m) => m.role === 'tool');
            const content = toolMessage!.content as Array<{
                output: { type: string; value: string };
            }>;

            expect(content[0]?.output).toEqual({
                type: 'text',
                value: 'Attached image: https://example.com/image.png',
            });
        });
    });

    describe('Reasoning round-trip', () => {
        test('omits reasoning parts for OpenAI contexts', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    assistantOutput: { status: 'complete' },
                    content: [{ type: 'text', text: 'Answer' }],
                    reasoning: 'Thinking...',
                    reasoningMetadata: { openai: { itemId: 'rs_123' } },
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-5.2' },
                null
            );

            const assistantMessage = result.find((m) => m.role === 'assistant');
            const content = assistantMessage!.content as Array<{ type: string }>;
            const reasoningPart = content.find((p) => p.type === 'reasoning');

            expect(reasoningPart).toBeUndefined();
        });

        test('includes reasoning parts for Anthropic contexts', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    assistantOutput: { status: 'complete' },
                    content: [{ type: 'text', text: 'Answer' }],
                    reasoning: 'Thinking...',
                    reasoningMetadata: { anthropic: { cacheId: 'cache-123' } },
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'anthropic', model: 'claude-3-7-sonnet-20250219' },
                null
            );

            const assistantMessage = result.find((m) => m.role === 'assistant');
            const content = assistantMessage!.content as Array<{
                type: string;
                text?: string;
                providerOptions?: Record<string, unknown>;
            }>;
            const reasoningPart = content.find((p) => p.type === 'reasoning');

            expect(reasoningPart).toBeDefined();
            expect(reasoningPart?.text).toBe('Thinking...');
            expect(reasoningPart?.providerOptions).toEqual({ anthropic: { cacheId: 'cache-123' } });
        });

        test('should not include reasoning part when reasoning is not present', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    assistantOutput: { status: 'complete' },
                    content: [{ type: 'text', text: 'Simple answer' }],
                    // No reasoning field
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'openai', model: 'gpt-4o' },
                'You are helpful'
            );

            const assistantMessage = result.find((m) => m.role === 'assistant');
            const content = assistantMessage!.content as Array<{ type: string }>;
            const reasoningPart = content.find((p) => p.type === 'reasoning');

            expect(reasoningPart).toBeUndefined();
        });
    });
});
