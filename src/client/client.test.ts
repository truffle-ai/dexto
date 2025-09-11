import { describe, it, expect } from 'vitest';
import { DextoValidationError } from './types.js';
import {
    validateInput,
    validateResponse,
    ClientConfigSchema,
    ClientOptionsSchema,
    MessageInputSchema,
    MessageResponseSchema,
} from './schemas.js';

describe('DextoClient Validation', () => {
    describe('Constructor Config Validation', () => {
        it('should validate valid config successfully', () => {
            const validConfig = {
                baseUrl: 'https://api.example.com',
                timeout: 5000,
                retries: 2,
            };

            expect(() => validateInput(ClientConfigSchema, validConfig, 'config')).not.toThrow();
        });

        it('should throw DextoValidationError for missing baseUrl', () => {
            const invalidConfig = {};

            expect(() => validateInput(ClientConfigSchema, invalidConfig, 'config')).toThrow(
                DextoValidationError
            );
        });

        it('should throw DextoValidationError for invalid baseUrl', () => {
            const invalidConfig = {
                baseUrl: 'not-a-url',
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig, 'config')).toThrow(
                DextoValidationError
            );
        });

        it('should throw DextoValidationError for invalid timeout', () => {
            const invalidConfig = {
                baseUrl: 'https://api.example.com',
                timeout: 500, // Below minimum of 1000ms
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig, 'config')).toThrow(
                DextoValidationError
            );
        });

        it('should throw DextoValidationError for invalid retries', () => {
            const invalidConfig = {
                baseUrl: 'https://api.example.com',
                retries: -1,
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig, 'config')).toThrow(
                DextoValidationError
            );
        });

        it('should throw DextoValidationError for invalid client options', () => {
            const invalidOptions = {
                reconnectInterval: 500, // Below minimum of 1000ms
            };

            expect(() => validateInput(ClientOptionsSchema, invalidOptions, 'options')).toThrow(
                DextoValidationError
            );
        });
    });

    describe('Message Input Validation', () => {
        it('should validate valid message input', () => {
            const validMessage = {
                content: 'Hello, world!',
                sessionId: 'session-123',
            };

            expect(() => validateInput(MessageInputSchema, validMessage, 'message')).not.toThrow();
        });

        it('should throw DextoValidationError for empty message content', () => {
            const invalidMessage = {
                content: '',
            };

            expect(() => validateInput(MessageInputSchema, invalidMessage, 'message')).toThrow(
                DextoValidationError
            );
        });

        it('should throw DextoValidationError for message content too long', () => {
            const invalidMessage = {
                content: 'a'.repeat(50001), // Exceeds 50,000 character limit
            };

            expect(() => validateInput(MessageInputSchema, invalidMessage, 'message')).toThrow(
                DextoValidationError
            );
        });

        it('should throw DextoValidationError for invalid imageData MIME type', () => {
            const invalidMessage = {
                content: 'Test message',
                imageData: {
                    base64: 'dGVzdA==',
                    mimeType: 'text/plain', // Invalid for image
                },
            };

            expect(() => validateInput(MessageInputSchema, invalidMessage, 'message')).toThrow(
                DextoValidationError
            );
        });

        it('should throw DextoValidationError for empty imageData base64', () => {
            const invalidMessage = {
                content: 'Test message',
                imageData: {
                    base64: '',
                    mimeType: 'image/jpeg',
                },
            };

            expect(() => validateInput(MessageInputSchema, invalidMessage, 'message')).toThrow(
                DextoValidationError
            );
        });

        it('should validate valid image data', () => {
            const validMessage = {
                content: 'Analyze this image',
                imageData: {
                    base64: 'iVBORw0KGgoAAAANSUhEUgAA',
                    mimeType: 'image/png',
                },
            };

            expect(() => validateInput(MessageInputSchema, validMessage, 'message')).not.toThrow();
        });

        it('should validate valid file data with filename', () => {
            const validMessage = {
                content: 'Process this file',
                fileData: {
                    base64: 'UERGLTEuNA==',
                    mimeType: 'application/pdf',
                    filename: 'document.pdf',
                },
            };

            expect(() => validateInput(MessageInputSchema, validMessage, 'message')).not.toThrow();
        });
    });

    describe('Response Validation', () => {
        it('should validate and return valid response', () => {
            const validResponse = {
                response: 'Valid response',
                sessionId: 'session-123',
            };

            expect(() =>
                validateResponse(MessageResponseSchema, validResponse, 'message response')
            ).not.toThrow();
        });

        it('should throw DextoValidationError for invalid response structure', () => {
            const invalidResponse = {
                // Missing required 'response' field
                sessionId: 'session-123',
            };

            expect(() =>
                validateResponse(MessageResponseSchema, invalidResponse, 'message response')
            ).toThrow(DextoValidationError);
        });
    });
});
