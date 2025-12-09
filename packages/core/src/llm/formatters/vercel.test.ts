import { describe, test, expect, vi } from 'vitest';
import { VercelMessageFormatter } from './vercel.js';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import type { InternalMessage } from '../../context/types.js';
import * as registry from '../registry.js';

// Mock the registry to allow all file types
vi.mock('../registry.js');
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

            const result = formatter.format(messages, 'You are helpful', {
                provider: 'openai',
                model: 'gpt-4o',
            });

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

            const result = formatter.format(messages, 'You are helpful', {
                provider: 'openai',
                model: 'gpt-4o',
            });

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

            const result = formatter.format(messages, 'You are helpful', {
                provider: 'openai',
                model: 'gpt-4o',
            });

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

            const result = formatter.format(messages, 'You are helpful', {
                provider: 'openai',
                model: 'gpt-4o',
            });

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

            const result = formatter.format(messages, 'You are helpful', {
                provider: 'openai',
                model: 'gpt-4o',
            });

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

            const result = formatter.format(messages, 'You are helpful', {
                provider: 'openai',
                model: 'gpt-4o',
            });

            const userMessage = result.find((m) => m.role === 'user');
            const content = userMessage!.content as Array<{ type: string; image?: URL }>;
            const imagePart = content.find((p) => p.type === 'image');
            // URL object should be preserved (or converted back to URL)
            expect(imagePart!.image).toBeInstanceOf(URL);
        });
    });
});
