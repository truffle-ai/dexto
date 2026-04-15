import { describe, test, expect, vi, beforeEach } from 'vitest';
import { DextoAgent } from './DextoAgent.js';
import type { AgentRuntimeSettings } from './runtime-config.js';
import { LLMConfigSchema } from '../llm/schemas.js';
import { LoggerConfigSchema } from '../logger/index.js';
import { SystemPromptConfigSchema } from '../systemPrompt/schemas.js';
import { SessionConfigSchema } from '../session/schemas.js';
import { PermissionsConfigSchema, ElicitationConfigSchema } from '../tools/schemas.js';
import { ResourcesConfigSchema } from '../resources/schemas.js';
import { PromptsSchema } from '../prompts/schemas.js';
import { ServersConfigSchema } from '../mcp/schemas.js';
import type { AgentServices } from '../utils/service-initializer.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { AgentErrorCode } from './error-codes.js';
import { LLMErrorCode } from '../llm/error-codes.js';
import { createLogger } from '../logger/factory.js';
import { AgentEventBus, type StreamingEvent } from '../events/index.js';
import {
    createInMemoryBlobStore,
    createInMemoryCache,
    createInMemoryDatabase,
} from '../test-utils/in-memory-storage.js';

// Mock the createAgentServices function
vi.mock('../utils/service-initializer.js', () => ({
    createAgentServices: vi.fn(),
}));

vi.mock('../session/title-generator.js', async (importOriginal) => {
    const actual = (await importOriginal()) as typeof import('../session/title-generator.js');
    return {
        ...actual,
        generateSessionTitle: vi.fn(),
    };
});

import { createAgentServices } from '../utils/service-initializer.js';
import { generateSessionTitle } from '../session/title-generator.js';
const mockCreateAgentServices = vi.mocked(createAgentServices);
const mockGenerateSessionTitle = vi.mocked(generateSessionTitle);

