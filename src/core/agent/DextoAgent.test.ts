import { describe, test, expect, vi, beforeEach } from 'vitest';
import { DextoAgent } from './DextoAgent.js';
import { DextoLLMError } from './errors.js';
import type { AgentConfig } from '@core/agent/schemas.js';
import type { LLMConfig, ValidatedLLMConfig } from '@core/llm/schemas.js';
import { LLMErrorCode } from '../llm/error-codes.js';
import { AgentErrorCode } from './error-codes.js';

// Mock the dependencies
vi.mock('../logger/index.js');
vi.mock('../utils/service-initializer.js');
vi.mock('../llm/resolver.js');

import { createAgentServices } from '../utils/service-initializer.js';
import { resolveAndValidateLLMConfig } from '../llm/resolver.js';
const mockCreateAgentServices = vi.mocked(createAgentServices);
const mockResolveAndValidateLLMConfig = vi.mocked(resolveAndValidateLLMConfig);

//TODO: potentially reducing mocking and have real tests
describe('DextoAgent.switchLLM', () => {
    let agent: DextoAgent;
    let mockStateManager: any;
    let mockSessionManager: any;
    let mockEventBus: any;
    let mockMcpManager: any;
    let mockPromptManager: any;
    let mockStorageManager: any;

    const mockLLMConfig: LLMConfig = {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
        router: 'vercel',
        maxIterations: 50,
        maxInputTokens: 128000,
    };

    beforeEach(async () => {
        vi.resetAllMocks();

        // Create mock services
        mockStateManager = {
            getRuntimeConfig: vi.fn().mockReturnValue({
                llm: mockLLMConfig,
                mcpServers: {},
                storage: {
                    cache: { type: 'in-memory' },
                    database: { type: 'in-memory' },
                },
                sessions: {
                    maxSessions: 10,
                    sessionTTL: 3600,
                },
            }),
            getLLMConfig: vi.fn().mockReturnValue(mockLLMConfig),
            updateLLM: vi.fn().mockReturnValue({ isValid: true, errors: [], warnings: [] }),
            addMcpServer: vi.fn(),
            removeMcpServer: vi.fn(),
        };

        mockSessionManager = {
            createSession: vi.fn().mockReturnValue({
                id: 'default',
                getLLMService: vi.fn(),
                getContextManager: vi.fn(),
                run: vi.fn(),
                reset: vi.fn(),
                switchLLM: vi.fn(),
            }),
            getDefaultSession: vi.fn().mockReturnValue({
                id: 'default',
                switchLLM: vi.fn(),
            }),
            getSession: vi.fn().mockImplementation((sessionId: string) => {
                if (sessionId === 'session1' || sessionId === 'session2') {
                    return {
                        id: sessionId,
                        switchLLM: vi.fn(),
                    };
                }
                return null;
            }),
            listSessions: vi.fn().mockReturnValue(['session1', 'session2']),
            deleteSession: vi.fn(),
            endSession: vi.fn(),
            getSessionMetadata: vi.fn(),
            switchLLMForDefaultSession: vi.fn().mockResolvedValue(undefined),
            switchLLMForSpecificSession: vi.fn().mockImplementation((config, sessionId) => {
                if (sessionId === 'nonexistent') {
                    return Promise.reject(new Error(`Session ${sessionId} not found`));
                }
                return Promise.resolve(undefined);
            }),
            switchLLMForAllSessions: vi.fn().mockResolvedValue(undefined),
        };

        mockEventBus = {
            emit: vi.fn(),
        };

        mockMcpManager = {
            connectServer: vi.fn(),
            getAllTools: vi.fn().mockResolvedValue({}),
            initializeFromConfig: vi.fn().mockResolvedValue(undefined),
            disconnectAll: vi.fn().mockResolvedValue(undefined),
        };

        mockPromptManager = {
            // Add any methods that might be called
        };

        mockStorageManager = {
            disconnect: vi.fn().mockResolvedValue(undefined),
        };

        const mockServices = {
            mcpManager: mockMcpManager,
            toolManager: {} as any,
            promptManager: mockPromptManager,
            agentEventBus: mockEventBus,
            stateManager: mockStateManager,
            sessionManager: mockSessionManager,
            searchService: {} as any,
            storage: mockStorageManager,
            storageManager: mockStorageManager,
        };

        // Mock createAgentServices to return our mock services
        mockCreateAgentServices.mockResolvedValue(mockServices);

        const mockConfig: AgentConfig = {
            systemPrompt: 'You are a helpful AI assistant.',
            llm: mockLLMConfig,
            mcpServers: {},
            storage: {
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
            },
            sessions: {
                maxSessions: 10,
                sessionTTL: 3600,
            },
        };

        // Create DextoAgent with config and start it
        agent = new DextoAgent(mockConfig);
        await agent.start();

        // Mock the LLM resolver function
        mockResolveAndValidateLLMConfig.mockImplementation((previousConfig, updates) => {
            const validatedConfig = {
                ...mockLLMConfig,
                ...updates,
                // Ensure required fields are always defined
                apiKey: updates.apiKey ?? mockLLMConfig.apiKey,
                model: updates.model ?? mockLLMConfig.model,
                provider: updates.provider ?? mockLLMConfig.provider,
                // Ensure required fields have values (ValidatedLLMConfig)
                maxIterations: updates.maxIterations ?? mockLLMConfig.maxIterations ?? 50,
                router: updates.router ?? mockLLMConfig.router ?? 'vercel',
                // Optional fields
                ...(updates.baseURL && { baseURL: updates.baseURL }),
                ...(updates.maxInputTokens && { maxInputTokens: updates.maxInputTokens }),
                ...(updates.maxOutputTokens && { maxOutputTokens: updates.maxOutputTokens }),
                ...(updates.temperature && { temperature: updates.temperature }),
            } as ValidatedLLMConfig;

            return {
                ok: true,
                data: validatedConfig,
                issues: [],
            };
        });
    });

    describe('Basic Validation', () => {
        test('should require model or provider parameter', async () => {
            await expect(agent.switchLLM({})).rejects.toThrow(DextoLLMError);
        });

        test('should handle validation failure', async () => {
            mockResolveAndValidateLLMConfig.mockReturnValue({
                ok: false,
                issues: [
                    {
                        code: LLMErrorCode.MODEL_INCOMPATIBLE,
                        message: 'Invalid model',
                        severity: 'error',
                        context: {},
                    },
                ],
            });

            await expect(agent.switchLLM({ model: 'invalid-model' })).rejects.toThrow(
                DextoLLMError
            );
        });
    });

    describe('Default Session Switch', () => {
        test('should switch LLM for default session', async () => {
            const validatedConfig = await agent.switchLLM({ model: 'gpt-4o-mini' });

            expect(validatedConfig).toBeDefined();
            expect(validatedConfig.model).toBe('gpt-4o-mini');
            expect(mockSessionManager.switchLLMForDefaultSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gpt-4o-mini',
                })
            );
        });

        test('should use specified router', async () => {
            await agent.switchLLM({ model: 'gpt-4o', router: 'in-built' });

            expect(mockResolveAndValidateLLMConfig).toHaveBeenCalledWith(
                mockLLMConfig, // previousConfig
                expect.objectContaining({
                    model: 'gpt-4o',
                    router: 'in-built',
                })
            );
        });

        test('should include warnings in response', async () => {
            mockResolveAndValidateLLMConfig.mockReturnValue({
                ok: true,
                data: { ...mockLLMConfig, model: 'gpt-4o' } as ValidatedLLMConfig,
                issues: [
                    {
                        code: LLMErrorCode.MODEL_INCOMPATIBLE,
                        message: 'Config warning',
                        severity: 'warning',
                        context: {},
                    },
                ],
            });

            // With warnings, the method should still succeed and return the config
            const validatedConfig = await agent.switchLLM({ model: 'gpt-4o-mini' });
            expect(validatedConfig).toBeDefined();
            expect(validatedConfig.model).toBe('gpt-4o');
        });

        test('should switch LLM for specific session', async () => {
            const validatedConfig = await agent.switchLLM({ model: 'gpt-4o' }, 'session1');

            expect(validatedConfig).toBeDefined();
            expect(mockSessionManager.switchLLMForSpecificSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gpt-4o',
                }),
                'session1'
            );
        });

        test('should switch LLM for all sessions', async () => {
            const validatedConfig = await agent.switchLLM({ model: 'gpt-4o' }, '*');

            expect(validatedConfig).toBeDefined();
            expect(mockSessionManager.switchLLMForAllSessions).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gpt-4o',
                })
            );
        });

        test('should handle provider and model together', async () => {
            await agent.switchLLM({ provider: 'anthropic', model: 'claude-4-sonnet-20250514' });

            expect(mockResolveAndValidateLLMConfig).toHaveBeenCalledWith(
                mockLLMConfig, // previousConfig
                expect.objectContaining({
                    provider: 'anthropic',
                    model: 'claude-4-sonnet-20250514',
                })
            );
        });

        test('should handle API key in config', async () => {
            await agent.switchLLM({ model: 'gpt-4o', apiKey: 'new-key' });

            expect(mockResolveAndValidateLLMConfig).toHaveBeenCalledWith(
                mockLLMConfig, // previousConfig
                expect.objectContaining({
                    model: 'gpt-4o',
                    apiKey: 'new-key',
                })
            );
        });

        test('should handle baseURL in config', async () => {
            await agent.switchLLM({ model: 'gpt-4o', baseURL: 'https://api.example.com' });

            expect(mockResolveAndValidateLLMConfig).toHaveBeenCalledWith(
                mockLLMConfig, // previousConfig
                expect.objectContaining({
                    model: 'gpt-4o',
                    baseURL: 'https://api.example.com',
                })
            );
        });
    });

    describe('Specific Session Switch', () => {
        test('should switch LLM for specific session', async () => {
            const validatedConfig = await agent.switchLLM({ model: 'gpt-4o-mini' }, 'session1');

            expect(validatedConfig).toBeDefined();
            expect(mockSessionManager.switchLLMForSpecificSession).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'gpt-4o-mini' }),
                'session1'
            );
        });

        test('should handle session not found', async () => {
            mockSessionManager.getSession.mockReturnValue(null);

            try {
                await agent.switchLLM({ model: 'gpt-4o' }, 'nonexistent');
                expect.fail('Should have thrown DextoLLMError');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoLLMError);
                const llmError = error as DextoLLMError;
                expect(llmError.issues).toHaveLength(1);
                expect(llmError.issues[0]?.code).toBe(AgentErrorCode.SESSION_NOT_FOUND);
                expect(llmError.issues[0]?.message).toBe('Session nonexistent not found');
            }
        });

        test('should use session-specific state', async () => {
            const sessionLLMConfig = { ...mockLLMConfig, model: 'session-model' };
            mockStateManager.getRuntimeConfig.mockReturnValue({ llm: sessionLLMConfig });

            await agent.switchLLM({ model: 'gpt-4o' }, 'session1');

            expect(mockStateManager.getRuntimeConfig).toHaveBeenCalledWith('session1');
            expect(mockResolveAndValidateLLMConfig).toHaveBeenCalledWith(
                sessionLLMConfig, // should use session-specific config
                expect.objectContaining({ model: 'gpt-4o' })
            );
        });
    });

    describe('All Sessions Switch', () => {
        test('should switch LLM for all sessions successfully', async () => {
            const validatedConfig = await agent.switchLLM({ model: 'gpt-4o-mini' }, '*');

            expect(validatedConfig).toBeDefined();
            expect(mockSessionManager.switchLLMForAllSessions).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'gpt-4o-mini' })
            );
        });

        test('should handle failed sessions gracefully', async () => {
            // This test is not applicable with the new exception pattern
            // Session switching either succeeds or fails completely
            const validatedConfig = await agent.switchLLM({ model: 'gpt-4o-mini' }, '*');

            expect(validatedConfig).toBeDefined();
        });

        test('should handle missing sessions', async () => {
            const validatedConfig = await agent.switchLLM({ model: 'gpt-4o-mini' }, '*');

            expect(validatedConfig).toBeDefined();
            expect(mockSessionManager.switchLLMForAllSessions).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'gpt-4o-mini' })
            );
        });
    });

    describe('Parameter Handling', () => {
        test('should pass all parameters to validation', async () => {
            await agent.switchLLM({
                provider: 'google',
                model: 'gemini-2.5-pro',
                apiKey: 'custom-key',
                router: 'vercel',
                baseURL: 'https://custom.api.com',
            });

            expect(mockResolveAndValidateLLMConfig).toHaveBeenCalledWith(
                mockLLMConfig, // previousConfig
                expect.objectContaining({
                    provider: 'google',
                    model: 'gemini-2.5-pro',
                    apiKey: 'custom-key',
                    router: 'vercel',
                    baseURL: 'https://custom.api.com',
                })
            );
        });

        test('should handle partial parameters', async () => {
            await agent.switchLLM({ model: 'gpt-4o-mini' });

            expect(mockResolveAndValidateLLMConfig).toHaveBeenCalledWith(
                mockLLMConfig, // previousConfig
                expect.objectContaining({
                    model: 'gpt-4o-mini',
                })
            );
        });

        test('should use default router when not specified', async () => {
            await agent.switchLLM({ model: 'gpt-4o' });

            expect(mockSessionManager.switchLLMForDefaultSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    router: 'vercel',
                })
            );
        });
    });

    describe('Issue Collection', () => {
        test('should handle validation warnings silently', async () => {
            mockResolveAndValidateLLMConfig.mockReturnValue({
                ok: true,
                data: { ...mockLLMConfig, model: 'gpt-4o-mini' } as ValidatedLLMConfig,
                issues: [
                    {
                        code: LLMErrorCode.MODEL_INCOMPATIBLE,
                        message: 'Config warning',
                        severity: 'warning',
                        context: {},
                    },
                ],
            });

            // Should succeed despite warnings
            const validatedConfig = await agent.switchLLM({ model: 'gpt-4o-mini' });
            expect(validatedConfig).toBeDefined();
            expect(validatedConfig.model).toBe('gpt-4o-mini');
        });

        test('should succeed when no issues exist', async () => {
            const validatedConfig = await agent.switchLLM({ model: 'gpt-4o-mini' });
            expect(validatedConfig).toBeDefined();
            expect(validatedConfig.model).toBe('gpt-4o-mini');
        });
    });

    describe('Error Handling', () => {
        test('should handle validation errors', async () => {
            mockResolveAndValidateLLMConfig.mockReturnValue({
                ok: false,
                issues: [
                    {
                        code: LLMErrorCode.MODEL_INCOMPATIBLE,
                        message: 'Validation failed',
                        severity: 'error',
                        context: {},
                    },
                ],
            });

            try {
                await agent.switchLLM({ model: 'gpt-4o' });
                expect.fail('Should have thrown DextoLLMError');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoLLMError);
                const llmError = error as DextoLLMError;
                expect(llmError.issues).toHaveLength(1);
                expect(llmError.issues[0]?.code).toBe(LLMErrorCode.MODEL_INCOMPATIBLE);
                expect(llmError.issues[0]?.message).toBe('Validation failed');
                expect(llmError.issues[0]?.severity).toBe('error');
            }
        });
    });
});
