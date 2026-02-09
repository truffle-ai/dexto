import { describe, test, expect, vi, beforeEach } from 'vitest';
import { DextoAgent } from './DextoAgent.js';
import type { AgentConfig, ValidatedAgentConfig } from './schemas.js';
import { AgentConfigSchema } from './schemas.js';
import type { AgentServices } from '../utils/service-initializer.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { AgentErrorCode } from './error-codes.js';

// Mock the createAgentServices function
vi.mock('../utils/service-initializer.js', () => ({
    createAgentServices: vi.fn(),
}));

import { createAgentServices } from '../utils/service-initializer.js';
const mockCreateAgentServices = vi.mocked(createAgentServices);

describe('DextoAgent Lifecycle Management', () => {
    let mockConfig: AgentConfig;
    let mockValidatedConfig: ValidatedAgentConfig;
    let mockServices: AgentServices;

    beforeEach(() => {
        vi.resetAllMocks();

        mockConfig = {
            systemPrompt: 'You are a helpful assistant',
            llm: {
                provider: 'openai',
                model: 'gpt-5',
                apiKey: 'test-key',
                maxIterations: 50,
                maxInputTokens: 128000,
            },
            mcpServers: {},
            sessions: {
                maxSessions: 10,
                sessionTTL: 3600,
            },
            toolConfirmation: {
                mode: 'auto-approve',
                timeout: 120000,
            },
            elicitation: {
                enabled: false,
                timeout: 120000,
            },
        };

        // Create the validated config that DextoAgent actually uses
        mockValidatedConfig = AgentConfigSchema.parse(mockConfig);

        mockServices = {
            mcpManager: {
                disconnectAll: vi.fn(),
                initializeFromConfig: vi.fn().mockResolvedValue(undefined),
            } as any,
            toolManager: {
                setTools: vi.fn(),
                setToolExecutionContextFactory: vi.fn(),
                initialize: vi.fn().mockResolvedValue(undefined),
            } as any,
            systemPromptManager: {} as any,
            agentEventBus: {
                on: vi.fn(),
                emit: vi.fn(),
            } as any,
            stateManager: {
                getRuntimeConfig: vi.fn().mockReturnValue({
                    llm: mockValidatedConfig.llm,
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
                getLLMConfig: vi.fn().mockReturnValue(mockValidatedConfig.llm),
            } as any,
            sessionManager: {
                cleanup: vi.fn(),
                init: vi.fn().mockResolvedValue(undefined),
                createSession: vi.fn().mockResolvedValue({ id: 'test-session' }),
            } as any,
            searchService: {} as any,
            storageManager: {
                disconnect: vi.fn(),
                getDatabase: vi.fn().mockReturnValue({}),
                getCache: vi.fn().mockReturnValue({}),
                getBlobStore: vi.fn().mockReturnValue({}),
            } as any,
            resourceManager: {} as any,
            approvalManager: {
                requestToolConfirmation: vi.fn(),
                requestElicitation: vi.fn(),
                cancelApproval: vi.fn(),
                cancelAllApprovals: vi.fn(),
                hasHandler: vi.fn().mockReturnValue(false),
            } as any,
            memoryManager: {} as any,
            pluginManager: {
                cleanup: vi.fn(),
            } as any,
        };

        mockCreateAgentServices.mockResolvedValue(mockServices);

        // Set up default behaviors for mock functions that will be overridden in tests
        (mockServices.sessionManager.cleanup as any).mockResolvedValue(undefined);
        (mockServices.mcpManager.disconnectAll as any).mockResolvedValue(undefined);
        (mockServices.storageManager!.disconnect as any).mockResolvedValue(undefined);
    });

    describe('Constructor Patterns', () => {
        test('should create agent with config (new pattern)', () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });

            expect(agent.isStarted()).toBe(false);
            expect(agent.isStopped()).toBe(false);
        });
    });

    describe('start() Method', () => {
        test('should start successfully with valid config', async () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });

            await agent.start();

            expect(agent.isStarted()).toBe(true);
            expect(agent.isStopped()).toBe(false);
            expect(mockCreateAgentServices).toHaveBeenCalledWith(
                mockValidatedConfig,
                expect.anything(), // logger instance
                expect.anything(), // eventBus instance
                undefined
            );
        });

        test('should start with per-server connection modes in config', async () => {
            const configWithServerModes = {
                ...mockConfig,
                mcpServers: {
                    filesystem: {
                        type: 'stdio' as const,
                        command: 'npx',
                        args: ['@modelcontextprotocol/server-filesystem', '.'],
                        env: {},
                        timeout: 30000,
                        connectionMode: 'strict' as const,
                    },
                },
            };
            const validatedConfigWithServerModes = AgentConfigSchema.parse(configWithServerModes);
            const agent = new DextoAgent({ config: validatedConfigWithServerModes });

            await agent.start();

            expect(mockCreateAgentServices).toHaveBeenCalledWith(
                validatedConfigWithServerModes,
                expect.anything(), // logger instance
                expect.anything(), // eventBus instance
                undefined
            );
        });

        test('should throw error when starting twice', async () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });

            await agent.start();

            await expect(agent.start()).rejects.toThrow(
                expect.objectContaining({
                    code: AgentErrorCode.ALREADY_STARTED,
                    scope: ErrorScope.AGENT,
                    type: ErrorType.USER,
                })
            );
        });

        test('should handle start failure gracefully', async () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });
            mockCreateAgentServices.mockRejectedValue(new Error('Service initialization failed'));

            await expect(agent.start()).rejects.toThrow('Service initialization failed');
            expect(agent.isStarted()).toBe(false);
        });
    });

    describe('stop() Method', () => {
        test('should stop successfully after start', async () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });
            await agent.start();

            await agent.stop();

            expect(agent.isStarted()).toBe(false);
            expect(agent.isStopped()).toBe(true);
            expect(mockServices.sessionManager.cleanup).toHaveBeenCalled();
            expect(mockServices.mcpManager.disconnectAll).toHaveBeenCalled();
            expect(mockServices.storageManager!.disconnect).toHaveBeenCalled();
        });

        test('should throw error when stopping before start', async () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });

            await expect(agent.stop()).rejects.toThrow(
                expect.objectContaining({
                    code: AgentErrorCode.NOT_STARTED,
                    scope: ErrorScope.AGENT,
                    type: ErrorType.USER,
                })
            );
        });

        test('should warn when stopping twice but not throw', async () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });
            await agent.start();
            await agent.stop();

            // Second stop should not throw but should warn
            await expect(agent.stop()).resolves.toBeUndefined();
        });

        test('should handle partial cleanup failures gracefully', async () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });
            await agent.start();

            // Make session cleanup fail
            (mockServices.sessionManager.cleanup as any).mockRejectedValue(
                new Error('Session cleanup failed')
            );

            // Should not throw, but should still mark as stopped
            await expect(agent.stop()).resolves.toBeUndefined();
            expect(agent.isStopped()).toBe(true);

            // Should still try to clean other services
            expect(mockServices.mcpManager.disconnectAll).toHaveBeenCalled();
            expect(mockServices.storageManager!.disconnect).toHaveBeenCalled();
        });
    });

    describe('Method Access Control', () => {
        const testMethods = [
            { name: 'run', args: ['test message'] },
            { name: 'createSession', args: [] },
            { name: 'getSession', args: ['session-id'] },
            { name: 'listSessions', args: [] },
            { name: 'deleteSession', args: ['session-id'] },
            { name: 'resetConversation', args: [] },
            { name: 'getCurrentLLMConfig', args: [] },
            { name: 'switchLLM', args: [{ model: 'gpt-5' }] },
            { name: 'addMcpServer', args: ['test', { type: 'stdio', command: 'test' }] },
            { name: 'getAllMcpTools', args: [] },
        ];

        test.each(testMethods)('$name should throw before start()', async ({ name, args }) => {
            const agent = new DextoAgent({ config: mockValidatedConfig });

            let thrownError: DextoRuntimeError | undefined;
            try {
                const method = agent[name as keyof DextoAgent] as Function;
                await method.apply(agent, args);
            } catch (error) {
                thrownError = error as DextoRuntimeError;
            }

            expect(thrownError).toBeDefined();
            expect(thrownError).toMatchObject({
                code: AgentErrorCode.NOT_STARTED,
                scope: ErrorScope.AGENT,
                type: ErrorType.USER,
            });
        });

        test.each(testMethods)('$name should throw after stop()', async ({ name, args }) => {
            const agent = new DextoAgent({ config: mockValidatedConfig });
            await agent.start();
            await agent.stop();

            let thrownError: DextoRuntimeError | undefined;
            try {
                const method = agent[name as keyof DextoAgent] as Function;
                await method.apply(agent, args);
            } catch (error) {
                thrownError = error as DextoRuntimeError;
            }

            expect(thrownError).toBeDefined();
            expect(thrownError).toMatchObject({
                code: AgentErrorCode.STOPPED,
                scope: ErrorScope.AGENT,
                type: ErrorType.USER,
            });
        });

        test('isStarted and isStopped should work without start() (read-only)', () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });

            expect(() => agent.isStarted()).not.toThrow();
            expect(() => agent.isStopped()).not.toThrow();
        });
    });

    describe('Session Auto-Approve Tools Cleanup (Memory Leak Fix)', () => {
        test('endSession should call clearSessionAutoApproveTools', async () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });

            // Add clearSessionAutoApproveTools mock to toolManager
            mockServices.toolManager.clearSessionAutoApproveTools = vi.fn();
            mockServices.sessionManager.endSession = vi.fn().mockResolvedValue(undefined);

            await agent.start();

            await agent.endSession('test-session-123');

            expect(mockServices.toolManager.clearSessionAutoApproveTools).toHaveBeenCalledWith(
                'test-session-123'
            );
            expect(mockServices.sessionManager.endSession).toHaveBeenCalledWith('test-session-123');
        });

        test('deleteSession should call clearSessionAutoApproveTools', async () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });

            // Add clearSessionAutoApproveTools mock to toolManager
            mockServices.toolManager.clearSessionAutoApproveTools = vi.fn();
            mockServices.sessionManager.deleteSession = vi.fn().mockResolvedValue(undefined);

            await agent.start();

            await agent.deleteSession('test-session-456');

            expect(mockServices.toolManager.clearSessionAutoApproveTools).toHaveBeenCalledWith(
                'test-session-456'
            );
            expect(mockServices.sessionManager.deleteSession).toHaveBeenCalledWith(
                'test-session-456'
            );
        });

        test('clearSessionAutoApproveTools should be called before session cleanup', async () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });
            const callOrder: string[] = [];

            mockServices.toolManager.clearSessionAutoApproveTools = vi.fn(() => {
                callOrder.push('clearSessionAutoApproveTools');
            });
            mockServices.sessionManager.endSession = vi.fn().mockImplementation(() => {
                callOrder.push('endSession');
                return Promise.resolve();
            });

            await agent.start();
            await agent.endSession('test-session');

            expect(callOrder).toEqual(['clearSessionAutoApproveTools', 'endSession']);
        });
    });

    describe('Integration Tests', () => {
        test('should handle complete lifecycle without errors', async () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });

            // Initial state
            expect(agent.isStarted()).toBe(false);
            expect(agent.isStopped()).toBe(false);

            // Start
            await agent.start();
            expect(agent.isStarted()).toBe(true);
            expect(agent.isStopped()).toBe(false);

            // Use agent (mock a successful operation)
            expect(agent.getCurrentLLMConfig()).toBeDefined();

            // Stop
            await agent.stop();
            expect(agent.isStarted()).toBe(false);
            expect(agent.isStopped()).toBe(true);
        });

        test('should handle resource cleanup in correct order', async () => {
            const agent = new DextoAgent({ config: mockValidatedConfig });
            await agent.start();

            const cleanupOrder: string[] = [];

            (mockServices.sessionManager.cleanup as any).mockImplementation(() => {
                cleanupOrder.push('sessions');
                return Promise.resolve();
            });

            (mockServices.mcpManager.disconnectAll as any).mockImplementation(() => {
                cleanupOrder.push('clients');
                return Promise.resolve();
            });

            (mockServices.storageManager!.disconnect as any).mockImplementation(() => {
                cleanupOrder.push('storage');
                return Promise.resolve();
            });

            await agent.stop();

            expect(cleanupOrder).toEqual(['sessions', 'clients', 'storage']);
        });
    });
});
