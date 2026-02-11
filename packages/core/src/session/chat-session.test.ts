import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatSession } from './chat-session.js';
import { type ValidatedLLMConfig } from '../llm/schemas.js';
import { LLMConfigSchema } from '../llm/schemas.js';

// Mock all dependencies
vi.mock('./history/factory.js', () => ({
    createDatabaseHistoryProvider: vi.fn(),
}));
vi.mock('../llm/services/factory.js', () => ({
    createLLMService: vi.fn(),
}));
vi.mock('../llm/registry/index.js', async (importOriginal) => {
    const actual = (await importOriginal()) as typeof import('../llm/registry/index.js');
    return {
        ...actual,
        getEffectiveMaxInputTokens: vi.fn(),
    };
});
vi.mock('../logger/index.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        silly: vi.fn(),
    },
}));

import { createDatabaseHistoryProvider } from './history/factory.js';
import { createLLMService } from '../llm/services/factory.js';
import { getEffectiveMaxInputTokens } from '../llm/registry/index.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

const mockCreateDatabaseHistoryProvider = vi.mocked(createDatabaseHistoryProvider);
const mockCreateLLMService = vi.mocked(createLLMService);
const mockGetEffectiveMaxInputTokens = vi.mocked(getEffectiveMaxInputTokens);

