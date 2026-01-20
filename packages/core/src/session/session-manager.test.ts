import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from './session-manager.js';
import { ChatSession } from './chat-session.js';
import { type ValidatedLLMConfig } from '@core/llm/schemas.js';
import { LLMConfigSchema } from '@core/llm/schemas.js';
import { StorageSchema } from '@core/storage/schemas.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { SessionErrorCode } from './error-codes.js';
import { createMockLogger } from '@core/logger/v2/test-utils.js';

// Mock dependencies
vi.mock('./chat-session.js');
vi.mock('../logger/index.js', () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    },
}));
vi.mock('crypto', () => ({
    randomUUID: vi.fn(() => 'mock-uuid-123'),
}));

const MockChatSession = vi.mocked(ChatSession);

describe('SessionManager', () => {
    let sessionManager: SessionManager;
    let mockServices: any;
    let mockStorageManager: any;
    let mockLLMConfig: ValidatedLLMConfig;
    const mockLogger = createMockLogger();

    const mockSessionData = {
        id: 'test-session',
        createdAt: new Date('2024-01-01T00:00:00Z').getTime(),
        lastActivity: new Date('2024-01-01T01:00:00Z').getTime(),
        messageCount: 5,
    };

    beforeEach(() => {
        vi.resetAllMocks();

        // Mock storage manager with proper getter structure
        const mockCache = {
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

        const mockDatabase = {
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

        const mockBlobStore = {
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

        mockStorageManager = {
            getCache: vi.fn().mockReturnValue(mockCache),
            getDatabase: vi.fn().mockReturnValue(mockDatabase),
            getBlobStore: vi.fn().mockReturnValue(mockBlobStore),
            disconnect: vi.fn().mockResolvedValue(undefined),
            // Also expose direct references for test assertions
            cache: mockCache,
            database: mockDatabase,
            blobStore: mockBlobStore,
        };

        // Mock services
        mockServices = {
            stateManager: {
                getLLMConfig: vi.fn().mockReturnValue(mockLLMConfig),
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
            },
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
        };

        // Parse LLM config now that mocks are set up
        mockLLMConfig = LLMConfigSchema.parse({
            provider: 'openai',
            model: 'gpt-5',
            apiKey: 'test-key',
            maxIterations: 50,
            maxInputTokens: 128000,
        });

        // Create SessionManager instance
        sessionManager = new SessionManager(
            mockServices,
            {
                maxSessions: 10,
                sessionTTL: 1800000, // 30 minutes
            },
            mockLogger
        );

        // Mock ChatSession constructor and methods
        MockChatSession.mockImplementation((services, id, _logger) => {
            const mockSession = {
                id,
                init: vi.fn().mockResolvedValue(undefined),
                run: vi.fn().mockResolvedValue('Mock response'),
                reset: vi.fn().mockResolvedValue(undefined),
                dispose: vi.fn(),
                cleanup: vi.fn().mockImplementation(async () => {
                    // Simulate the new cleanup behavior - only call dispose, not reset
                    mockSession.dispose();
                }),
                switchLLM: vi.fn().mockResolvedValue(undefined),
                getHistory: vi.fn().mockResolvedValue([]),
                getContextManager: vi.fn(),
                getLLMService: vi.fn(),
                eventBus: {
                    emit: vi.fn(),
                    on: vi.fn(),
                    off: vi.fn(),
                },
            };
            return mockSession as any;
        });
    });

    afterEach(async () => {
        if (sessionManager) {
            await sessionManager.cleanup();
        }
    });

    describe('Session Lifecycle Management', () => {
        test('should support flexible initialization options', () => {
            const defaultManager = new SessionManager(mockServices, {}, mockLogger);
            const customManager = new SessionManager(
                mockServices,
                {
                    maxSessions: 50,
                    sessionTTL: 7200000, // 2 hours
                },
                mockLogger
            );

            expect(defaultManager).toBeDefined();
            expect(customManager).toBeDefined();
        });

        test('should initialize storage layer on first use', async () => {
            await sessionManager.init();

            // Verify database.list is called to find existing sessions
            expect(mockStorageManager.database.list).toHaveBeenCalledWith('session:');
        });

        test('should prevent duplicate initialization', async () => {
            await sessionManager.init();
            await sessionManager.init(); // Second call

            // Should only call database.list once since it's already initialized
            expect(mockStorageManager.database.list).toHaveBeenCalledTimes(1);
        });

        test('should restore valid sessions from persistent storage on startup', async () => {
            const existingSessionIds = ['session-1', 'session-2'];
            const existingSessionKeys = ['session:session-1', 'session:session-2'];
            const validMetadata = {
                ...mockSessionData,
                lastActivity: new Date().getTime(), // Recent activity
            };

            mockStorageManager.database.list.mockResolvedValue(existingSessionKeys);
            mockStorageManager.database.get.mockResolvedValue(validMetadata);

            await sessionManager.init();

            expect(mockStorageManager.database.list).toHaveBeenCalledWith('session:');
            expect(mockStorageManager.database.get).toHaveBeenCalledTimes(
                existingSessionIds.length
            );
        });

        test('should clean up expired sessions during startup restoration', async () => {
            const existingSessionKeys = ['session:expired-session'];
            const expiredMetadata = {
                ...mockSessionData,
                lastActivity: new Date(Date.now() - 7200000).getTime(), // 2 hours ago
            };

            mockStorageManager.database.list.mockResolvedValue(existingSessionKeys);
            mockStorageManager.database.get.mockResolvedValue(expiredMetadata);

            await sessionManager.init();

            expect(mockStorageManager.database.delete).toHaveBeenCalledWith(
                'session:expired-session'
            );
        });
    });

    describe('Session Creation and Identity Management', () => {
        beforeEach(async () => {
            await sessionManager.init();
        });

        test('should create sessions with auto-generated IDs when none provided', async () => {
            const session = await sessionManager.createSession();

            expect(session).toBeDefined();
            expect(session.id).toBe('mock-uuid-123');
            expect(MockChatSession).toHaveBeenCalledWith(
                expect.objectContaining({ ...mockServices, sessionManager: expect.anything() }),
                'mock-uuid-123',
                mockLogger
            );
        });

        test('should create sessions with custom IDs when provided', async () => {
            const customId = 'custom-session-id';
            const session = await sessionManager.createSession(customId);

            expect(session.id).toBe(customId);
            expect(MockChatSession).toHaveBeenCalledWith(
                expect.objectContaining({ ...mockServices, sessionManager: expect.anything() }),
                customId,
                mockLogger
            );
        });

        test('should return existing session instance for duplicate creation requests', async () => {
            const sessionId = 'existing-session';

            const session1 = await sessionManager.createSession(sessionId);
            const session2 = await sessionManager.createSession(sessionId);

            // Both should have the same ID (testing the actual behavior)
            expect(session1.id).toBe(session2.id);
            expect(session1.id).toBe(sessionId);
            expect(session2.id).toBe(sessionId);
        });

        test('should restore sessions from storage when not in memory', async () => {
            const sessionId = 'stored-session';

            mockStorageManager.database.get.mockResolvedValue(mockSessionData);

            const session = await sessionManager.createSession(sessionId);

            expect(session.id).toBe(sessionId);
            expect(mockStorageManager.database.get).toHaveBeenCalledWith(`session:${sessionId}`);
        });
    });

    describe('Session Limits and Resource Management', () => {
        test('should enforce maximum session limits', async () => {
            const maxSessions = 2;
            const limitedManager = new SessionManager(mockServices, { maxSessions }, mockLogger);
            await limitedManager.init();

            // Mock that we already have max sessions
            mockStorageManager.database.list.mockResolvedValue([
                'session:session-1',
                'session:session-2',
            ]);

            await expect(limitedManager.createSession()).rejects.toMatchObject({
                code: SessionErrorCode.SESSION_MAX_SESSIONS_EXCEEDED,
                scope: ErrorScope.SESSION,
                type: ErrorType.USER,
            });
        });

        test('should clean up expired sessions before enforcing limits', async () => {
            await sessionManager.init();

            // Mock expired session that should be cleaned up
            mockStorageManager.database.list.mockResolvedValue(['session:expired-session']);

            const session = await sessionManager.createSession();

            expect(session).toBeDefined();
            // Should not throw max sessions error because expired session was cleaned up
        });

        test('should provide session statistics for monitoring', async () => {
            await sessionManager.init();

            const activeSessionIds = ['session:session-1', 'session:session-2'];
            mockStorageManager.database.list.mockResolvedValue(activeSessionIds);

            // Create one session in memory
            await sessionManager.createSession('session-1');

            const stats = await sessionManager.getSessionStats();

            expect(stats).toEqual({
                totalSessions: 2,
                inMemorySessions: 1,
                maxSessions: 10,
                sessionTTL: 1800000,
            });
        });
    });

    describe('Session Retrieval and Access Patterns', () => {
        beforeEach(async () => {
            await sessionManager.init();
        });

        test('should retrieve existing sessions from memory efficiently', async () => {
            const sessionId = 'test-session';

            // Create session first
            await sessionManager.createSession(sessionId);

            // Get session
            const session = await sessionManager.getSession(sessionId);

            expect(session).toBeDefined();
            expect(session!.id).toBe(sessionId);
        });

        test('should restore sessions from storage when not in memory', async () => {
            const sessionId = 'stored-session';

            mockStorageManager.database.get.mockResolvedValue(mockSessionData);

            const session = await sessionManager.getSession(sessionId);

            expect(session).toBeDefined();
            expect(session!.id).toBe(sessionId);
            expect(mockStorageManager.database.get).toHaveBeenCalledWith(`session:${sessionId}`);
        });

        test('should return undefined for non-existent sessions', async () => {
            const result = await sessionManager.getSession('non-existent');
            expect(result).toBeUndefined();
        });

        test('should update session activity timestamps on access', async () => {
            const sessionId = 'test-session';

            // Create the session first so it exists in storage
            await sessionManager.createSession(sessionId);

            // Reset the mock to clear the creation calls
            mockStorageManager.database.set.mockClear();
            mockStorageManager.database.get.mockResolvedValue(mockSessionData);

            // Call incrementMessageCount which should update activity
            await sessionManager.incrementMessageCount(sessionId);

            expect(mockStorageManager.database.set).toHaveBeenCalledWith(
                `session:${sessionId}`,
                expect.objectContaining({
                    lastActivity: expect.any(Number),
                })
            );
        });
    });

    describe('Session Metadata and Activity Tracking', () => {
        beforeEach(async () => {
            await sessionManager.init();
        });

        test('should track and persist session metadata', async () => {
            const session = await sessionManager.createSession();

            expect(mockStorageManager.database.set).toHaveBeenCalledWith(
                `session:${session.id}`,
                expect.objectContaining({
                    createdAt: expect.any(Number),
                    lastActivity: expect.any(Number),
                    messageCount: 0,
                })
            );
        });

        test('should increment message counts and update activity', async () => {
            const sessionId = 'test-session';

            mockStorageManager.database.get.mockResolvedValue({ ...mockSessionData });

            await sessionManager.incrementMessageCount(sessionId);

            expect(mockStorageManager.database.set).toHaveBeenCalledWith(
                `session:${sessionId}`,
                expect.objectContaining({
                    messageCount: mockSessionData.messageCount + 1,
                    lastActivity: expect.any(Number),
                })
            );
        });

        test('should provide access to session metadata', async () => {
            const sessionId = 'test-session';

            mockStorageManager.database.get.mockResolvedValue(mockSessionData);

            const metadata = await sessionManager.getSessionMetadata(sessionId);

            expect(metadata).toEqual({
                createdAt: mockSessionData.createdAt,
                lastActivity: mockSessionData.lastActivity,
                messageCount: mockSessionData.messageCount,
            });
            expect(mockStorageManager.database.get).toHaveBeenCalledWith(`session:${sessionId}`);
        });

        test('should provide access to global configuration', async () => {
            const config = sessionManager.getConfig();

            expect(config).toEqual({
                maxSessions: 10,
                sessionTTL: 1800000,
            });
        });

        test('should list all active sessions', async () => {
            const activeSessionKeys = [
                'session:session-1',
                'session:session-2',
                'session:session-3',
            ];
            const expectedSessionIds = ['session-1', 'session-2', 'session-3'];
            mockStorageManager.database.list.mockResolvedValue(activeSessionKeys);

            const sessions = await sessionManager.listSessions();

            expect(sessions).toEqual(expectedSessionIds);
            expect(mockStorageManager.database.list).toHaveBeenCalledWith('session:');
        });
    });

    describe('Session Termination and Cleanup', () => {
        beforeEach(async () => {
            await sessionManager.init();
        });

        test('should properly end sessions and clean up resources', async () => {
            const sessionId = 'test-session';

            // Create session first
            const session = await sessionManager.createSession(sessionId);

            // Delete session
            await sessionManager.deleteSession(sessionId);

            expect(session.cleanup).toHaveBeenCalled();
            expect(mockStorageManager.database.delete).toHaveBeenCalledWith(`session:${sessionId}`);
        });

        test('should handle deleting non-existent sessions gracefully', async () => {
            await expect(sessionManager.deleteSession('non-existent')).resolves.not.toThrow();
            expect(mockStorageManager.database.delete).toHaveBeenCalledWith('session:non-existent');
        });

        test('should cleanup all sessions during shutdown', async () => {
            // Create multiple sessions
            const sessions = [
                await sessionManager.createSession('session-1'),
                await sessionManager.createSession('session-2'),
                await sessionManager.createSession('session-3'),
            ];

            // Cleanup all sessions
            await sessionManager.cleanup();

            // Verify all sessions were cleaned up
            for (const session of sessions) {
                expect(session.cleanup).toHaveBeenCalled();
            }
        });

        test('should handle cleanup errors gracefully', async () => {
            const sessionId = 'error-session';

            // Create session
            const session = await sessionManager.createSession(sessionId);

            // Mock error during cleanup (SessionManager.cleanup -> endSession -> session.cleanup)
            (session.cleanup as any).mockRejectedValue(new Error('Cleanup error'));

            await expect(sessionManager.cleanup()).resolves.not.toThrow();
        });
    });

    describe('LLM Configuration Management Across Sessions', () => {
        beforeEach(async () => {
            await sessionManager.init();
        });

        test('should switch LLM for specific session', async () => {
            const sessionId = 'test-session';
            const newLLMConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'anthropic',
                model: 'claude-4-opus-20250514',
            };

            // Create session first
            await sessionManager.createSession(sessionId);

            const result = await sessionManager.switchLLMForSpecificSession(
                newLLMConfig,
                sessionId
            );

            expect(result.message).toContain(
                `Successfully switched to anthropic/claude-4-opus-20250514 for session ${sessionId}`
            );
            expect(result.warnings).toEqual([]);
        });

        test('should handle LLM switch for non-existent session', async () => {
            const newLLMConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'anthropic',
                model: 'claude-4-opus-20250514',
            };

            await expect(
                sessionManager.switchLLMForSpecificSession(newLLMConfig, 'non-existent')
            ).rejects.toMatchObject({
                code: SessionErrorCode.SESSION_NOT_FOUND,
                scope: ErrorScope.SESSION,
                type: ErrorType.NOT_FOUND,
            });
        });

        test('should handle partial failures when switching LLM for all sessions', async () => {
            const sessionIds = ['session:session-1', 'session:session-2'];
            const newLLMConfig: ValidatedLLMConfig = {
                ...mockLLMConfig,
                provider: 'anthropic',
                model: 'claude-4-opus-20250514',
            };

            mockStorageManager.database.list.mockResolvedValue(sessionIds);

            // Mock runtime failure for one session (e.g., session corruption, disposal, etc.)
            mockServices.stateManager.updateLLM.mockImplementation(
                (config: any, sessionId: string) => {
                    if (sessionId === 'session-2') {
                        throw new Error('Session state corruption detected');
                    }
                    // Normal case - returns void (no return needed)
                }
            );

            // Create sessions
            for (const sessionKey of sessionIds) {
                const sessionId = sessionKey.replace('session:', '');
                await sessionManager.createSession(sessionId);
            }

            const result = await sessionManager.switchLLMForAllSessions(newLLMConfig);

            expect(result.message).toContain('1 sessions failed');
            expect(result.warnings).toContain('Failed to switch LLM for sessions: session-2');
        });
    });

    describe('Error Handling and Resilience', () => {
        test('should handle storage initialization failures', async () => {
            mockStorageManager.database.list.mockRejectedValue(
                new Error('Storage initialization failed')
            );

            // init() should not throw - it catches and logs errors
            await expect(sessionManager.init()).resolves.toBeUndefined();
        });

        test('should handle storage operation failures gracefully', async () => {
            await sessionManager.init();

            mockStorageManager.database.set.mockRejectedValue(new Error('Storage write failed'));

            // Should still create session in memory despite storage failure
            await expect(sessionManager.createSession()).rejects.toThrow('Storage write failed');
        });

        test('should handle session restoration errors during startup', async () => {
            mockStorageManager.database.list.mockResolvedValue(['session:session-1']);
            mockStorageManager.database.get.mockRejectedValue(new Error('Storage read failed'));

            // Should not throw during initialization
            await expect(sessionManager.init()).resolves.not.toThrow();
        });

        test('should handle cleanup errors during expired session removal', async () => {
            await sessionManager.init();

            const sessionId = 'test-session';
            const session = await sessionManager.createSession(sessionId);

            // Mock cleanup error
            (session.reset as any).mockRejectedValue(new Error('Reset failed'));

            // Mock that session is expired
            mockStorageManager.database.list.mockResolvedValue([]);

            // Should handle error gracefully during cleanup
            await expect(sessionManager.createSession('new-session')).resolves.toBeDefined();
        });
    });

    describe('Concurrency and Edge Cases', () => {
        beforeEach(async () => {
            await sessionManager.init();
        });

        test('should handle concurrent session creation requests safely', async () => {
            const sessionId = 'concurrent-session';

            // Create multiple promises for the same session
            const promises = [
                sessionManager.createSession(sessionId),
                sessionManager.createSession(sessionId),
                sessionManager.createSession(sessionId),
            ];

            const sessions = await Promise.all(promises);

            // All should have the same session ID
            expect(sessions[0]?.id).toBe(sessions[1]?.id);
            expect(sessions[1]?.id).toBe(sessions[2]?.id);
            expect(sessions[0]?.id).toBe(sessionId);

            // Verify all sessions are properly created
            expect(sessions[0]).toBeDefined();
            expect(sessions[1]).toBeDefined();
            expect(sessions[2]).toBeDefined();
        });

        test('should prevent race conditions when creating multiple different sessions concurrently', async () => {
            // Set a low session limit to test the race condition prevention
            const limitedSessionManager = new SessionManager(
                mockServices,
                {
                    maxSessions: 2,
                    sessionTTL: 1800000, // 30 minutes
                },
                mockLogger
            );
            await limitedSessionManager.init();

            // Create 2 sessions sequentially first to reach the limit
            await limitedSessionManager.createSession('existing-1');
            await limitedSessionManager.createSession('existing-2');

            // Mock the database.list to return the existing sessions
            mockStorageManager.database.list.mockResolvedValue([
                'session:existing-1',
                'session:existing-2',
            ]);

            // Now try to create 4 more sessions concurrently - all should fail
            const promises = [
                limitedSessionManager.createSession('session-1'),
                limitedSessionManager.createSession('session-2'),
                limitedSessionManager.createSession('session-3'),
                limitedSessionManager.createSession('session-4'),
            ];

            const results = await Promise.allSettled(promises);

            // Count successful and failed creations
            const successes = results.filter((result) => result.status === 'fulfilled');
            const failures = results.filter((result) => result.status === 'rejected');

            // All should fail due to the limit since we're at capacity
            expect(failures.length).toBe(4);
            expect(successes.length).toBe(0);

            // All failures should be due to session limit
            failures.forEach((failure) => {
                const err = (failure as PromiseRejectedResult).reason as any;
                expect(err.code).toBe(SessionErrorCode.SESSION_MAX_SESSIONS_EXCEEDED);
                expect(err.scope).toBe(ErrorScope.SESSION);
                expect(err.type).toBe(ErrorType.USER);
            });

            // Clean up
            await limitedSessionManager.cleanup();
        });

        test('should handle legacy session metadata without TTL fields', async () => {
            const sessionId = 'legacy-session';
            const legacyMetadata = {
                createdAt: new Date().getTime(),
                lastActivity: new Date().getTime(),
                messageCount: 0,
                // Missing maxSessions and sessionTTL
            };

            mockStorageManager.database.get.mockResolvedValue(legacyMetadata);

            const session = await sessionManager.getSession(sessionId);

            expect(session).toBeDefined();
            expect(session!.id).toBe(sessionId);
        });

        test('should handle empty session lists gracefully', async () => {
            mockStorageManager.database.list.mockResolvedValue([]);

            const sessions = await sessionManager.listSessions();

            expect(sessions).toEqual([]);
        });

        test('should continue operating when storage is temporarily unavailable', async () => {
            mockStorageManager.database.set.mockRejectedValue(new Error('Storage unavailable'));

            // Should throw error since storage is required for session persistence
            await expect(sessionManager.createSession()).rejects.toThrow('Storage unavailable');
        });

        test('should clean up expired in-memory sessions automatically', async () => {
            const sessionId = 'test-session';

            // Create session
            await sessionManager.createSession(sessionId);

            // Mock that session is no longer in storage (expired)
            mockStorageManager.database.list.mockResolvedValue([]);

            // Trigger cleanup by creating another session
            await sessionManager.createSession('new-session');

            // The expired session should have been cleaned up from memory
            // This is tested indirectly through the cleanup process
        });
    });

    describe('Periodic Cleanup', () => {
        test('should start periodic cleanup timer during initialization', async () => {
            const setIntervalSpy = vi.spyOn(global, 'setInterval');

            await sessionManager.init();

            expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));

            // Verify the interval is calculated correctly (min of TTL/4 or 15 minutes)
            // Test setup uses 30 minutes TTL, so TTL/4 = 7.5 minutes = 450000ms
            const expectedInterval = Math.min(1800000 / 4, 15 * 60 * 1000); // 7.5 minutes since TTL/4 < 15 minutes
            expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), expectedInterval);

            setIntervalSpy.mockRestore();
        });

        test('should stop periodic cleanup timer during cleanup', async () => {
            const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

            await sessionManager.init();
            await sessionManager.cleanup();

            expect(clearIntervalSpy).toHaveBeenCalled();
            clearIntervalSpy.mockRestore();
        });

        test('should handle periodic cleanup errors gracefully', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const setIntervalSpy = vi.spyOn(global, 'setInterval');
            mockStorageManager.database.list.mockRejectedValue(new Error('Storage error'));

            await sessionManager.init();

            // Access the interval function and call it directly to test error handling
            const setIntervalCall = setIntervalSpy.mock.calls[0];
            const cleanupFunction = setIntervalCall?.[0] as () => Promise<void>;

            // This should not throw
            await expect(cleanupFunction()).resolves.toBeUndefined();

            consoleSpy.mockRestore();
            setIntervalSpy.mockRestore();
        });

        test('should use correct cleanup interval based on session TTL', async () => {
            // Create SessionManager with different TTL
            const shortTTLSessionManager = new SessionManager(
                mockServices,
                {
                    sessionTTL: 60000, // 1 minute
                },
                mockLogger
            );

            const setIntervalSpy = vi.spyOn(global, 'setInterval');

            await shortTTLSessionManager.init();

            // Should use TTL/4 (15 seconds) since it's less than 15 minutes
            const expectedInterval = Math.min(60000 / 4, 15 * 60 * 1000);
            expect(expectedInterval).toBe(15000); // 15 seconds
            expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15000);

            setIntervalSpy.mockRestore();
            await shortTTLSessionManager.cleanup();
        });
    });

    describe('Chat History Preservation', () => {
        beforeEach(async () => {
            await sessionManager.init();
        });

        test('should preserve chat history when session expires from memory', async () => {
            const sessionId = 'test-session-history';

            // Create session and simulate it has messages
            const session = await sessionManager.createSession(sessionId);
            expect(session).toBeDefined();

            // Mock that session has been inactive for longer than TTL
            const sessionKey = `session:${sessionId}`;
            const expiredSessionData = {
                id: sessionId,
                createdAt: Date.now() - 7200000, // 2 hours ago
                lastActivity: Date.now() - 7200000, // 2 hours ago (expired)
                messageCount: 5,
            };
            mockStorageManager.database.get.mockResolvedValue(expiredSessionData);

            // Trigger cleanup - should remove from memory but preserve storage
            await sessionManager['cleanupExpiredSessions']();

            // Session should be removed from memory
            expect(sessionManager['sessions'].has(sessionId)).toBe(false);

            // But session should still exist in storage (not deleted)
            expect(mockStorageManager.database.delete).not.toHaveBeenCalledWith(sessionKey);

            // Chat history should still be accessible through DatabaseHistoryProvider
            // (The actual history is stored separately from session metadata)
        });

        test('should restore session from storage with chat history intact', async () => {
            const sessionId = 'restored-session';

            // Mock that session exists in storage but not in memory
            const storedSessionData = {
                id: sessionId,
                createdAt: Date.now() - 3600000, // 1 hour ago
                lastActivity: Date.now() - 1800000, // 30 minutes ago
                messageCount: 10,
            };
            mockStorageManager.database.get.mockResolvedValue(storedSessionData);

            // Get session - should restore from storage
            const restoredSession = await sessionManager.getSession(sessionId);

            expect(restoredSession).toBeDefined();
            expect(restoredSession!.id).toBe(sessionId);
            expect(MockChatSession).toHaveBeenCalledWith(
                expect.objectContaining({ ...mockServices, sessionManager: expect.anything() }),
                sessionId,
                mockLogger
            );

            // Session should now be in memory
            expect(sessionManager['sessions'].has(sessionId)).toBe(true);
        });

        test('should only call dispose() during cleanup, not reset()', async () => {
            const sessionId = 'memory-only-cleanup';
            const session = await sessionManager.createSession(sessionId);

            // Spy on session methods
            const disposeSpy = vi.spyOn(session, 'dispose');
            const resetSpy = vi.spyOn(session, 'reset');

            // Manually call cleanup (simulating what happens during expiry)
            await session.cleanup();

            // Should only dispose memory resources, NOT reset conversation
            expect(disposeSpy).toHaveBeenCalled();
            expect(resetSpy).not.toHaveBeenCalled();
        });

        test('should preserve session metadata and history after memory cleanup', async () => {
            const sessionId = 'persistent-session';

            // Create session
            await sessionManager.createSession(sessionId);

            // Mock expired session data
            const expiredSessionData = {
                id: sessionId,
                createdAt: Date.now() - 7200000,
                lastActivity: Date.now() - 7200000, // Expired
                messageCount: 15,
            };
            mockStorageManager.database.get.mockResolvedValue(expiredSessionData);

            // Trigger cleanup
            await sessionManager['cleanupExpiredSessions']();

            // Session metadata should still exist in storage
            expect(mockStorageManager.database.delete).not.toHaveBeenCalledWith(
                `session:${sessionId}`
            );

            // Session should be able to be restored later
            const restoredSession = await sessionManager.getSession(sessionId);
            expect(restoredSession).toBeDefined();
            expect(restoredSession!.id).toBe(sessionId);
        });

        test('should delete conversation history and session metadata on explicit deletion', async () => {
            const sessionId = 'explicit-delete-test';
            const session = await sessionManager.createSession(sessionId);

            // Explicit deletion should remove everything including conversation history
            await sessionManager.deleteSession(sessionId);

            // Should call cleanup to dispose memory resources
            expect(session.cleanup).toHaveBeenCalled();

            // Should remove session metadata from storage completely
            expect(mockStorageManager.database.delete).toHaveBeenCalledWith(`session:${sessionId}`);
            expect(mockStorageManager.cache.delete).toHaveBeenCalledWith(`session:${sessionId}`);

            // Should delete conversation messages directly from storage
            expect(mockStorageManager.database.delete).toHaveBeenCalledWith(
                `messages:${sessionId}`
            );
        });

        test('should handle multiple expired sessions without affecting storage', async () => {
            const sessionIds = ['expired-1', 'expired-2', 'expired-3'];

            // Create multiple sessions
            for (const sessionId of sessionIds) {
                await sessionManager.createSession(sessionId);
            }

            // Mock all as expired
            mockStorageManager.database.get.mockImplementation((key: string) => {
                const sessionId = key.replace('session:', '');
                if (sessionIds.includes(sessionId)) {
                    return Promise.resolve({
                        id: sessionId,
                        createdAt: Date.now() - 7200000,
                        lastActivity: Date.now() - 7200000, // All expired
                        messageCount: 5,
                    });
                }
                return Promise.resolve(null);
            });

            // Trigger cleanup
            await sessionManager['cleanupExpiredSessions']();

            // All sessions should be removed from memory
            sessionIds.forEach((sessionId) => {
                expect(sessionManager['sessions'].has(sessionId)).toBe(false);
            });

            // But none should be deleted from storage
            sessionIds.forEach((sessionId) => {
                expect(mockStorageManager.database.delete).not.toHaveBeenCalledWith(
                    `session:${sessionId}`
                );
            });
        });
    });

    describe('End-to-End Chat History Preservation', () => {
        let realStorageBackends: any;
        let realSessionManager: SessionManager;

        beforeEach(async () => {
            // Create real storage manager for end-to-end testing
            const { createStorageManager } = await import('../storage/index.js');

            const storageConfig = StorageSchema.parse({
                cache: { type: 'in-memory' as const },
                database: { type: 'in-memory' as const },
                blob: { type: 'local', storePath: '/tmp/test-blobs' },
            });

            realStorageBackends = await createStorageManager(storageConfig, mockLogger);

            // Create SessionManager with real storage and short TTL for faster testing
            realSessionManager = new SessionManager(
                {
                    ...mockServices,
                    storageManager: realStorageBackends,
                },
                {
                    maxSessions: 10,
                    sessionTTL: 100, // 100ms for fast testing
                },
                mockLogger
            );

            await realSessionManager.init();
        });

        afterEach(async () => {
            if (realSessionManager) {
                await realSessionManager.cleanup();
            }
            if (realStorageBackends) {
                await realStorageBackends.database.disconnect();
                await realStorageBackends.cache.disconnect();
            }
        });

        test('end-to-end: chat history survives session expiry and is restored on access', async () => {
            const sessionId = 'e2e-test-session';

            // Step 1: Create session and simulate adding chat history
            const originalSession = await realSessionManager.createSession(sessionId);
            expect(originalSession).toBeDefined();

            // Simulate chat history by storing messages directly (since we're mocking ChatSession)
            const messagesKey = `messages:${sessionId}`;
            const mockChatHistory = [
                { role: 'user', content: 'Hello!' },
                { role: 'assistant', content: 'Hi there!' },
                { role: 'user', content: 'How are you?' },
                { role: 'assistant', content: 'I am doing well, thank you!' },
            ];
            await realStorageBackends.database.set(messagesKey, mockChatHistory);

            // Verify session exists in memory
            expect(realSessionManager['sessions'].has(sessionId)).toBe(true);

            // Step 2: Wait for session to expire, then trigger cleanup
            await new Promise((resolve) => setTimeout(resolve, 150)); // Wait > TTL (100ms)

            // Update session metadata to mark it as expired
            const sessionKey = `session:${sessionId}`;
            const sessionData = await realStorageBackends.database.get(sessionKey);
            if (sessionData) {
                sessionData.lastActivity = Date.now() - 200; // Mark as expired
                await realStorageBackends.database.set(sessionKey, sessionData);
            }

            // Trigger cleanup manually (simulating periodic cleanup)
            await realSessionManager['cleanupExpiredSessions']();

            // Step 3: Verify session removed from memory but preserved in storage
            expect(realSessionManager['sessions'].has(sessionId)).toBe(false);

            // Session metadata should still exist
            const preservedSessionData = await realStorageBackends.database.get(sessionKey);
            expect(preservedSessionData).toBeDefined();

            // Chat history should still exist
            const preservedHistory = await realStorageBackends.database.get(messagesKey);
            expect(preservedHistory).toEqual(mockChatHistory);

            // Step 4: Access session again - should restore from storage
            const restoredSession = await realSessionManager.getSession(sessionId);
            expect(restoredSession).toBeDefined();
            expect(restoredSession!.id).toBe(sessionId);

            // Session should be back in memory
            expect(realSessionManager['sessions'].has(sessionId)).toBe(true);

            // Chat history should still be accessible
            const finalHistory = await realStorageBackends.database.get(messagesKey);
            expect(finalHistory).toEqual(mockChatHistory);

            // Step 5: Verify new messages can be added to restored session
            await realStorageBackends.database.set(messagesKey, [
                ...mockChatHistory,
                { role: 'user', content: 'Still here!' },
            ]);

            const updatedHistory = await realStorageBackends.database.get(messagesKey);
            expect(updatedHistory).toHaveLength(5);
            expect(updatedHistory[4]).toEqual({ role: 'user', content: 'Still here!' });
        });

        test('end-to-end: explicit deletion removes everything permanently', async () => {
            const sessionId = 'e2e-delete-test';

            // Create session with chat history
            await realSessionManager.createSession(sessionId);

            const messagesKey = `messages:${sessionId}`;
            const sessionKey = `session:${sessionId}`;
            const mockHistory = [{ role: 'user', content: 'Test message' }];
            await realStorageBackends.database.set(messagesKey, mockHistory);

            // Verify everything exists
            expect(await realStorageBackends.database.get(sessionKey)).toBeDefined();
            expect(await realStorageBackends.database.get(messagesKey)).toEqual(mockHistory);

            // Explicitly delete session
            await realSessionManager.deleteSession(sessionId);

            // Everything should be gone
            expect(realSessionManager['sessions'].has(sessionId)).toBe(false);
            expect(await realStorageBackends.database.get(sessionKey)).toBeUndefined();

            // Note: Chat history is also deleted via session.reset() which calls
            // ContextManager's resetConversation() method, but since we're mocking
            // ChatSession, we only test session metadata deletion here
        });

        test('end-to-end: multiple sessions can expire and restore independently', async () => {
            const sessionIds = ['multi-1', 'multi-2', 'multi-3'];
            const histories = sessionIds.map((id, index) => [
                { role: 'user', content: `Hello from session ${index + 1}` },
            ]);

            // Create multiple sessions with different histories
            for (let i = 0; i < sessionIds.length; i++) {
                await realSessionManager.createSession(sessionIds[i]);
                await realStorageBackends.database.set(`messages:${sessionIds[i]}`, histories[i]);
            }

            // Mark all as expired and cleanup
            await new Promise((resolve) => setTimeout(resolve, 150));
            for (const sessionId of sessionIds) {
                const sessionData = await realStorageBackends.database.get(`session:${sessionId}`);
                if (sessionData) {
                    sessionData.lastActivity = Date.now() - 200;
                    await realStorageBackends.database.set(`session:${sessionId}`, sessionData);
                }
            }

            await realSessionManager['cleanupExpiredSessions']();

            // All should be removed from memory
            sessionIds.forEach((id) => {
                expect(realSessionManager['sessions'].has(id)).toBe(false);
            });

            // Restore sessions one by one and verify independent histories
            for (let i = 0; i < sessionIds.length; i++) {
                const sessionId = sessionIds[i]!;
                const restoredSession = await realSessionManager.getSession(sessionId);
                expect(restoredSession).toBeDefined();
                expect(restoredSession!.id).toBe(sessionId);

                const history = await realStorageBackends.database.get(`messages:${sessionId}`);
                expect(history).toEqual(histories[i]);
            }

            // All should be back in memory
            sessionIds.forEach((id) => {
                expect(realSessionManager['sessions'].has(id)).toBe(true);
            });
        });
    });

    describe('Continuation Sessions', () => {
        test('createContinuationSession should copy LLM config from original session', async () => {
            // Setup: Create a mock for getRuntimeConfig that returns session-specific config
            const originalSessionId = 'original-session-id';
            const originalLLMConfig = {
                provider: 'openai',
                model: 'gpt-5.2-codex',
                apiKey: 'test-key',
                maxIterations: 50,
                maxInputTokens: 20000, // Custom value
            };

            // Mock getRuntimeConfig to return the original session's config
            mockServices.stateManager.getRuntimeConfig = vi.fn().mockImplementation((sessionId) => {
                if (sessionId === originalSessionId) {
                    return { llm: originalLLMConfig };
                }
                // For new sessions, return default config (simulating the bug scenario)
                return {
                    llm: { ...originalLLMConfig, model: 'claude-4.5-opus', maxInputTokens: 200000 },
                };
            });

            // Mock database to return the original session data
            mockStorageManager.database.get.mockImplementation(async (key: string) => {
                if (key === `session:${originalSessionId}`) {
                    return {
                        id: originalSessionId,
                        createdAt: Date.now(),
                        lastActivity: Date.now(),
                        messageCount: 10,
                    };
                }
                return null;
            });

            await sessionManager.init();

            // Act: Create continuation session
            const { sessionId: newSessionId } =
                await sessionManager.createContinuationSession(originalSessionId);

            // Assert: updateLLM should have been called with the original config for the new session
            expect(mockServices.stateManager.updateLLM).toHaveBeenCalledWith(
                originalLLMConfig,
                newSessionId
            );

            // Verify getRuntimeConfig was called with the original session ID
            expect(mockServices.stateManager.getRuntimeConfig).toHaveBeenCalledWith(
                originalSessionId
            );
        });

        test('createContinuationSession should throw if original session not found', async () => {
            mockStorageManager.database.get.mockResolvedValue(null);
            await sessionManager.init();

            await expect(
                sessionManager.createContinuationSession('non-existent-session')
            ).rejects.toThrow();
        });
    });
});
