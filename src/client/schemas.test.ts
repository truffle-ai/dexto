import { describe, it, expect } from 'vitest';
import {
    ClientConfigSchema,
    ClientOptionsSchema,
    MessageInputSchema,
    MessageResponseSchema,
    SessionInfoSchema,
    LLMConfigInputSchema,
    LLMConfigResponseSchema,
    LLMProviderSchema,
    McpServerSchema,
    ToolSchema,
    SearchOptionsSchema,
    SearchResponseSchema,
    SessionSearchResponseSchema,
    CatalogOptionsSchema,
    CatalogResponseSchema,
    CatalogModelSchema,
    CatalogProviderSchema,
    validateInput,
    validateResponse,
} from './schemas.js';
import { DextoValidationError } from './types.js';

describe('Client SDK Schema Validation', () => {
    describe('ClientConfigSchema', () => {
        it('should validate valid client config', () => {
            const validConfig = {
                baseUrl: 'https://api.example.com',
                apiKey: 'test-key',
                timeout: 5000,
                retries: 3,
            };

            expect(() => validateInput(ClientConfigSchema, validConfig, 'config')).not.toThrow();
        });

        it('should require baseUrl', () => {
            const invalidConfig = {
                apiKey: 'test-key',
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig, 'config')).toThrow(
                DextoValidationError
            );
        });

        it('should validate baseUrl as valid URL', () => {
            const invalidConfig = {
                baseUrl: 'not-a-url',
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig, 'config')).toThrow(
                DextoValidationError
            );
        });

        it('should enforce timeout limits', () => {
            const invalidConfig = {
                baseUrl: 'https://api.example.com',
                timeout: 500, // Below 1000ms minimum
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig, 'config')).toThrow(
                DextoValidationError
            );
        });

        it('should enforce retries limits', () => {
            const invalidConfig = {
                baseUrl: 'https://api.example.com',
                retries: -1,
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig, 'config')).toThrow(
                DextoValidationError
            );
        });

        it('should reject unknown fields (strict mode)', () => {
            const invalidConfig = {
                baseUrl: 'https://api.example.com',
                unknownField: 'value',
            };

            expect(() => validateInput(ClientConfigSchema, invalidConfig, 'config')).toThrow(
                DextoValidationError
            );
        });
    });

    describe('MessageInputSchema', () => {
        it('should validate basic message', () => {
            const validMessage = {
                content: 'Hello, world!',
            };

            expect(() => validateInput(MessageInputSchema, validMessage, 'message')).not.toThrow();
        });

        it('should validate message with session ID', () => {
            const validMessage = {
                content: 'Hello, world!',
                sessionId: 'session-123',
            };

            expect(() => validateInput(MessageInputSchema, validMessage, 'message')).not.toThrow();
        });

        it('should validate message with image data', () => {
            const validMessage = {
                content: 'Analyze this image',
                imageData: {
                    base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
                    mimeType: 'image/png',
                },
            };

            expect(() => validateInput(MessageInputSchema, validMessage, 'message')).not.toThrow();
        });

        it('should reject empty content', () => {
            const invalidMessage = {
                content: '',
            };

            expect(() => validateInput(MessageInputSchema, invalidMessage, 'message')).toThrow(
                DextoValidationError
            );
        });

        it('should reject content that is too long', () => {
            const invalidMessage = {
                content: 'a'.repeat(50001), // Exceeds 50,000 character limit
            };

            expect(() => validateInput(MessageInputSchema, invalidMessage, 'message')).toThrow(
                DextoValidationError
            );
        });

        it('should reject invalid image MIME types', () => {
            const invalidMessage = {
                content: 'Test message',
                imageData: {
                    base64: 'dGVzdA==',
                    mimeType: 'text/plain',
                },
            };

            expect(() => validateInput(MessageInputSchema, invalidMessage, 'message')).toThrow(
                DextoValidationError
            );
        });

        it('should accept various valid image MIME types', () => {
            const validMimeTypes = [
                'image/jpeg',
                'image/jpg',
                'image/png',
                'image/gif',
                'image/webp',
                'image/svg+xml',
            ];

            validMimeTypes.forEach((mimeType) => {
                const validMessage = {
                    content: 'Test message',
                    imageData: {
                        base64: 'dGVzdA==',
                        mimeType,
                    },
                };

                expect(() =>
                    validateInput(MessageInputSchema, validMessage, 'message')
                ).not.toThrow();
            });
        });

        it('should validate file data with filename', () => {
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

        it('should reject empty file base64 data', () => {
            const invalidMessage = {
                content: 'Process this file',
                fileData: {
                    base64: '',
                    mimeType: 'application/pdf',
                },
            };

            expect(() => validateInput(MessageInputSchema, invalidMessage, 'message')).toThrow(
                DextoValidationError
            );
        });
    });

    describe('LLMConfigInputSchema', () => {
        it('should validate basic LLM config', () => {
            const validConfig = {
                provider: 'openai',
                model: 'gpt-4',
            };

            expect(() =>
                validateInput(LLMConfigInputSchema, validConfig, 'LLM config')
            ).not.toThrow();
        });

        it('should validate config with all optional fields', () => {
            const validConfig = {
                provider: 'openai',
                model: 'gpt-4',
                router: 'vercel' as const,
                temperature: 0.7,
                maxTokens: 1000,
                baseURL: 'https://api.openai.com/v1',
            };

            expect(() =>
                validateInput(LLMConfigInputSchema, validConfig, 'LLM config')
            ).not.toThrow();
        });

        it('should accept either provider or model (not require both)', () => {
            const validConfigs = [{ provider: 'openai' }, { model: 'gpt-4' }];

            validConfigs.forEach((config) => {
                expect(() =>
                    validateInput(LLMConfigInputSchema, config, 'LLM config')
                ).not.toThrow();
            });
        });

        it('should reject config with neither provider nor model', () => {
            const invalidConfig = {
                temperature: 0.7,
            };

            expect(() => validateInput(LLMConfigInputSchema, invalidConfig, 'LLM config')).toThrow(
                DextoValidationError
            );
        });

        it('should validate router enum values', () => {
            const validRouters = ['vercel', 'in-built'];

            validRouters.forEach((router) => {
                const config = {
                    provider: 'openai',
                    router: router as any,
                };

                expect(() =>
                    validateInput(LLMConfigInputSchema, config, 'LLM config')
                ).not.toThrow();
            });
        });

        it('should reject invalid router values', () => {
            const invalidConfig = {
                provider: 'openai',
                router: 'invalid-router',
            };

            expect(() => validateInput(LLMConfigInputSchema, invalidConfig, 'LLM config')).toThrow(
                DextoValidationError
            );
        });

        it('should validate temperature range', () => {
            const validTemperatures = [0, 0.5, 1.0, 1.5, 2.0];
            const invalidTemperatures = [-0.1, 2.1, 5.0];

            validTemperatures.forEach((temperature) => {
                const config = {
                    provider: 'openai',
                    temperature,
                };

                expect(() =>
                    validateInput(LLMConfigInputSchema, config, 'LLM config')
                ).not.toThrow();
            });

            invalidTemperatures.forEach((temperature) => {
                const config = {
                    provider: 'openai',
                    temperature,
                };

                expect(() => validateInput(LLMConfigInputSchema, config, 'LLM config')).toThrow(
                    DextoValidationError
                );
            });
        });

        it('should validate maxTokens range', () => {
            const validMaxTokens = [1, 100, 1000, 1000000];
            const invalidMaxTokens = [0, -1, 1000001];

            validMaxTokens.forEach((maxTokens) => {
                const config = {
                    provider: 'openai',
                    maxTokens,
                };

                expect(() =>
                    validateInput(LLMConfigInputSchema, config, 'LLM config')
                ).not.toThrow();
            });

            invalidMaxTokens.forEach((maxTokens) => {
                const config = {
                    provider: 'openai',
                    maxTokens,
                };

                expect(() => validateInput(LLMConfigInputSchema, config, 'LLM config')).toThrow(
                    DextoValidationError
                );
            });
        });
    });

    describe('SearchOptionsSchema', () => {
        it('should validate empty search options', () => {
            expect(() => validateInput(SearchOptionsSchema, {}, 'search options')).not.toThrow();
        });

        it('should validate all search options', () => {
            const validOptions = {
                limit: 10,
                offset: 20,
                sessionId: 'session-123',
                role: 'user' as const,
            };

            expect(() =>
                validateInput(SearchOptionsSchema, validOptions, 'search options')
            ).not.toThrow();
        });

        it('should validate role enum values', () => {
            const validRoles = ['user', 'assistant', 'system', 'tool'];

            validRoles.forEach((role) => {
                const options = { role: role as any };
                expect(() =>
                    validateInput(SearchOptionsSchema, options, 'search options')
                ).not.toThrow();
            });
        });

        it('should reject invalid role values', () => {
            const invalidOptions = {
                role: 'invalid-role',
            };

            expect(() =>
                validateInput(SearchOptionsSchema, invalidOptions, 'search options')
            ).toThrow(DextoValidationError);
        });

        it('should validate limit range', () => {
            const validLimits = [1, 10, 100, 1000];
            const invalidLimits = [0, -1, 1001];

            validLimits.forEach((limit) => {
                const options = { limit };
                expect(() =>
                    validateInput(SearchOptionsSchema, options, 'search options')
                ).not.toThrow();
            });

            invalidLimits.forEach((limit) => {
                const options = { limit };
                expect(() => validateInput(SearchOptionsSchema, options, 'search options')).toThrow(
                    DextoValidationError
                );
            });
        });

        it('should validate offset range', () => {
            const validOffsets = [0, 10, 100, 1000];
            const invalidOffsets = [-1, -10];

            validOffsets.forEach((offset) => {
                const options = { offset };
                expect(() =>
                    validateInput(SearchOptionsSchema, options, 'search options')
                ).not.toThrow();
            });

            invalidOffsets.forEach((offset) => {
                const options = { offset };
                expect(() => validateInput(SearchOptionsSchema, options, 'search options')).toThrow(
                    DextoValidationError
                );
            });
        });
    });

    describe('CatalogOptionsSchema', () => {
        it('should validate empty catalog options', () => {
            expect(() => validateInput(CatalogOptionsSchema, {}, 'catalog options')).not.toThrow();
        });

        it('should validate all catalog options', () => {
            const validOptions = {
                provider: 'openai',
                hasKey: true,
                router: 'vercel' as const,
                fileType: 'image' as const,
                defaultOnly: true,
                mode: 'grouped' as const,
            };

            expect(() =>
                validateInput(CatalogOptionsSchema, validOptions, 'catalog options')
            ).not.toThrow();
        });

        it('should validate router enum values', () => {
            const validRouters = ['vercel', 'in-built'];

            validRouters.forEach((router) => {
                const options = { router: router as any };
                expect(() =>
                    validateInput(CatalogOptionsSchema, options, 'catalog options')
                ).not.toThrow();
            });
        });

        it('should validate fileType enum values', () => {
            const validFileTypes = ['audio', 'pdf', 'image', 'text'];

            validFileTypes.forEach((fileType) => {
                const options = { fileType: fileType as any };
                expect(() =>
                    validateInput(CatalogOptionsSchema, options, 'catalog options')
                ).not.toThrow();
            });
        });

        it('should validate mode enum values', () => {
            const validModes = ['grouped', 'flat'];

            validModes.forEach((mode) => {
                const options = { mode: mode as any };
                expect(() =>
                    validateInput(CatalogOptionsSchema, options, 'catalog options')
                ).not.toThrow();
            });
        });

        it('should reject invalid enum values', () => {
            const invalidOptions = [
                { router: 'invalid-router' },
                { fileType: 'invalid-type' },
                { mode: 'invalid-mode' },
            ];

            invalidOptions.forEach((options) => {
                expect(() =>
                    validateInput(CatalogOptionsSchema, options, 'catalog options')
                ).toThrow(DextoValidationError);
            });
        });
    });

    describe('Response Schema Validation', () => {
        it('should validate MessageResponse', () => {
            const validResponse = {
                response: 'Test response',
                sessionId: 'session-123',
            };

            expect(() =>
                validateResponse(MessageResponseSchema, validResponse, 'response')
            ).not.toThrow();
        });

        it('should validate SessionInfo', () => {
            const validSession = {
                id: 'session-123',
                createdAt: Date.now(),
                lastActivity: Date.now(),
                messageCount: 5,
            };

            expect(() =>
                validateResponse(SessionInfoSchema, validSession, 'session')
            ).not.toThrow();
        });

        it('should reject SessionInfo with negative messageCount', () => {
            const invalidSession = {
                id: 'session-123',
                createdAt: Date.now(),
                lastActivity: Date.now(),
                messageCount: -1,
            };

            expect(() => validateResponse(SessionInfoSchema, invalidSession, 'session')).toThrow(
                DextoValidationError
            );
        });

        it('should validate SearchResponse', () => {
            const validResponse = {
                results: [
                    {
                        id: 'msg-1',
                        content: 'Test message',
                        role: 'user',
                        sessionId: 'session-123',
                        timestamp: Date.now(),
                    },
                ],
                total: 1,
                hasMore: false,
            };

            expect(() =>
                validateResponse(SearchResponseSchema, validResponse, 'search')
            ).not.toThrow();
        });

        it('should validate CatalogResponse with providers', () => {
            const validResponse = {
                providers: {
                    openai: {
                        name: 'OpenAI',
                        hasApiKey: true,
                        primaryEnvVar: 'OPENAI_API_KEY',
                        supportedRouters: ['vercel'],
                        supportsBaseURL: true,
                        models: [
                            {
                                name: 'gpt-4',
                                maxInputTokens: 8000,
                                supportedFileTypes: ['image', 'text'],
                            },
                        ],
                    },
                },
            };

            expect(() =>
                validateResponse(CatalogResponseSchema, validResponse, 'catalog')
            ).not.toThrow();
        });

        it('should validate CatalogResponse with models', () => {
            const validResponse = {
                models: [
                    {
                        name: 'gpt-4',
                        provider: 'openai',
                        maxInputTokens: 8000,
                        supportedFileTypes: ['image', 'text'],
                        pricing: {
                            inputPerM: 5.0,
                            outputPerM: 15.0,
                            currency: 'USD' as const,
                            unit: 'per_million_tokens' as const,
                        },
                    },
                ],
            };

            expect(() =>
                validateResponse(CatalogResponseSchema, validResponse, 'catalog')
            ).not.toThrow();
        });
    });

    describe('Validation Helper Functions', () => {
        it('should return data on successful validation', () => {
            const data = { baseUrl: 'https://api.example.com' };
            const result = validateInput(ClientConfigSchema, data, 'config');
            expect(result).toEqual(data);
        });

        it('should throw DextoValidationError with context on failure', () => {
            const invalidData = { baseUrl: 'invalid-url' };

            expect(() => {
                validateInput(ClientConfigSchema, invalidData, 'test config');
            }).toThrow(DextoValidationError);

            try {
                validateInput(ClientConfigSchema, invalidData, 'test config');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoValidationError);
                expect((error as DextoValidationError).message).toContain('Invalid test config');
                expect((error as DextoValidationError).validationErrors).toBeInstanceOf(Array);
                expect((error as DextoValidationError).validationErrors.length).toBeGreaterThan(0);
            }
        });

        it('should throw DextoValidationError for response validation failures', () => {
            const invalidResponse = { sessionId: 'test' }; // Missing required 'response' field

            expect(() => {
                validateResponse(MessageResponseSchema, invalidResponse, 'message response');
            }).toThrow(DextoValidationError);

            try {
                validateResponse(MessageResponseSchema, invalidResponse, 'message response');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoValidationError);
                expect((error as DextoValidationError).message).toContain(
                    'Invalid response from server'
                );
                expect((error as DextoValidationError).message).toContain('message response');
            }
        });
    });
});