describe('ChatSession', () => {
    let chatSession: ChatSession;
    let mockServices: any;
    let mockHistoryProvider: any;
    let mockLLMService: any;
    let mockCache: any;
    let mockDatabase: any;
    let mockBlobStore: any;
    let mockContextManager: any;
    const mockLogger = createMockLogger();

    const sessionId = 'test-session-123';
    const mockLLMConfig = LLMConfigSchema.parse({
        provider: 'openai',
        model: 'gpt-5',
        apiKey: 'test-key',
        maxIterations: 50,
        maxInputTokens: 128000,
    });

    beforeEach(() => {
        vi.resetAllMocks();

        // Mock history provider
        mockHistoryProvider = {
            addMessage: vi.fn().mockResolvedValue(undefined),
            getMessages: vi.fn().mockResolvedValue([]),
            clearHistory: vi.fn().mockResolvedValue(undefined),
            getMessageCount: vi.fn().mockResolvedValue(0),
        };

        // Mock LLM service
        mockContextManager = {
            resetConversation: vi.fn().mockResolvedValue(undefined),
        };
        mockLLMService = {
            stream: vi.fn().mockResolvedValue('Mock response'),
            switchLLM: vi.fn().mockResolvedValue(undefined),
            getContextManager: vi.fn().mockReturnValue(mockContextManager),
            eventBus: {
                emit: vi.fn(),
                on: vi.fn(),
                off: vi.fn(),
            },
        };

        // Mock storage manager with proper getter structure
        mockCache = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(true),
            list: vi.fn().mockResolvedValue([]),
            clear: vi.fn().mockResolvedValue(undefined),
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            isConnected: vi.fn().mockReturnValue(true),
            getBackendType: vi.fn().mockReturnValue('memory'),
        };

        mockDatabase = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(true),
            list: vi.fn().mockResolvedValue([]),
            clear: vi.fn().mockResolvedValue(undefined),
            append: vi.fn().mockResolvedValue(undefined),
            getRange: vi.fn().mockResolvedValue([]),
            getLength: vi.fn().mockResolvedValue(0),
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            isConnected: vi.fn().mockReturnValue(true),
            getBackendType: vi.fn().mockReturnValue('memory'),
        };

        mockBlobStore = {
            store: vi.fn().mockResolvedValue({ id: 'test', uri: 'blob:test' }),
            retrieve: vi.fn().mockResolvedValue({ data: '', metadata: {} }),
            exists: vi.fn().mockResolvedValue(false),
            delete: vi.fn().mockResolvedValue(undefined),
            cleanup: vi.fn().mockResolvedValue(0),
            getStats: vi.fn().mockResolvedValue({ count: 0, totalSize: 0, backendType: 'local' }),
            listBlobs: vi.fn().mockResolvedValue([]),
            getStoragePath: vi.fn().mockReturnValue(undefined),
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            isConnected: vi.fn().mockReturnValue(true),
            getStoreType: vi.fn().mockReturnValue('local'),
        };

        const mockStorageManager = {
            getCache: vi.fn().mockReturnValue(mockCache),
            getDatabase: vi.fn().mockReturnValue(mockDatabase),
            getBlobStore: vi.fn().mockReturnValue(mockBlobStore),
            disconnect: vi.fn().mockResolvedValue(undefined),
        };

        // Mock services
        mockServices = {
            stateManager: {
                getLLMConfig: vi.fn().mockReturnValue(mockLLMConfig),
                getRuntimeConfig: vi.fn().mockReturnValue({
                    llm: mockLLMConfig,
                    compression: { type: 'noop', enabled: true },
                }),
                updateLLM: vi.fn().mockReturnValue({ isValid: true, errors: [], warnings: [] }),
            },
            systemPromptManager: {
                getSystemPrompt: vi.fn().mockReturnValue('System prompt'),
            },
            mcpManager: {
                getAllTools: vi.fn().mockResolvedValue({}),
            },
            agentEventBus: {
                emit: vi.fn(),
                on: vi.fn(),
                off: vi.fn(),
            },
            compactionStrategy: null,
            storageManager: mockStorageManager,
            resourceManager: {
                getBlobStore: vi.fn(),
                readResource: vi.fn(),
                listResources: vi.fn(),
            },
            toolManager: {
                getAllTools: vi.fn().mockReturnValue([]),
            },
            pluginManager: {
                executePlugins: vi.fn().mockImplementation(async (_point, payload) => payload),
                cleanup: vi.fn(),
            },
            sessionManager: {
                // Add sessionManager mock if needed
            },
        };

        // Set up factory mocks
        mockCreateDatabaseHistoryProvider.mockReturnValue(mockHistoryProvider);
        mockCreateLLMService.mockReturnValue(mockLLMService);
        mockGetEffectiveMaxInputTokens.mockReturnValue(128000);

        // Create ChatSession instance
        chatSession = new ChatSession(mockServices, sessionId, mockLogger);
    });

    afterEach(() => {
        // Clean up any resources
        if (chatSession) {
            chatSession.dispose();
        }
    });

    describe('Session Identity and Lifecycle', () => {
        test('should maintain session identity throughout lifecycle', () => {
            expect(chatSession.id).toBe(sessionId);
            expect(chatSession.eventBus).toBeDefined();
        });

        test('should initialize with unified storage system', async () => {
            await chatSession.init();

            // Verify createDatabaseHistoryProvider is called with the database backend, sessionId, and logger
            expect(mockCreateDatabaseHistoryProvider).toHaveBeenCalledWith(
                mockDatabase,
                sessionId,
                expect.any(Object) // Logger object
            );
        });

        test('should properly dispose resources to prevent memory leaks', () => {
            const eventSpy = vi.spyOn(chatSession.eventBus, 'off');

            chatSession.dispose();
            chatSession.dispose(); // Should not throw on multiple calls

            expect(eventSpy).toHaveBeenCalled();
        });
    });

    describe('Event System Integration', () => {
        test('should forward all session events to agent bus with session context', async () => {
            await chatSession.init();

            // Emit a session event
            chatSession.eventBus.emit('llm:thinking');

            expect(mockServices.agentEventBus.emit).toHaveBeenCalledWith(
                'llm:thinking',
                expect.objectContaining({
                    sessionId,
                })
            );
        });

        test('should handle events with no payload by adding session context', async () => {
            await chatSession.init();

            // Emit event without payload (using llm:thinking as example)
            chatSession.eventBus.emit('llm:thinking');

            expect(mockServices.agentEventBus.emit).toHaveBeenCalledWith('llm:thinking', {
                sessionId,
            });
        });

        test('should emit dexto:conversationReset event when conversation is reset', async () => {
            await chatSession.init();

            await chatSession.reset();

            // Should reset conversation via ContextManager
            expect(mockContextManager.resetConversation).toHaveBeenCalled();

            // Should emit dexto:conversationReset event with session context
            expect(mockServices.agentEventBus.emit).toHaveBeenCalledWith('session:reset', {
                sessionId,
            });
        });
    });

    describe('LLM Configuration Management', () => {
        beforeEach(async () => {
            await chatSession.init();
        });

        test('should create new LLM service when configuration changes', async () => {
            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                maxInputTokens: 256000, // Change maxInputTokens
            };

            // Clear previous calls
            mockCreateLLMService.mockClear();

            await chatSession.switchLLM(newConfig);

            // Should create a new LLM service with updated config
            expect(mockCreateLLMService).toHaveBeenCalledWith(
                newConfig,
                mockServices.toolManager,
                mockServices.systemPromptManager,
                mockHistoryProvider,
                chatSession.eventBus,
                sessionId,
                mockServices.resourceManager,
                mockLogger,
                null // compaction strategy
            );
        });

        test('should create new LLM service during LLM switch', async () => {
            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'anthropic',
                model: 'claude-4-opus-20250514',
            };

            // Clear previous calls to createLLMService
            mockCreateLLMService.mockClear();

            await chatSession.switchLLM(newConfig);

            // Should create a new LLM service with the new config
            expect(mockCreateLLMService).toHaveBeenCalledWith(
                newConfig,
                mockServices.toolManager,
                mockServices.systemPromptManager,
                mockHistoryProvider,
                chatSession.eventBus,
                sessionId,
                mockServices.resourceManager,
                mockLogger,
                null // compaction strategy
            );
        });

        test('should emit LLM switched event with correct metadata', async () => {
            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'anthropic',
                model: 'claude-4-opus-20250514',
            };

            const eventSpy = vi.spyOn(chatSession.eventBus, 'emit');

            await chatSession.switchLLM(newConfig);

            expect(eventSpy).toHaveBeenCalledWith(
                'llm:switched',
                expect.objectContaining({
                    newConfig,
                    historyRetained: true,
                })
            );
        });
    });

    describe('Error Handling and Resilience', () => {
        test('should handle storage initialization failures gracefully', async () => {
            mockCreateDatabaseHistoryProvider.mockImplementation(() => {
                throw new Error('Storage initialization failed');
            });

            // The init method should throw the error since it doesn't catch it
            await expect(chatSession.init()).rejects.toThrow('Storage initialization failed');
        });

        test('should handle LLM service creation failures', async () => {
            mockCreateLLMService.mockImplementation(() => {
                throw new Error('LLM service creation failed');
            });

            await expect(chatSession.init()).rejects.toThrow('LLM service creation failed');
        });

        test('should handle LLM switch failures and propagate errors', async () => {
            await chatSession.init();

            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'invalid-provider' as any,
            };

            mockCreateLLMService.mockImplementation(() => {
                throw new Error('Invalid provider');
            });

            await expect(chatSession.switchLLM(newConfig)).rejects.toThrow('Invalid provider');
        });

        test('should handle conversation errors from LLM service', async () => {
            await chatSession.init();

            mockLLMService.stream.mockRejectedValue(new Error('LLM service error'));

            await expect(chatSession.stream('test message')).rejects.toThrow('LLM service error');
        });
    });

    describe('Service Integration Points', () => {
        beforeEach(async () => {
            await chatSession.init();
        });

        test('should delegate conversation operations to LLM service', async () => {
            const userMessage = 'Hello, world!';
            const expectedResponse = 'Hello! How can I help you?';

            mockLLMService.stream.mockResolvedValue({ text: expectedResponse });

            const response = await chatSession.stream(userMessage);

            expect(response).toEqual({ text: expectedResponse });
            expect(mockLLMService.stream).toHaveBeenCalledWith(
                [{ type: 'text', text: userMessage }],
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
        });

        test('should delegate history operations to history provider', async () => {
            const mockHistory = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi there!' },
            ];

            mockHistoryProvider.getHistory = vi.fn().mockResolvedValue(mockHistory);

            await chatSession.init();
            const history = await chatSession.getHistory();

            expect(history).toEqual(mockHistory);
            expect(mockHistoryProvider.getHistory).toHaveBeenCalled();
        });
    });

    describe('Session Isolation', () => {
        test('should create session-specific services with proper isolation', async () => {
            await chatSession.init();

            // Verify session-specific LLM service creation with new signature
            expect(mockCreateLLMService).toHaveBeenCalledWith(
                mockLLMConfig,
                mockServices.toolManager,
                mockServices.systemPromptManager,
                mockHistoryProvider,
                chatSession.eventBus, // Session-specific event bus
                sessionId,
                mockServices.resourceManager, // ResourceManager parameter
                mockLogger, // Logger parameter
                null // compaction strategy
            );

            // Verify session-specific history provider creation
            expect(mockCreateDatabaseHistoryProvider).toHaveBeenCalledWith(
                mockDatabase,
                sessionId,
                expect.any(Object) // Logger object
            );
        });
    });

    describe('Multi-Model Token Tracking', () => {
        beforeEach(async () => {
            // Mock accumulateTokenUsage to track calls
            mockServices.sessionManager.accumulateTokenUsage = vi.fn().mockResolvedValue(undefined);
            await chatSession.init();
        });

        test('should use payload provider/model for token accumulation', async () => {
            const payloadProvider = 'anthropic';
            const payloadModel = 'claude-4-opus-20250514';

            // Emit llm:response with provider/model in payload
            chatSession.eventBus.emit('llm:response', {
                content: 'Test response',
                provider: payloadProvider,
                model: payloadModel,
                tokenUsage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                },
            });

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Should call accumulateTokenUsage with payload provider/model
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenCalledWith(
                sessionId,
                expect.objectContaining({
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                }),
                expect.any(Number), // cost
                expect.objectContaining({
                    provider: payloadProvider,
                    model: payloadModel,
                })
            );
        });

        test('should fall back to llmConfig when payload lacks provider/model', async () => {
            // Emit llm:response WITHOUT provider/model in payload
            chatSession.eventBus.emit('llm:response', {
                content: 'Test response',
                tokenUsage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                },
            });

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Should call accumulateTokenUsage with llmConfig provider/model
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenCalledWith(
                sessionId,
                expect.objectContaining({
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                }),
                expect.any(Number), // cost
                expect.objectContaining({
                    provider: mockLLMConfig.provider,
                    model: mockLLMConfig.model,
                })
            );
        });

        test('should calculate cost using payload model for accurate multi-model tracking', async () => {
            const payloadProvider = 'anthropic';
            const payloadModel = 'claude-4-opus-20250514';

            // Emit llm:response with different model than llmConfig
            chatSession.eventBus.emit('llm:response', {
                content: 'Test response',
                provider: payloadProvider,
                model: payloadModel,
                tokenUsage: {
                    inputTokens: 1000,
                    outputTokens: 500,
                    totalTokens: 1500,
                },
            });

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Should use payload model for pricing (not llmConfig)
            // This ensures correct cost attribution when switching models
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenCalledWith(
                sessionId,
                expect.any(Object),
                expect.any(Number), // Cost calculated for payload model
                expect.objectContaining({
                    provider: payloadProvider,
                    model: payloadModel,
                })
            );
        });

        test('should handle token accumulation errors gracefully', async () => {
            // Mock accumulateTokenUsage to throw error
            mockServices.sessionManager.accumulateTokenUsage = vi
                .fn()
                .mockRejectedValue(new Error('Storage error'));

            // Emit llm:response
            chatSession.eventBus.emit('llm:response', {
                content: 'Test response',
                tokenUsage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                },
            });

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Should log warning but not throw (fire-and-forget pattern)
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to accumulate token usage')
            );
        });

        test('should not accumulate tokens when tokenUsage is missing', async () => {
            // Emit llm:response without tokenUsage
            chatSession.eventBus.emit('llm:response', {
                content: 'Test response',
            });

            // Wait for async handler
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Should NOT call accumulateTokenUsage
            expect(mockServices.sessionManager.accumulateTokenUsage).not.toHaveBeenCalled();
        });

        test('should handle multiple models in same session', async () => {
            // First model: OpenAI GPT-4
            chatSession.eventBus.emit('llm:response', {
                content: 'Response from GPT-4',
                provider: 'openai',
                model: 'gpt-4',
                tokenUsage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                },
            });

            await new Promise((resolve) => setTimeout(resolve, 0));

            // Second model: Anthropic Claude
            chatSession.eventBus.emit('llm:response', {
                content: 'Response from Claude',
                provider: 'anthropic',
                model: 'claude-4-opus-20250514',
                tokenUsage: {
                    inputTokens: 200,
                    outputTokens: 100,
                    totalTokens: 300,
                },
            });

            await new Promise((resolve) => setTimeout(resolve, 0));

            // Third model: Back to OpenAI
            chatSession.eventBus.emit('llm:response', {
                content: 'Another response from GPT-4',
                provider: 'openai',
                model: 'gpt-4',
                tokenUsage: {
                    inputTokens: 50,
                    outputTokens: 25,
                    totalTokens: 75,
                },
            });

            await new Promise((resolve) => setTimeout(resolve, 0));

            // Should have been called 3 times with correct models
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenCalledTimes(3);

            // First call: OpenAI
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenNthCalledWith(
                1,
                sessionId,
                expect.objectContaining({
                    inputTokens: 100,
                    outputTokens: 50,
                }),
                expect.any(Number),
                expect.objectContaining({
                    provider: 'openai',
                    model: 'gpt-4',
                })
            );

            // Second call: Anthropic
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenNthCalledWith(
                2,
                sessionId,
                expect.objectContaining({
                    inputTokens: 200,
                    outputTokens: 100,
                }),
                expect.any(Number),
                expect.objectContaining({
                    provider: 'anthropic',
                    model: 'claude-4-opus-20250514',
                })
            );

            // Third call: OpenAI again
            expect(mockServices.sessionManager.accumulateTokenUsage).toHaveBeenNthCalledWith(
                3,
                sessionId,
                expect.objectContaining({
                    inputTokens: 50,
                    outputTokens: 25,
                }),
                expect.any(Number),
                expect.objectContaining({
                    provider: 'openai',
                    model: 'gpt-4',
                })
            );
        });
    });
});
