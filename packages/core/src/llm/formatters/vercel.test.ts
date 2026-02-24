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

    describe('Reasoning round-trip', () => {
        test('should include reasoning part in assistant message when reasoning is present', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Here is my answer' }],
                    reasoning: 'Let me think about this carefully...',
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
                'You are helpful'
            );

            const assistantMessage = result.find((m) => m.role === 'assistant');
            expect(assistantMessage).toBeDefined();

            const content = assistantMessage!.content as Array<{ type: string; text?: string }>;
            const reasoningPart = content.find((p) => p.type === 'reasoning');
            expect(reasoningPart).toBeDefined();
            expect(reasoningPart!.text).toBe('Let me think about this carefully...');
        });

        test('should omit reasoning parts for OpenAI prompts to avoid Responses API item ordering errors', () => {
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
                { provider: 'openai', model: 'gpt-5.2' },
                null
            );

            const assistantMessage = result.find((m) => m.role === 'assistant');
            const content = assistantMessage!.content as Array<{ type: string }>;
            const reasoningPart = content.find((p) => p.type === 'reasoning');

            expect(reasoningPart).toBeUndefined();
        });

        test('should include providerOptions in reasoning part when reasoningMetadata is present', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const reasoningMetadata = { anthropic: { cacheId: 'cache-123' } };
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Answer' }],
                    reasoning: 'Thinking...',
                    reasoningMetadata,
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
                'You are helpful'
            );

            const assistantMessage = result.find((m) => m.role === 'assistant');
            const content = assistantMessage!.content as Array<{
                type: string;
                providerOptions?: Record<string, unknown>;
            }>;
            const reasoningPart = content.find((p) => p.type === 'reasoning');

            expect(reasoningPart).toBeDefined();
            expect(reasoningPart!.providerOptions).toEqual(reasoningMetadata);
        });

        test('should place reasoning part before text content', () => {
            const formatter = new VercelMessageFormatter(mockLogger);
            const messages: InternalMessage[] = [
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Final answer' }],
                    reasoning: 'Step by step reasoning...',
                },
            ];

            const result = formatter.format(
                messages,
                { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
                'You are helpful'
            );

            const assistantMessage = result.find((m) => m.role === 'assistant');
            const content = assistantMessage!.content as Array<{ type: string }>;

            // Reasoning should come before text
            const reasoningIndex = content.findIndex((p) => p.type === 'reasoning');
            const textIndex = content.findIndex((p) => p.type === 'text');

            expect(reasoningIndex).toBeLessThan(textIndex);
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