describe('DextoAgent Lifecycle Management', () => {
    let mockValidatedConfig: AgentRuntimeSettings;
    let mockServices: AgentServices;

    const createTestAgent = (settings: AgentRuntimeSettings) => {
        const loggerConfig = LoggerConfigSchema.parse({
            level: 'error',
            transports: [{ type: 'silent' }],
        });
        const agentLogger = createLogger({ config: loggerConfig, agentId: settings.agentId });
        return new DextoAgent({
            ...settings,
            logger: agentLogger,
            storage: {
                blob: createInMemoryBlobStore(),
                database: createInMemoryDatabase(),
                cache: createInMemoryCache(),
            },
            tools: [],
            hooks: [],
        });
    };

    beforeEach(() => {
        vi.resetAllMocks();

        mockValidatedConfig = {
            systemPrompt: SystemPromptConfigSchema.parse('You are a helpful assistant'),
            llm: LLMConfigSchema.parse({
                provider: 'openai',
                model: 'gpt-5',
                apiKey: 'test-key',
                maxIterations: 50,
                maxInputTokens: 128000,
            }),
            agentId: 'test-agent',
            mcpServers: ServersConfigSchema.parse({}),
            sessions: SessionConfigSchema.parse({
                maxSessions: 10,
                sessionTTL: 3600,
            }),
            permissions: PermissionsConfigSchema.parse({
                mode: 'auto-approve',
                timeout: 120000,
            }),
            elicitation: ElicitationConfigSchema.parse({
                enabled: false,
                timeout: 120000,
            }),
            resources: ResourcesConfigSchema.parse([]),
            prompts: PromptsSchema.parse([]),
        };

        mockServices = {
            mcpManager: {
                disconnectAll: vi.fn(),
                initializeFromConfig: vi.fn().mockResolvedValue(undefined),
            } as any,
            toolManager: {
                setTools: vi.fn(),
                setToolExecutionContextFactory: vi.fn(),
                buildContributorContext: vi.fn().mockResolvedValue({}),
                initialize: vi.fn().mockResolvedValue(undefined),
            } as any,
            systemPromptManager: {
                build: vi.fn().mockResolvedValue('resolved system prompt'),
            } as any,
            agentEventBus: new AgentEventBus() as any,
            stateManager: {
                getRuntimeConfig: vi.fn().mockReturnValue(mockValidatedConfig),
                getLLMConfig: vi.fn().mockReturnValue(mockValidatedConfig.llm),
                updateLLM: vi.fn(),
            } as any,
            sessionManager: {
                cleanup: vi.fn(),
                init: vi.fn().mockResolvedValue(undefined),
                getSession: vi.fn().mockResolvedValue(undefined),
                getSessionMetadata: vi.fn().mockResolvedValue(undefined),
                setSessionTitle: vi.fn().mockResolvedValue(undefined),
                createSession: vi.fn().mockResolvedValue({ id: 'test-session' }),
                incrementMessageCount: vi.fn().mockResolvedValue(undefined),
                switchLLMForSpecificSession: vi.fn().mockResolvedValue(undefined),
                switchLLMForAllSessions: vi.fn().mockResolvedValue(undefined),
            } as any,
            workspaceManager: {
                setWorkspace: vi.fn(),
                getWorkspace: vi.fn(),
                listWorkspaces: vi.fn(),
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
                requestToolApproval: vi.fn(),
                requestElicitation: vi.fn(),
                cancelApproval: vi.fn(),
                cancelAllApprovals: vi.fn(),
                hasHandler: vi.fn().mockReturnValue(false),
            } as any,
            memoryManager: {} as any,
            hookManager: {
                cleanup: vi.fn(),
            } as any,
        };

        mockCreateAgentServices.mockResolvedValue(mockServices);
        mockGenerateSessionTitle.mockResolvedValue({ title: 'Generated title' });

        // Set up default behaviors for mock functions that will be overridden in tests
        (mockServices.sessionManager.cleanup as any).mockResolvedValue(undefined);
        (mockServices.mcpManager.disconnectAll as any).mockResolvedValue(undefined);
        (mockServices.storageManager!.disconnect as any).mockResolvedValue(undefined);
    });

    describe('Constructor Patterns', () => {
        test('should create agent with config (new pattern)', () => {
            const agent = createTestAgent(mockValidatedConfig);

            expect(agent.isStarted()).toBe(false);
            expect(agent.isStopped()).toBe(false);
        });
    });

    describe('Prompt Inspection', () => {
        test('should include session context when getting a session system prompt', async () => {
            const agent = createTestAgent(mockValidatedConfig);

            await agent.start();
            await expect(agent.getSystemPrompt('session-123')).resolves.toBe(
                'resolved system prompt'
            );

            expect(mockServices.toolManager.buildContributorContext).toHaveBeenCalledWith({
                sessionId: 'session-123',
            });
            expect(mockServices.systemPromptManager.build).toHaveBeenCalledWith({});
        });

        test('should reject empty session ids when getting a session system prompt', async () => {
            const agent = createTestAgent(mockValidatedConfig);

            await agent.start();

            await expect(
                Promise.resolve(Reflect.apply(agent.getSystemPrompt, agent, ['']))
            ).rejects.toMatchObject({
                code: AgentErrorCode.API_VALIDATION_ERROR,
                scope: ErrorScope.AGENT,
                type: ErrorType.USER,
            });
            expect(mockServices.toolManager.buildContributorContext).not.toHaveBeenCalled();
        });
    });

    describe('Session Title Generation', () => {
        test('passes languageModelFactory overrides to title generation', async () => {
            const languageModelFactory = vi.fn();
            const agent = new DextoAgent({
                ...mockValidatedConfig,
                logger: createLogger({
                    config: LoggerConfigSchema.parse({
                        level: 'error',
                        transports: [{ type: 'silent' }],
                    }),
                    agentId: mockValidatedConfig.agentId,
                }),
                storage: {
                    blob: createInMemoryBlobStore(),
                    database: createInMemoryDatabase(),
                    cache: createInMemoryCache(),
                },
                tools: [],
                hooks: [],
                overrides: {
                    languageModelFactory,
                },
            });

            (mockServices.sessionManager.getSessionMetadata as any).mockResolvedValue({
                createdAt: Date.now(),
                lastActivity: Date.now(),
                messageCount: 1,
            });
            (mockServices.sessionManager.getSession as any).mockResolvedValue({
                getHistory: vi.fn().mockResolvedValue([
                    {
                        role: 'user',
                        content: 'Need a title for this session',
                    },
                ]),
            });

            await agent.start();

            await expect(agent.generateSessionTitle('session-123')).resolves.toBe(
                'Generated title'
            );
            expect(mockGenerateSessionTitle).toHaveBeenCalledWith(
                mockValidatedConfig.llm,
                mockServices.toolManager,
                mockServices.systemPromptManager,
                mockServices.resourceManager,
                'Need a title for this session',
                expect.any(Object),
                {
                    languageModelFactory,
                }
            );
        });
    });

    describe('start() Method', () => {
        test('should start successfully with valid config', async () => {
            const agent = createTestAgent(mockValidatedConfig);

            await agent.start();

            expect(agent.isStarted()).toBe(true);
            expect(agent.isStopped()).toBe(false);
            expect(mockCreateAgentServices).toHaveBeenCalledWith(
                mockValidatedConfig,
                expect.anything(), // logger instance
                expect.anything(), // eventBus instance
                expect.any(Object),
                null
            );
        });

        test('should start with per-server connection modes in config', async () => {
            const validatedConfigWithServerModes: AgentRuntimeSettings = {
                ...mockValidatedConfig,
                mcpServers: ServersConfigSchema.parse({
                    filesystem: {
                        type: 'stdio' as const,
                        command: 'npx',
                        args: ['@modelcontextprotocol/server-filesystem', '.'],
                        env: {},
                        timeout: 30000,
                        connectionMode: 'strict' as const,
                    },
                }),
            };
            const agent = createTestAgent(validatedConfigWithServerModes);

            await agent.start();

            expect(mockCreateAgentServices).toHaveBeenCalledWith(
                validatedConfigWithServerModes,
                expect.anything(), // logger instance
                expect.anything(), // eventBus instance
                expect.any(Object),
                null
            );
        });

        test('should pass a telemetry bootstrap override through service initialization', async () => {
            const telemetryBootstrap = vi.fn();
            const loggerConfig = LoggerConfigSchema.parse({
                level: 'error',
                transports: [{ type: 'silent' }],
            });
            const agentLogger = createLogger({
                config: loggerConfig,
                agentId: mockValidatedConfig.agentId,
            });
            const agent = new DextoAgent({
                ...mockValidatedConfig,
                logger: agentLogger,
                storage: {
                    blob: createInMemoryBlobStore(),
                    database: createInMemoryDatabase(),
                    cache: createInMemoryCache(),
                },
                tools: [],
                hooks: [],
                overrides: {
                    telemetryBootstrap,
                },
            });

            await agent.start();

            expect(mockCreateAgentServices).toHaveBeenCalledWith(
                mockValidatedConfig,
                expect.anything(),
                expect.anything(),
                expect.objectContaining({
                    telemetryBootstrap,
                }),
                null
            );
        });

        test('should throw error when starting twice', async () => {
            const agent = createTestAgent(mockValidatedConfig);

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
            const agent = createTestAgent(mockValidatedConfig);
            mockCreateAgentServices.mockRejectedValue(new Error('Service initialization failed'));

            await expect(agent.start()).rejects.toThrow('Service initialization failed');
            expect(agent.isStarted()).toBe(false);
        });
    });

    describe('stop() Method', () => {
        test('should stop successfully after start', async () => {
            const agent = createTestAgent(mockValidatedConfig);
            await agent.start();

            await agent.stop();

            expect(agent.isStarted()).toBe(false);
            expect(agent.isStopped()).toBe(true);
            expect(mockServices.sessionManager.cleanup).toHaveBeenCalled();
            expect(mockServices.mcpManager.disconnectAll).toHaveBeenCalled();
            expect(mockServices.storageManager!.disconnect).toHaveBeenCalled();
        });

        test('should throw error when stopping before start', async () => {
            const agent = createTestAgent(mockValidatedConfig);

            await expect(agent.stop()).rejects.toThrow(
                expect.objectContaining({
                    code: AgentErrorCode.NOT_STARTED,
                    scope: ErrorScope.AGENT,
                    type: ErrorType.USER,
                })
            );
        });

        test('should warn when stopping twice but not throw', async () => {
            const agent = createTestAgent(mockValidatedConfig);
            await agent.start();
            await agent.stop();

            // Second stop should not throw but should warn
            await expect(agent.stop()).resolves.toBeUndefined();
        });

        test('should handle partial cleanup failures gracefully', async () => {
            const agent = createTestAgent(mockValidatedConfig);
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
            { name: 'getSessionSystemPromptContributors', args: ['session-id'] },
            {
                name: 'upsertSessionSystemPromptContributor',
                args: ['session-id', { id: 'peer-origin', priority: 0, content: 'test' }],
            },
            { name: 'removeSessionSystemPromptContributor', args: ['session-id', 'peer-origin'] },
        ];

        test.each(testMethods)('$name should throw before start()', async ({ name, args }) => {
            const agent = createTestAgent(mockValidatedConfig);

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
            const agent = createTestAgent(mockValidatedConfig);
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
            const agent = createTestAgent(mockValidatedConfig);

            expect(() => agent.isStarted()).not.toThrow();
            expect(() => agent.isStopped()).not.toThrow();
        });

        test('switchLLM should not update runtime state when the target session is missing', async () => {
            const agent = createTestAgent(mockValidatedConfig);
            await agent.start();

            const updateLLM = mockServices.stateManager.updateLLM as ReturnType<typeof vi.fn>;
            const getSession = mockServices.sessionManager.getSession as ReturnType<typeof vi.fn>;
            const switchLLMForSpecificSession = mockServices.sessionManager
                .switchLLMForSpecificSession as ReturnType<typeof vi.fn>;

            getSession.mockResolvedValue(undefined);

            await expect(
                agent.switchLLM({ model: 'gpt-5-nano' }, 'missing-session')
            ).rejects.toBeInstanceOf(DextoRuntimeError);
            expect(updateLLM).not.toHaveBeenCalled();
            expect(switchLLMForSpecificSession).not.toHaveBeenCalled();
        });
    });

    describe('Session Auto-Approve Tools Cleanup (Memory Leak Fix)', () => {
        test('endSession should call clearSessionAutoApproveTools', async () => {
            const agent = createTestAgent(mockValidatedConfig);

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
            const agent = createTestAgent(mockValidatedConfig);

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
            const agent = createTestAgent(mockValidatedConfig);
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

    describe('Stream Error Lifecycle', () => {
        test('should prefer the terminal fatal event emitted on the agent bus over a fallback run_failed error', async () => {
            const agent = createTestAgent(mockValidatedConfig);
            const mappedError = new DextoRuntimeError(
                LLMErrorCode.INSUFFICIENT_CREDITS,
                ErrorScope.LLM,
                ErrorType.USER,
                'Insufficient Dexto credits. Balance: $0.00',
                { balance: 0 },
                'Run `dexto billing` to check your balance'
            );
            const sessionStream = vi.fn().mockImplementation(async () => {
                agent.emit('llm:error', {
                    sessionId: 'test-session',
                    error: mappedError,
                    recoverable: false,
                    context: 'TurnExecutor',
                });
                agent.emit('run:complete', {
                    sessionId: 'test-session',
                    finishReason: 'error',
                    stepCount: 0,
                    durationMs: 1,
                    error: mappedError,
                });
                throw mappedError;
            });
            mockServices.sessionManager.getSession = vi.fn().mockResolvedValue({
                id: 'test-session',
                stream: sessionStream,
            });

            await agent.start();

            const events: StreamingEvent[] = [];
            for await (const event of await agent.stream('hello', 'test-session')) {
                events.push(event);
            }

            expect(events.map((event) => event.name)).toEqual(['llm:error', 'run:complete']);
            expect(events[0]).toMatchObject({
                name: 'llm:error',
                error: mappedError,
                context: 'TurnExecutor',
            });
            expect(events[1]).toMatchObject({
                name: 'run:complete',
                error: mappedError,
                finishReason: 'error',
            });
            expect(
                events.some((event) => event.name === 'llm:error' && event.context === 'run_failed')
            ).toBe(false);
        });

        test('should still emit a fallback run_failed error when session streaming fails before any terminal event', async () => {
            const agent = createTestAgent(mockValidatedConfig);
            const streamError = new Error('Session stream failed before event emission');
            const sessionStream = vi.fn().mockRejectedValue(streamError);
            mockServices.sessionManager.getSession = vi.fn().mockResolvedValue({
                id: 'test-session',
                stream: sessionStream,
            });

            await agent.start();

            const events: StreamingEvent[] = [];
            for await (const event of await agent.stream('hello', 'test-session')) {
                events.push(event);
            }

            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                name: 'llm:error',
                context: 'run_failed',
                recoverable: false,
            });
            if (events[0]?.name !== 'llm:error') {
                throw new Error('Expected llm:error event');
            }
            expect(events[0].error).toBe(streamError);
        });
    });

    describe('Integration Tests', () => {
        test('should validate extracted @resource media before session stream', async () => {
            const settingsWithExpandedVideo: AgentRuntimeSettings = {
                ...mockValidatedConfig,
                llm: LLMConfigSchema.parse({
                    ...mockValidatedConfig.llm,
                    allowedMediaTypes: ['video/*'],
                }),
            };
            mockValidatedConfig = settingsWithExpandedVideo;
            (mockServices.stateManager.getRuntimeConfig as any).mockReturnValue(
                settingsWithExpandedVideo
            );
            (mockServices.stateManager.getLLMConfig as any).mockReturnValue(
                settingsWithExpandedVideo.llm
            );

            const sessionStream = vi.fn().mockResolvedValue(undefined);
            mockServices.sessionManager.getSession = vi.fn().mockResolvedValue(undefined);
            mockServices.sessionManager.createSession = vi.fn().mockResolvedValue({
                id: 'test-session',
                stream: sessionStream,
            });

            mockServices.resourceManager = {
                list: vi.fn().mockResolvedValue({
                    'blob:video-1': {
                        uri: 'blob:video-1',
                        name: 'clip.mp4',
                        mimeType: 'video/mp4',
                        source: 'internal',
                    },
                }),
                read: vi.fn().mockResolvedValue({
                    contents: [{ blob: 'AAAA', mimeType: 'video/mp4' }],
                }),
                cleanup: vi.fn(),
            } as any;

            const agent = createTestAgent(settingsWithExpandedVideo);
            await agent.start();

            await expect(agent.generate('Analyze @clip.mp4', 'test-session')).rejects.toMatchObject(
                {
                    issues: expect.arrayContaining([
                        expect.objectContaining({
                            code: LLMErrorCode.INPUT_FILE_UNSUPPORTED,
                        }),
                    ]),
                }
            );

            expect(mockServices.sessionManager.createSession).not.toHaveBeenCalled();
            expect(sessionStream).not.toHaveBeenCalled();
        });

        test('should validate resource-only media input before session stream', async () => {
            const settingsWithExpandedVideo: AgentRuntimeSettings = {
                ...mockValidatedConfig,
                llm: LLMConfigSchema.parse({
                    ...mockValidatedConfig.llm,
                    allowedMediaTypes: ['video/*'],
                }),
            };
            mockValidatedConfig = settingsWithExpandedVideo;
            (mockServices.stateManager.getRuntimeConfig as any).mockReturnValue(
                settingsWithExpandedVideo
            );
            (mockServices.stateManager.getLLMConfig as any).mockReturnValue(
                settingsWithExpandedVideo.llm
            );

            const sessionStream = vi.fn().mockResolvedValue(undefined);
            mockServices.sessionManager.getSession = vi.fn().mockResolvedValue(undefined);
            mockServices.sessionManager.createSession = vi.fn().mockResolvedValue({
                id: 'test-session',
                stream: sessionStream,
            });

            mockServices.resourceManager = {
                read: vi.fn().mockResolvedValue({
                    contents: [{ blob: 'AAAA', mimeType: 'video/mp4' }],
                }),
                cleanup: vi.fn(),
            } as any;

            const agent = createTestAgent(settingsWithExpandedVideo);
            await agent.start();

            await expect(
                agent.generate(
                    [
                        {
                            type: 'resource',
                            uri: 'blob:video-1',
                            name: 'clip.mp4',
                            mimeType: 'video/mp4',
                            kind: 'video',
                        },
                    ],
                    'test-session'
                )
            ).rejects.toMatchObject({
                issues: expect.arrayContaining([
                    expect.objectContaining({
                        code: LLMErrorCode.INPUT_FILE_UNSUPPORTED,
                    }),
                ]),
            });

            expect(mockServices.resourceManager.read).toHaveBeenCalledWith('blob:video-1');
            expect(mockServices.sessionManager.createSession).not.toHaveBeenCalled();
            expect(sessionStream).not.toHaveBeenCalled();
        });

        test('should handle complete lifecycle without errors', async () => {
            const agent = createTestAgent(mockValidatedConfig);

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
            const agent = createTestAgent(mockValidatedConfig);
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
