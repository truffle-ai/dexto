import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentSpawnerToolsFactory } from './factory.js';
import type { Logger, ToolExecutionContext } from '@dexto/core';
import { AgentSpawnerConfigSchema } from './schemas.js';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const createMockLogger = (): Logger => {
    const logger: Logger = {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(() => logger),
        createFileOnlyChild: vi.fn(() => logger),
        destroy: vi.fn(async () => undefined),
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'info' as const),
        getLogFilePath: vi.fn(() => null),
    };
    return logger;
};

describe('agentSpawnerToolsFactory', () => {
    const originalCwd = process.cwd();

    afterEach(() => {
        process.chdir(originalCwd);
    });

    const config = AgentSpawnerConfigSchema.parse({
        type: 'agent-spawner',
        maxConcurrentAgents: 1,
        defaultTimeout: 1000,
        allowSpawning: true,
    });

    it('throws when ToolExecutionContext.agent is missing', () => {
        const tools = agentSpawnerToolsFactory.create(config);
        const spawnTool = tools.find((tool) => tool.id === 'spawn_agent');
        expect(spawnTool).toBeDefined();

        const context: ToolExecutionContext = {
            logger: createMockLogger(),
        };

        expect(() => spawnTool!.execute({ task: 't', instructions: 'i' }, context)).toThrow(
            /ToolExecutionContext\.agent/
        );
    });

    it('throws when ToolExecutionContext.services is missing', () => {
        const tools = agentSpawnerToolsFactory.create(config);
        const spawnTool = tools.find((tool) => tool.id === 'spawn_agent');
        expect(spawnTool).toBeDefined();

        const context: ToolExecutionContext = {
            logger: createMockLogger(),
            agent: {} as ToolExecutionContext['agent'],
        };

        expect(() => spawnTool!.execute({ task: 't', instructions: 'i' }, context)).toThrow(
            /ToolExecutionContext\.services/
        );
    });

    it('uses the workspace registry in the dynamic spawn_agent description', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-spawner-factory-'));
        const workspaceRoot = path.join(tempDir, 'workspace');
        await fs.mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
        await fs.writeFile(
            path.join(workspaceRoot, 'agents', 'registry.json'),
            JSON.stringify(
                {
                    primaryAgent: 'review-agent',
                    agents: [
                        {
                            id: 'explore-agent',
                            name: 'Explore Agent',
                            description: 'Workspace sub-agent',
                            configPath: './explore-agent/explore-agent.yml',
                            parentAgentId: 'review-agent',
                            tags: ['subagent'],
                        },
                        {
                            id: 'review-agent',
                            name: 'Review Agent',
                            description: 'Workspace review agent',
                            configPath: './review-agent/review-agent.yml',
                        },
                    ],
                },
                null,
                2
            ),
            'utf8'
        );

        process.chdir(tempDir);

        const tools = agentSpawnerToolsFactory.create(config);
        const spawnTool = tools.find((tool) => tool.id === 'spawn_agent');
        expect(spawnTool?.getDescription).toBeDefined();

        const description = await spawnTool!.getDescription!({
            logger: createMockLogger(),
            workspace: {
                id: 'workspace-1',
                path: workspaceRoot,
                createdAt: 1,
                lastActiveAt: 1,
            },
            agent: {
                config: { agentId: 'review-agent' },
                getCurrentLLMConfig: () => ({
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                }),
                getWorkspace: vi.fn(async () => ({
                    id: 'workspace-1',
                    path: workspaceRoot,
                    createdAt: 1,
                    lastActiveAt: 1,
                })),
                services: {
                    approvalManager: {},
                },
                emit: vi.fn(),
                on: vi.fn(),
            } as any,
            services: {
                taskForker: null,
            } as any,
        } as ToolExecutionContext);

        expect(description).toContain('## Available Agents');
        expect(description).toContain('explore-agent');
        expect(description).toContain('Workspace sub-agent');
        expect(description).not.toContain('review-agent');
    });

    it('preserves host runtime IDs when background tasks complete and trigger follow-up runs', async () => {
        const tools = agentSpawnerToolsFactory.create(config);
        const spawnTool = tools.find((tool) => tool.id === 'spawn_agent');
        expect(spawnTool?.getDescription).toBeDefined();

        const backgroundListeners = new Map<string, (...args: unknown[]) => void>();
        const agent = {
            config: { agentId: 'test-agent' },
            getCurrentLLMConfig: () => ({
                provider: 'openai',
                model: 'gpt-4o-mini',
            }),
            getWorkspace: vi.fn(async () => undefined),
            services: {
                approvalManager: {},
            },
            emit: vi.fn(),
            on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
                backgroundListeners.set(event, listener);
            }),
            isSessionBusy: vi.fn().mockResolvedValue(false),
            queueMessage: vi.fn(),
            generate: vi.fn().mockResolvedValue({}),
        };

        await spawnTool!.getDescription!({
            logger: createMockLogger(),
            agent: agent as unknown as ToolExecutionContext['agent'],
            services: {
                taskForker: null,
            } as ToolExecutionContext['services'],
        } as ToolExecutionContext);

        const handleBackground = backgroundListeners.get('tool:background');
        expect(handleBackground).toBeDefined();

        let resolvePromise!: (value: string) => void;
        const promise = new Promise<string>((resolve) => {
            resolvePromise = resolve;
        });
        const hostRuntime = {
            ids: {
                runId: 'run-1',
                attemptId: 'attempt-1',
            },
        };

        handleBackground?.({
            toolName: 'spawn_agent',
            toolCallId: 'task-1',
            sessionId: 'session-1',
            description: 'Spawn agent',
            promise,
            hostRuntime,
        });

        resolvePromise('done');

        await vi.waitFor(() => {
            expect(agent.emit).toHaveBeenCalledWith('tool:background-completed', {
                toolCallId: 'task-1',
                sessionId: 'session-1',
                hostRuntime,
            });
        });
        await vi.waitFor(() => {
            expect(agent.emit).toHaveBeenCalledWith(
                'run:invoke',
                expect.objectContaining({
                    sessionId: 'session-1',
                    source: 'external',
                    metadata: { taskId: 'task-1' },
                    hostRuntime,
                })
            );
        });
        await vi.waitFor(() => {
            expect(agent.generate).toHaveBeenCalledWith(expect.any(Array), 'session-1', {
                executionContext: hostRuntime,
            });
        });
    });
});
