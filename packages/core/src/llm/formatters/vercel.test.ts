import { describe, test, expect, vi } from 'vitest';
import { VercelMessageFormatter } from './vercel.js';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import type { InternalMessage } from '../../context/types.js';
import * as registry from '../registry/index.js';

// Mock the registry to allow all file types
vi.mock('../registry/index.js');
const mockValidateModelFileSupport = vi.mocked(registry.validateModelFileSupport);
mockValidateModelFileSupport.mockReturnValue({ isSupported: true, fileType: 'pdf' });

const mockLogger = createMockLogger();

describe('VercelMessageFormatter', () => {
    describe('URL string auto-detection', () => {
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
    });

    describe('Reasoning (UI-only)', () => {
        test('should omit reasoning parts from prompts even when reasoning is present', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Answer' }],
                    reasoning: 'Thinking...',
                    reasoningMetadata: { openai: { itemId: 'rs_123' } },
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
                null
            );

            const assistantMessage = result.find((m) => m.role === 'assistant');
            const content = assistantMessage!.content as Array<{ type: string }>;
            const reasoningPart = content.find((p) => p.type === 'reasoning');

            expect(reasoningPart).toBeUndefined();
        });

        test('should not include reasoning part when reasoning is not present', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
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
