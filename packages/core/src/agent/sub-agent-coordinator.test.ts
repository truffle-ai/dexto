import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubAgentCoordinator, type SubAgentSpawnOptions } from './sub-agent-coordinator.js';
import { SessionError } from '../session/errors.js';
import type { AgentConfig } from './schemas.js';
import type { SessionManager } from '../session/index.js';
import type { AgentStateManager } from './state-manager.js';
import type { AgentEventBus } from '../events/index.js';
import type { IDextoLogger } from '../logger/v2/types.js';

// Mock DextoAgent
const createMockDextoAgent = () => ({
    agentId: 'test-agent',
    isStarted: true,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(),
    createSession: vi.fn().mockResolvedValue({
        id: 'mock-session-id',
        run: vi.fn().mockResolvedValue('Task completed successfully'),
        cancel: vi.fn().mockResolvedValue(true),
        eventBus: {
            on: vi.fn(),
            off: vi.fn(),
            emit: vi.fn(),
        },
    }),
    getSession: vi.fn().mockResolvedValue({
        id: 'mock-session-id',
        run: vi.fn().mockResolvedValue('Task completed successfully'),
        cancel: vi.fn().mockResolvedValue(true),
    }),
    endSession: vi.fn().mockResolvedValue(undefined),
    agentEventBus: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
    },
});

