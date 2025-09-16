import { describe, it, expect } from 'vitest';
import {
    ClientConfigSchema,
    ClientOptionsSchema,
    MessageInputSchema,
    LLMConfigInputSchema,
    validateInput,
} from '../src/schemas.js';
import { DextoValidationError } from '../src/errors.js';

describe('Schema Validation', () => {
    describe('ClientConfigSchema', () => {
        it('should validate valid config', () => {
            const validConfig = {
                baseUrl: 'https://api.dexto.com',
                apiKey: 'test-key',
                timeout: 30000,
                retries: 3,
            };

            const result = validateInput(ClientConfigSchema, validConfig);
            expect(result).toEqual(validConfig);
        });

        it('should reject invalid URL', () => {
            const invalidConfig = {
                baseUrl: 'not-a-url',
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig)).toThrow(
                DextoValidationError
            );
        });

        it('should reject non-http(s) URLs', () => {
            const invalidConfig = {
                baseUrl: 'ftp://example.com',
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig)).toThrow(
                DextoValidationError
            );
        });

        it('should reject invalid timeout values', () => {
            const invalidConfig = {
                baseUrl: 'https://api.dexto.com',
                timeout: 500, // too low
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig)).toThrow(
                DextoValidationError
            );
        });

        it('should reject excessive retries', () => {
            const invalidConfig = {
                baseUrl: 'https://api.dexto.com',
                retries: 15, // too high
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig)).toThrow(
                DextoValidationError
            );
        });

        it('should reject extra properties with strict validation', () => {
            const invalidConfig = {
                baseUrl: 'https://api.dexto.com',
                extraProperty: 'not allowed',
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig)).toThrow(
                DextoValidationError
            );
        });
    });

    describe('ClientOptionsSchema', () => {
        it('should validate valid options', () => {
            const validOptions = {
                enableWebSocket: true,
                reconnect: false,
                reconnectInterval: 5000,
                debug: true,
            };

            const result = validateInput(ClientOptionsSchema, validOptions);
            expect(result).toEqual(validOptions);
        });

        it('should validate empty options', () => {
            const result = validateInput(ClientOptionsSchema, {});
            expect(result).toEqual({
                enableWebSocket: true,
                reconnect: true,
                reconnectInterval: 5000,
                debug: false,
            });
        });

        it('should validate undefined options', () => {
            const result = validateInput(ClientOptionsSchema, undefined);
            expect(result).toEqual({
                enableWebSocket: true,
                reconnect: true,
                reconnectInterval: 5000,
                debug: false,
            });
        });

        it('should reject invalid reconnect interval', () => {
            const invalidOptions = {
                reconnectInterval: 500, // too low
            };

            expect(() => validateInput(ClientOptionsSchema, invalidOptions)).toThrow(
                DextoValidationError
            );
        });
    });

    describe('MessageInputSchema', () => {
        it('should validate basic message', () => {
            const validMessage = {
                content: 'Hello, world!',
            };

            const result = validateInput(MessageInputSchema, validMessage);
            expect(result).toEqual(validMessage);
        });

        it('should validate message with all optional fields', () => {
            const validMessage = {
                content: 'Hello with attachments',
                imageData: {
                    base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
                    mimeType: 'image/png',
                },
                fileData: {
                    base64: 'SGVsbG8gd29ybGQ=',
                    mimeType: 'text/plain',
                    filename: 'test.txt',
                },
                sessionId: 'test-session',
                stream: true,
            };

            const result = validateInput(MessageInputSchema, validMessage);
            expect(result).toEqual(validMessage);
        });

        it('should reject empty content', () => {
            const invalidMessage = {
                content: '',
            };

            expect(() => validateInput(MessageInputSchema, invalidMessage)).toThrow(
                DextoValidationError
            );
        });

        it('should reject content that is too long', () => {
            const invalidMessage = {
                content: 'a'.repeat(50001),
            };

            expect(() => validateInput(MessageInputSchema, invalidMessage)).toThrow(
                DextoValidationError
            );
        });

        it('should reject invalid image MIME types', () => {
            const invalidMessage = {
                content: 'Test',
                imageData: {
                    base64: 'test',
                    mimeType: 'text/plain', // not an image type
                },
            };

            expect(() => validateInput(MessageInputSchema, invalidMessage)).toThrow(
                DextoValidationError
            );
        });

        it('should reject empty session ID', () => {
            const invalidMessage = {
                content: 'Test',
                sessionId: '',
            };

            expect(() => validateInput(MessageInputSchema, invalidMessage)).toThrow(
                DextoValidationError
            );
        });
    });

    describe('LLMConfigInputSchema', () => {
        it('should validate config with provider only', () => {
            const validConfig = {
                provider: 'openai',
            };

            const result = validateInput(LLMConfigInputSchema, validConfig);
            expect(result).toEqual(validConfig);
        });

        it('should validate config with model only', () => {
            const validConfig = {
                model: 'gpt-4',
            };

            const result = validateInput(LLMConfigInputSchema, validConfig);
            expect(result).toEqual(validConfig);
        });

        it('should validate full config', () => {
            const validConfig = {
                provider: 'openai',
                model: 'gpt-4',
                router: 'vercel' as const,
                apiKey: 'sk-test',
                baseUrl: 'https://api.openai.com',
                maxTokens: 4096,
                temperature: 0.7,
            };

            const result = validateInput(LLMConfigInputSchema, validConfig);
            expect(result).toEqual(validConfig);
        });

        it('should reject config with neither provider nor model', () => {
            const invalidConfig = {
                temperature: 0.5,
            };

            expect(() => validateInput(LLMConfigInputSchema, invalidConfig)).toThrow(
                DextoValidationError
            );
        });

        it('should reject invalid router values', () => {
            const invalidConfig = {
                provider: 'openai',
                router: 'invalid-router' as any,
            };

            expect(() => validateInput(LLMConfigInputSchema, invalidConfig)).toThrow(
                DextoValidationError
            );
        });

        it('should reject invalid temperature range', () => {
            const invalidConfig = {
                provider: 'openai',
                temperature: 3.0, // too high
            };

            expect(() => validateInput(LLMConfigInputSchema, invalidConfig)).toThrow(
                DextoValidationError
            );
        });

        it('should reject invalid maxTokens', () => {
            const invalidConfig = {
                provider: 'openai',
                maxTokens: 0, // too low
            };

            expect(() => validateInput(LLMConfigInputSchema, invalidConfig)).toThrow(
                DextoValidationError
            );
        });
    });

    describe('validateInput', () => {
        it('should return parsed data on success', () => {
            const schema = ClientConfigSchema.pick({ baseUrl: true });
            const validData = { baseUrl: 'https://example.com' };

            const result = validateInput(schema, validData);
            expect(result).toEqual(validData);
        });

        it('should throw DextoValidationError on validation failure', () => {
            const schema = ClientConfigSchema.pick({ baseUrl: true });
            const invalidData = { baseUrl: 'invalid' };

            expect(() => validateInput(schema, invalidData)).toThrow(DextoValidationError);
        });
    });
});
