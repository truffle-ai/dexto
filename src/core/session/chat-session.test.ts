import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatSession } from './chat-session.js';
import { type ValidatedLLMConfig } from '@core/llm/schemas.js';
import { LLMConfigSchema } from '@core/llm/schemas.js';

// Mock all dependencies
vi.mock('./history/factory.js', () => ({
    createDatabaseHistoryProvider: vi.fn(),
}));
vi.mock('../context/factory.js', () => ({
    createContextManager: vi.fn(),
}));
vi.mock('../llm/services/factory.js', () => ({
    createLLMService: vi.fn(),
}));
vi.mock('../llm/tokenizer/factory.js', () => ({
    createTokenizer: vi.fn(),
}));
vi.mock('../llm/formatters/factory.js', () => ({
    createMessageFormatter: vi.fn(),
}));
vi.mock('../llm/registry.js', async (importOriginal) => {
    const actual = (await importOriginal()) as typeof import('../llm/registry.js');
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
import { createContextManager } from '../context/factory.js';
import { createLLMService } from '../llm/services/factory.js';
import { createTokenizer } from '../llm/tokenizer/factory.js';
import { createMessageFormatter } from '../llm/formatters/factory.js';
import { getEffectiveMaxInputTokens } from '../llm/registry.js';

const mockCreateDatabaseHistoryProvider = vi.mocked(createDatabaseHistoryProvider);
const mockCreateContextManager = vi.mocked(createContextManager);
const mockCreateLLMService = vi.mocked(createLLMService);
const mockCreateTokenizer = vi.mocked(createTokenizer);
const mockCreateFormatter = vi.mocked(createMessageFormatter);
const mockGetEffectiveMaxInputTokens = vi.mocked(getEffectiveMaxInputTokens);

describe('ChatSession', () => {
    let chatSession: ChatSession;
    let mockServices: any;
    let mockHistoryProvider: any;
    let mockContextManager: any;
    let mockLLMService: any;
    let mockTokenizer: any;
    let mockFormatter: any;

    const sessionId = 'test-session-123';
    const mockLLMConfig = LLMConfigSchema.parse({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
        router: 'in-built',
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

        // Mock message manager
        mockContextManager = {
            addUserMessage: vi.fn(),
            processLLMResponse: vi.fn(),
            getHistory: vi.fn().mockResolvedValue([]),
            clearHistory: vi.fn().mockResolvedValue(undefined),
            resetConversation: vi.fn().mockResolvedValue(undefined),
            updateConfig: vi.fn(),
            getMessageCount: vi.fn().mockReturnValue(0),
            getTokenCount: vi.fn().mockResolvedValue(100),
            switchLLM: vi.fn().mockResolvedValue(undefined),
        };

        // Mock LLM service
        mockLLMService = {
            completeTask: vi.fn().mockResolvedValue('Mock response'),
            switchLLM: vi.fn().mockResolvedValue(undefined),
            eventBus: {
                emit: vi.fn(),
                on: vi.fn(),
                off: vi.fn(),
            },
        };

        // Mock tokenizer and formatter
        mockTokenizer = { encode: vi.fn(), decode: vi.fn() };
        mockFormatter = { format: vi.fn() };

        // Mock storage manager - should match StorageBackends interface
        const mockStorageManager = {
            cache: {
                get: vi.fn().mockResolvedValue(null),
                set: vi.fn().mockResolvedValue(undefined),
                delete: vi.fn().mockResolvedValue(true),
                list: vi.fn().mockResolvedValue([]),
                clear: vi.fn().mockResolvedValue(undefined),
                connect: vi.fn().mockResolvedValue(undefined),
                disconnect: vi.fn().mockResolvedValue(undefined),
                isConnected: vi.fn().mockReturnValue(true),
                getBackendType: vi.fn().mockReturnValue('memory'),
            },
            database: {
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
            },
        };

        // Mock services
        mockServices = {
            stateManager: {
                getLLMConfig: vi.fn().mockReturnValue(mockLLMConfig),
                updateLLM: vi.fn().mockReturnValue({ isValid: true, errors: [], warnings: [] }),
            },
            promptManager: {
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
            storage: mockStorageManager,
        };

        // Set up factory mocks
        mockCreateDatabaseHistoryProvider.mockReturnValue(mockHistoryProvider);
        mockCreateContextManager.mockReturnValue(mockContextManager);
        mockCreateLLMService.mockReturnValue(mockLLMService);
        mockCreateTokenizer.mockReturnValue(mockTokenizer);
        mockCreateFormatter.mockReturnValue(mockFormatter);
        mockGetEffectiveMaxInputTokens.mockReturnValue(128000);

        // Create ChatSession instance
        chatSession = new ChatSession(mockServices, sessionId);
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

            // Verify createDatabaseHistoryProvider is called with the database backend and sessionId
            expect(mockCreateDatabaseHistoryProvider).toHaveBeenCalledWith(
                mockServices.storage.database,
                sessionId
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
            chatSession.eventBus.emit('llmservice:thinking', { status: 'processing' });

            expect(mockServices.agentEventBus.emit).toHaveBeenCalledWith(
                'llmservice:thinking',
                expect.objectContaining({
                    sessionId,
                    status: 'processing',
                })
            );
        });

        test('should handle events with no payload by adding session context', async () => {
            await chatSession.init();

            // Emit event without payload (using llmservice:thinking as example)
            chatSession.eventBus.emit('llmservice:thinking');

            expect(mockServices.agentEventBus.emit).toHaveBeenCalledWith('llmservice:thinking', {
                sessionId,
            });
        });

        test('should emit dexto:conversationReset event when conversation is reset', async () => {
            await chatSession.init();

            await chatSession.reset();

            // Should call resetConversation on message manager
            expect(mockContextManager.resetConversation).toHaveBeenCalled();

            // Should emit dexto:conversationReset event with session context
            expect(mockServices.agentEventBus.emit).toHaveBeenCalledWith(
                'dexto:conversationReset',
                { sessionId }
            );
        });
    });

    describe('LLM Configuration Management', () => {
        beforeEach(async () => {
            await chatSession.init();
        });

        test('should optimize LLM switching by only creating new components when necessary', async () => {
            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                maxInputTokens: 256000, // Only change maxInputTokens
            };

            await chatSession.switchLLM(newConfig);

            // Should call updateConfig with effective maxInputTokens (from getEffectiveMaxInputTokens mock)
            expect(mockContextManager.updateConfig).toHaveBeenCalledWith(
                128000, // effective maxInputTokens (mocked return value)
                undefined, // newTokenizer (no provider change)
                undefined // newFormatter (no router change)
            );
        });

        test('should create new tokenizer when provider changes', async () => {
            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'anthropic',
                model: 'claude-3-opus',
            };

            await chatSession.switchLLM(newConfig);

            expect(mockCreateTokenizer).toHaveBeenCalledWith('anthropic', 'claude-3-opus');
        });

        test('should create new formatter when router changes', async () => {
            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                router: 'vercel',
            };

            await chatSession.switchLLM(newConfig);

            expect(mockCreateFormatter).toHaveBeenCalledWith('openai', 'vercel');
        });

        test('should update message manager configuration during LLM switch', async () => {
            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'anthropic',
                model: 'claude-3-opus',
            };

            await chatSession.switchLLM(newConfig);

            expect(mockContextManager.updateConfig).toHaveBeenCalledWith(
                128000, // newMaxInputTokens
                expect.any(Object), // newTokenizer
                expect.any(Object) // newFormatter
            );
        });

        test('should emit LLM switched event with correct metadata', async () => {
            const newConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'anthropic',
                model: 'claude-3-opus',
            };

            const eventSpy = vi.spyOn(chatSession.eventBus, 'emit');

            await chatSession.switchLLM(newConfig);

            expect(eventSpy).toHaveBeenCalledWith(
                'llmservice:switched',
                expect.objectContaining({
                    newConfig,
                    router: newConfig.router,
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

        test('should handle message manager creation failures', async () => {
            mockCreateContextManager.mockImplementation(() => {
                throw new Error('Message manager creation failed');
            });

            await expect(chatSession.init()).rejects.toThrow('Message manager creation failed');
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

            mockLLMService.completeTask.mockRejectedValue(new Error('LLM service error'));

            await expect(chatSession.run('test message')).rejects.toThrow('LLM service error');
        });
    });

    describe('Service Integration Points', () => {
        beforeEach(async () => {
            await chatSession.init();
        });

        test('should delegate conversation operations to LLM service', async () => {
            const userMessage = 'Hello, world!';
            const expectedResponse = 'Hello! How can I help you?';

            mockLLMService.completeTask.mockResolvedValue(expectedResponse);

            const response = await chatSession.run(userMessage);

            expect(response).toBe(expectedResponse);
            expect(mockLLMService.completeTask).toHaveBeenCalledWith(
                userMessage,
                undefined,
                undefined,
                undefined
            );
        });

        test('should delegate history operations to message manager', async () => {
            const mockHistory = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi there!' },
            ];

            mockContextManager.getHistory.mockResolvedValue(mockHistory);

            const history = await chatSession.getHistory();

            expect(history).toEqual(mockHistory);
            expect(mockContextManager.getHistory).toHaveBeenCalled();
        });
    });

    describe('Session Isolation', () => {
        test('should create session-specific services with proper isolation', async () => {
            await chatSession.init();

            // Verify session-specific message manager creation
            expect(mockCreateContextManager).toHaveBeenCalledWith(
                mockLLMConfig,
                mockLLMConfig.router,
                mockServices.promptManager,
                chatSession.eventBus, // Session-specific event bus
                mockHistoryProvider,
                sessionId
            );

            // Verify session-specific LLM service creation
            expect(mockCreateLLMService).toHaveBeenCalledWith(
                mockLLMConfig,
                mockLLMConfig.router,
                mockServices.toolManager,
                chatSession.eventBus, // Session-specific event bus
                mockContextManager,
                sessionId
            );

            // Verify session-specific history provider creation
            expect(mockCreateDatabaseHistoryProvider).toHaveBeenCalledWith(
                mockServices.storage.database,
                sessionId
            );
        });
    });
});