describe('SubAgentCoordinator', () => {
    let coordinator: SubAgentCoordinator;
    let mockSessionManager: any;
    let mockStateManager: any;
    let mockAgentEventBus: any;
    let mockLogger: any;
    let mockParentSession: any;

    beforeEach(() => {
        mockParentSession = {
            id: 'parent-session-id',
            eventBus: {
                on: vi.fn(),
                off: vi.fn(),
                emit: vi.fn(),
            },
        };

        mockSessionManager = {
            getSession: vi.fn().mockResolvedValue(mockParentSession),
            getSessionMetadata: vi.fn().mockResolvedValue({
                metadata: { type: 'primary' },
            }),
            createSession: vi.fn(),
        };

        mockStateManager = {
            getRuntimeConfig: vi.fn().mockReturnValue({
                sessions: {
                    maxSubAgentDepth: 1,
                    subAgentLifecycle: 'persistent',
                },
            }),
        };

        mockAgentEventBus = {
            on: vi.fn(),
            off: vi.fn(),
            emit: vi.fn(),
        };

        mockLogger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        coordinator = new SubAgentCoordinator(
            mockSessionManager as any,
            mockStateManager as any,
            mockAgentEventBus as any,
            mockLogger as any
        );
    });

    describe('spawn()', () => {
        test('should spawn a sub-agent with DextoAgent instance', async () => {
            const mockAgent = createMockDextoAgent();

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockAgent as any,
                description: 'Test task',
            };

            const handle = await coordinator.spawn(options);

            expect(handle).toBeDefined();
            expect(handle.sessionId).toBeDefined();
            expect(mockAgent.createSession).toHaveBeenCalled();
        });

        test.todo('should spawn a sub-agent with AgentConfig', async () => {
            const mockConfig: AgentConfig = {
                agentId: 'sub-agent',
                systemPrompt: {
                    contributors: [
                        {
                            id: 'primary',
                            type: 'static',
                            priority: 0,
                            content: 'Test sub-agent prompt',
                        },
                    ],
                },
                llm: {
                    provider: 'anthropic',
                    model: 'claude-haiku-4-5-20251001',
                    apiKey: 'test-api-key',
                },
                storage: {
                    database: { type: 'sqlite', path: ':memory:' },
                    cache: { type: 'in-memory' },
                    blob: { type: 'in-memory' },
                },
                internalTools: ['read_file'],
            };

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockConfig,
            };

            const handle = await coordinator.spawn(options);

            expect(handle).toBeDefined();
        });

        test('should reject spawn_agent tool in sub-agent config', async () => {
            const mockConfig: AgentConfig = {
                agentId: 'sub-agent',
                systemPrompt: {
                    contributors: [
                        {
                            id: 'primary',
                            type: 'static',
                            priority: 0,
                            content: 'Test prompt',
                        },
                    ],
                },
                llm: {
                    provider: 'anthropic',
                    model: 'claude-haiku-4-5-20251001',
                    apiKey: 'test-key',
                },
                storage: {
                    database: { type: 'sqlite', path: ':memory:' },
                    cache: { type: 'in-memory' },
                    blob: { type: 'in-memory' },
                },
                internalTools: ['spawn_agent'], // Not allowed!
            };

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockConfig,
            };

            await expect(coordinator.spawn(options)).rejects.toThrow('infinite recursion');
        });

        test('should reject ask_user tool in sub-agent config', async () => {
            const mockConfig: AgentConfig = {
                agentId: 'sub-agent',
                systemPrompt: {
                    contributors: [
                        {
                            id: 'primary',
                            type: 'static',
                            priority: 0,
                            content: 'Test prompt',
                        },
                    ],
                },
                llm: {
                    provider: 'anthropic',
                    model: 'claude-haiku-4-5-20251001',
                    apiKey: 'test-key',
                },
                storage: {
                    database: { type: 'sqlite', path: ':memory:' },
                    cache: { type: 'in-memory' },
                    blob: { type: 'in-memory' },
                },
                internalTools: ['ask_user'], // Not allowed!
            };

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockConfig,
            };

            await expect(coordinator.spawn(options)).rejects.toThrow('work autonomously');
        });

        test('should enforce depth limit', async () => {
            // Set up parent as already at max depth
            mockSessionManager.getSessionMetadata.mockResolvedValue({
                metadata: {
                    type: 'sub-agent',
                    subAgent: { parentSessionId: 'grandparent-session' },
                },
            });

            // Mock grandparent lookup
            mockSessionManager.getSessionMetadata
                .mockResolvedValueOnce({
                    metadata: {
                        type: 'sub-agent',
                        subAgent: { parentSessionId: 'grandparent-session' },
                    },
                })
                .mockResolvedValueOnce({
                    metadata: { type: 'primary' },
                });

            const mockAgent = createMockDextoAgent();

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockAgent as any,
            };

            await expect(coordinator.spawn(options)).rejects.toThrow(
                SessionError.maxDepthExceeded(1, 1).message
            );
        });

        test('should throw if parent session not found', async () => {
            mockSessionManager.getSession.mockResolvedValue(null);

            const mockAgent = createMockDextoAgent();

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'non-existent-session',
                agent: mockAgent as any,
            };

            await expect(coordinator.spawn(options)).rejects.toThrow('not found');
        });

        test('should use default lifecycle from config', async () => {
            mockStateManager.getRuntimeConfig.mockReturnValue({
                sessions: {
                    maxSubAgentDepth: 1,
                    subAgentLifecycle: 'ephemeral',
                },
            });

            const mockAgent = createMockDextoAgent();

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockAgent as any,
            };

            const handle = await coordinator.spawn(options);

            // Cleanup should call stop (ephemeral)
            const context = (coordinator as any).activeSubAgents.get(
                Array.from((coordinator as any).activeSubAgents.keys())[0]
            );
            expect(context.lifecycle).toBe('ephemeral');
        });

        test('should override lifecycle when provided', async () => {
            const mockAgent = createMockDextoAgent();

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockAgent as any,
                lifecycle: 'ephemeral', // Override
            };

            const handle = await coordinator.spawn(options);

            const context = (coordinator as any).activeSubAgents.get(
                Array.from((coordinator as any).activeSubAgents.keys())[0]
            );
            expect(context.lifecycle).toBe('ephemeral');
        });
    });

    describe('SubAgentHandle', () => {
        test('should run task and auto-cleanup', async () => {
            const mockAgent = createMockDextoAgent();
            const mockSession = {
                id: 'sub-session-id',
                run: vi.fn().mockResolvedValue('Task result'),
                cancel: vi.fn(),
            };

            mockAgent.getSession.mockResolvedValue(mockSession);
            mockAgent.createSession.mockResolvedValue(mockSession);

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockAgent as any,
            };

            const handle = await coordinator.spawn(options);
            const result = await handle.run('Test task');

            expect(result).toBe('Task result');
            expect(mockSession.run).toHaveBeenCalledWith('Test task');

            // Should auto-cleanup after run
            expect((coordinator as any).activeSubAgents.size).toBe(0);
        });

        test('should support task timeout', async () => {
            const mockAgent = createMockDextoAgent();
            const mockSession = {
                id: 'sub-session-id',
                run: vi
                    .fn()
                    .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 1000))),
                cancel: vi.fn(),
            };

            mockAgent.getSession.mockResolvedValue(mockSession);
            mockAgent.createSession.mockResolvedValue(mockSession);

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockAgent as any,
            };

            const handle = await coordinator.spawn(options);

            await expect(handle.run('Test task', { timeout: 100 })).rejects.toThrow('timeout');
        });

        test('should provide sub-agent info', async () => {
            const mockAgent = createMockDextoAgent();

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockAgent as any,
            };

            const handle = await coordinator.spawn(options);
            const info = handle.info;

            expect(info).toHaveProperty('agentId');
            expect(info).toHaveProperty('sessionId');
            expect(info).toHaveProperty('depth', 1);
            expect(info).toHaveProperty('duration');
            expect(typeof info.duration).toBe('number');
        });

        test('should allow cancelling task', async () => {
            const mockAgent = createMockDextoAgent();
            const mockSession = {
                id: 'sub-session-id',
                run: vi.fn(),
                cancel: vi.fn().mockResolvedValue(true),
            };

            mockAgent.getSession.mockResolvedValue(mockSession);
            mockAgent.createSession.mockResolvedValue(mockSession);

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockAgent as any,
            };

            const handle = await coordinator.spawn(options);
            const cancelled = await handle.cancel();

            expect(cancelled).toBe(true);
            expect(mockSession.cancel).toHaveBeenCalled();
        });
    });

    describe('cleanup()', () => {
        test('should clean up ephemeral sub-agent by stopping it', async () => {
            const mockAgent = createMockDextoAgent();

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockAgent as any,
                lifecycle: 'ephemeral',
            };

            const handle = await coordinator.spawn(options);
            const agentId = (coordinator as any).activeSubAgents.keys().next().value;

            await coordinator.cleanup(agentId);

            expect(mockAgent.stop).toHaveBeenCalled();
        });

        test('should clean up persistent sub-agent by ending session', async () => {
            const mockAgent = createMockDextoAgent();

            const options: SubAgentSpawnOptions = {
                parentSessionId: 'parent-session-id',
                agent: mockAgent as any,
                lifecycle: 'persistent',
            };

            const handle = await coordinator.spawn(options);
            const agentId = (coordinator as any).activeSubAgents.keys().next().value;

            await coordinator.cleanup(agentId);

            expect(mockAgent.endSession).toHaveBeenCalled();
            expect(mockAgent.stop).not.toHaveBeenCalled();
        });

        test('should handle cleanup of non-existent agent gracefully', async () => {
            await expect(coordinator.cleanup('non-existent-agent')).resolves.not.toThrow();
        });
    });

    describe('getActiveSubAgents()', () => {
        test('should return active sub-agents for parent session', async () => {
            const mockAgent1 = createMockDextoAgent();
            const mockAgent2 = createMockDextoAgent();

            await coordinator.spawn({
                parentSessionId: 'parent-1',
                agent: mockAgent1 as any,
            });

            await coordinator.spawn({
                parentSessionId: 'parent-1',
                agent: mockAgent2 as any,
            });

            await coordinator.spawn({
                parentSessionId: 'parent-2',
                agent: createMockDextoAgent() as any,
            });

            const activeForParent1 = coordinator.getActiveSubAgents('parent-1');
            expect(activeForParent1).toHaveLength(2);

            const activeForParent2 = coordinator.getActiveSubAgents('parent-2');
            expect(activeForParent2).toHaveLength(1);
        });

        test('should return empty array if no active sub-agents', () => {
            const active = coordinator.getActiveSubAgents('non-existent-parent');
            expect(active).toEqual([]);
        });
    });

    describe('cancel()', () => {
        test('should cancel a running sub-agent', async () => {
            const mockAgent = createMockDextoAgent();

            const handle = await coordinator.spawn({
                parentSessionId: 'parent-session-id',
                agent: mockAgent as any,
            });

            const agentId = (coordinator as any).activeSubAgents.keys().next().value;
            const cancelled = await coordinator.cancel(agentId);

            expect(cancelled).toBe(true);
        });

        test('should return false if agent not found', async () => {
            const cancelled = await coordinator.cancel('non-existent-agent');
            expect(cancelled).toBe(false);
        });
    });
});
