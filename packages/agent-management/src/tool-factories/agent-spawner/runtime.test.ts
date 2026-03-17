import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DextoAgent, Logger } from '@dexto/core';
import { AgentSpawnerRuntime } from './runtime.js';
import { AgentSpawnerConfigSchema } from './schemas.js';

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

const runtimeMocks = vi.hoisted(() => ({
    mockRegistry: {
        getAvailableAgents: vi.fn(),
        hasAgent: vi.fn(),
        resolveAgent: vi.fn(),
    },
    spawnAgent: vi.fn(),
    executeTask: vi.fn(),
    stopAgent: vi.fn(),
    listAgents: vi.fn(),
}));

vi.mock('../../runtime/AgentRuntime.js', () => {
    class AgentRuntime {
        listAgents = runtimeMocks.listAgents;
        spawnAgent = runtimeMocks.spawnAgent;
        executeTask = runtimeMocks.executeTask;
        stopAgent = runtimeMocks.stopAgent;
        stopAll = vi.fn();
    }

    return { AgentRuntime };
});

vi.mock('../../registry/registry.js', () => ({
    getAgentRegistry: vi.fn(() => runtimeMocks.mockRegistry),
}));

describe('AgentSpawnerRuntime workspace inheritance', () => {
    const config = AgentSpawnerConfigSchema.parse({
        type: 'agent-spawner',
        maxConcurrentAgents: 1,
        defaultTimeout: 1000,
        allowSpawning: true,
    });

    let originalCwd: string;
    let tempDir: string;

    beforeEach(async () => {
        runtimeMocks.spawnAgent.mockReset();
        runtimeMocks.executeTask.mockReset();
        runtimeMocks.stopAgent.mockReset();
        runtimeMocks.listAgents.mockReset();
        runtimeMocks.mockRegistry.getAvailableAgents.mockReset();
        runtimeMocks.mockRegistry.hasAgent.mockReset();
        runtimeMocks.mockRegistry.resolveAgent.mockReset();
        runtimeMocks.listAgents.mockReturnValue([]);
        runtimeMocks.mockRegistry.getAvailableAgents.mockReturnValue({});
        runtimeMocks.mockRegistry.hasAgent.mockReturnValue(false);
        runtimeMocks.mockRegistry.resolveAgent.mockRejectedValue(new Error('not found'));
        originalCwd = process.cwd();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-spawner-runtime-'));
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('applies parent workspace to spawned agent', async () => {
        const parentWorkspace = {
            id: 'workspace-1',
            path: '/tmp/workspace',
            name: 'Test Workspace',
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
        };

        const childAgent = {
            setWorkspace: vi.fn().mockResolvedValue(undefined),
        } as unknown as DextoAgent;

        runtimeMocks.spawnAgent.mockResolvedValue({
            agentId: 'child-1',
            agent: childAgent,
        });
        runtimeMocks.executeTask.mockResolvedValue({
            success: true,
            response: 'ok',
        });
        runtimeMocks.stopAgent.mockResolvedValue(undefined);

        const parentAgent = {
            config: {
                agentId: 'parent-1',
                mcpServers: {},
            },
            getCurrentLLMConfig: () => ({
                provider: 'openai',
                model: 'gpt-4o-mini',
            }),
            getWorkspace: vi.fn(async () => parentWorkspace),
            services: {
                approvalManager: {},
            },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const runtime = new AgentSpawnerRuntime(parentAgent, config, createMockLogger());
        const result = await runtime.spawnAndExecute({
            task: 'do thing',
            instructions: 'do thing now',
            autoApprove: true,
        });

        expect(result.success).toBe(true);
        expect(childAgent.setWorkspace).toHaveBeenCalledWith({
            path: parentWorkspace.path,
            name: parentWorkspace.name,
        });
    });

    it('resolves sub-agents from the workspace project registry before installed agents', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        await fs.mkdir(path.join(workspaceRoot, 'agents', 'explore-agent'), { recursive: true });
        await fs.writeFile(
            path.join(workspaceRoot, 'agents', 'registry.json'),
            JSON.stringify(
                {
                    agents: [
                        {
                            id: 'explore-agent',
                            name: 'Explore Agent',
                            description: 'Workspace sub-agent',
                            configPath: './explore-agent/explore-agent.yml',
                        },
                    ],
                },
                null,
                2
            ),
            'utf8'
        );
        await fs.writeFile(
            path.join(workspaceRoot, 'agents', 'explore-agent', 'explore-agent.yml'),
            [
                "image: '@dexto/image-local'",
                'systemPrompt: |',
                '  Explore the workspace and report findings back to the parent agent.',
                'llm:',
                '  provider: openai',
                '  model: gpt-5-mini',
                '  apiKey: $OPENAI_API_KEY',
                '',
            ].join('\n'),
            'utf8'
        );
        process.chdir(workspaceRoot);

        const childAgent = {
            setWorkspace: vi.fn().mockResolvedValue(undefined),
        } as unknown as DextoAgent;

        runtimeMocks.spawnAgent.mockResolvedValue({
            agentId: 'child-1',
            agent: childAgent,
        });
        runtimeMocks.executeTask.mockResolvedValue({
            success: true,
            response: 'ok',
        });
        runtimeMocks.stopAgent.mockResolvedValue(undefined);

        const parentAgent = {
            config: {
                agentId: 'parent-1',
                mcpServers: {},
            },
            getCurrentLLMConfig: () => ({
                provider: 'openai',
                model: 'gpt-4o-mini',
            }),
            getWorkspace: vi.fn(async () => ({
                id: 'workspace-1',
                path: workspaceRoot,
                name: 'Workspace',
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
            })),
            services: {
                approvalManager: {},
            },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const runtime = new AgentSpawnerRuntime(parentAgent, config, createMockLogger());
        const result = await runtime.spawnAndExecute({
            task: 'explore the workspace',
            instructions: 'explore the workspace',
            agentId: 'explore-agent',
            autoApprove: true,
        });

        expect(result.success).toBe(true);
        expect(runtimeMocks.mockRegistry.resolveAgent).not.toHaveBeenCalled();
        expect(runtimeMocks.spawnAgent).toHaveBeenCalledWith(
            expect.objectContaining({
                agentConfig: expect.objectContaining({
                    systemPrompt:
                        'Explore the workspace and report findings back to the parent agent.\n',
                    llm: expect.objectContaining({
                        provider: 'openai',
                        model: 'gpt-5-mini',
                    }),
                }),
            })
        );
    });

    it('lists workspace registry agents in available agents metadata', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        await fs.mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
        runtimeMocks.mockRegistry.getAvailableAgents.mockReturnValue({
            'global-agent': {
                id: 'global-agent',
                name: 'Global Agent',
                description: 'Installed global agent',
                author: 'global',
                tags: [],
                source: 'global-agent',
                type: 'custom',
            },
        });
        await fs.writeFile(
            path.join(workspaceRoot, 'agents', 'registry.json'),
            JSON.stringify(
                {
                    agents: [
                        {
                            id: 'review-agent',
                            name: 'Review Agent',
                            description: 'Reviews changes',
                            configPath: './review-agent/review-agent.yml',
                        },
                    ],
                },
                null,
                2
            ),
            'utf8'
        );
        process.chdir(workspaceRoot);

        const parentAgent = {
            config: {
                agentId: 'parent-1',
                mcpServers: {},
            },
            getCurrentLLMConfig: () => ({
                provider: 'openai',
                model: 'gpt-4o-mini',
            }),
            getWorkspace: vi.fn(async () => ({
                id: 'workspace-1',
                path: workspaceRoot,
                name: 'Workspace',
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
            })),
            services: {
                approvalManager: {},
            },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const runtime = new AgentSpawnerRuntime(parentAgent, config, createMockLogger());

        await expect(runtime.getAvailableAgents()).resolves.toEqual([
            expect.objectContaining({
                id: 'review-agent',
                name: 'Review Agent',
                description: 'Reviews changes',
                type: 'custom',
            }),
        ]);
    });

    it('uses the parent workspace for available agents even when cwd is elsewhere', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        await fs.mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
        await fs.writeFile(
            path.join(workspaceRoot, 'agents', 'registry.json'),
            JSON.stringify(
                {
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

        const parentAgent = {
            config: {
                agentId: 'review-agent',
                mcpServers: {},
            },
            getCurrentLLMConfig: () => ({
                provider: 'openai',
                model: 'gpt-4o-mini',
            }),
            getWorkspace: vi.fn(async () => ({
                id: 'workspace-1',
                path: workspaceRoot,
                name: 'Workspace',
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
            })),
            services: {
                approvalManager: {},
            },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const runtime = new AgentSpawnerRuntime(parentAgent, config, createMockLogger());

        await expect(runtime.getAvailableAgents()).resolves.toEqual([
            expect.objectContaining({
                id: 'explore-agent',
                name: 'Explore Agent',
            }),
        ]);
    });

    it('does not fall back to installed registry agents when a workspace registry exists', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        await fs.mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
        await fs.writeFile(
            path.join(workspaceRoot, 'agents', 'registry.json'),
            JSON.stringify(
                {
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
        process.chdir(workspaceRoot);
        runtimeMocks.mockRegistry.getAvailableAgents.mockReturnValue({
            'global-agent': {
                id: 'global-agent',
                name: 'Global Agent',
                description: 'Installed global agent',
                author: 'global',
                tags: [],
                source: 'global-agent',
                type: 'custom',
            },
        });

        const parentAgent = {
            config: {
                agentId: 'review-agent',
                mcpServers: {},
            },
            getCurrentLLMConfig: () => ({
                provider: 'openai',
                model: 'gpt-4o-mini',
            }),
            getWorkspace: vi.fn(async () => ({
                id: 'workspace-1',
                path: workspaceRoot,
                name: 'Workspace',
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
            })),
            services: {
                approvalManager: {},
            },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const runtime = new AgentSpawnerRuntime(parentAgent, config, createMockLogger());
        runtime.setWorkspaceRootHint(workspaceRoot);

        await expect(runtime.getAvailableAgents()).resolves.toEqual([
            expect.objectContaining({
                id: 'explore-agent',
                name: 'Explore Agent',
                description: 'Workspace sub-agent',
            }),
        ]);
    });

    it('does not resolve installed registry agents when a workspace registry exists', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        await fs.mkdir(path.join(workspaceRoot, 'agents', 'explore-agent'), { recursive: true });
        await fs.writeFile(
            path.join(workspaceRoot, 'agents', 'registry.json'),
            JSON.stringify(
                {
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
        await fs.writeFile(
            path.join(workspaceRoot, 'agents', 'explore-agent', 'explore-agent.yml'),
            [
                "image: '@dexto/image-local'",
                'systemPrompt: |',
                '  Explore the workspace and report findings back to the parent agent.',
                'llm:',
                '  provider: openai',
                '  model: gpt-5-mini',
                '  apiKey: $OPENAI_API_KEY',
                '',
            ].join('\n'),
            'utf8'
        );
        process.chdir(workspaceRoot);

        const childAgent = {
            setWorkspace: vi.fn().mockResolvedValue(undefined),
        } as unknown as DextoAgent;

        runtimeMocks.spawnAgent.mockResolvedValue({
            agentId: 'child-1',
            agent: childAgent,
        });
        runtimeMocks.executeTask.mockResolvedValue({
            success: true,
            response: 'ok',
        });
        runtimeMocks.stopAgent.mockResolvedValue(undefined);

        const parentAgent = {
            config: {
                agentId: 'review-agent',
                mcpServers: {},
            },
            getCurrentLLMConfig: () => ({
                provider: 'openai',
                model: 'gpt-4o-mini',
            }),
            getWorkspace: vi.fn(async () => ({
                id: 'workspace-1',
                path: workspaceRoot,
                name: 'Workspace',
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
            })),
            services: {
                approvalManager: {},
            },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const runtime = new AgentSpawnerRuntime(parentAgent, config, createMockLogger());
        const result = await runtime.spawnAndExecute({
            task: 'delegate unknown',
            instructions: 'delegate unknown',
            agentId: 'global-agent',
            autoApprove: true,
        });

        expect(result.success).toBe(true);
        expect(runtimeMocks.mockRegistry.resolveAgent).not.toHaveBeenCalled();
        expect(runtimeMocks.spawnAgent).toHaveBeenCalledWith(
            expect.objectContaining({
                agentConfig: expect.objectContaining({
                    systemPrompt:
                        'You are a helpful sub-agent. Complete the task given to you efficiently and concisely.',
                }),
            })
        );
    });

    it('does not widen allowedAgents beyond workspace scope when allowGlobalAgents is false', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        await fs.mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
        await fs.writeFile(
            path.join(workspaceRoot, 'agents', 'registry.json'),
            JSON.stringify(
                {
                    allowGlobalAgents: false,
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
        process.chdir(workspaceRoot);
        runtimeMocks.mockRegistry.getAvailableAgents.mockReturnValue({
            'global-agent': {
                id: 'global-agent',
                name: 'Global Agent',
                description: 'Installed global agent',
                author: 'global',
                tags: [],
                source: 'global-agent',
                type: 'custom',
            },
        });

        const parentAgent = {
            config: {
                agentId: 'review-agent',
                mcpServers: {},
            },
            getCurrentLLMConfig: () => ({
                provider: 'openai',
                model: 'gpt-4o-mini',
            }),
            getWorkspace: vi.fn(async () => ({
                id: 'workspace-1',
                path: workspaceRoot,
                name: 'Workspace',
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
            })),
            services: {
                approvalManager: {},
            },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const runtime = new AgentSpawnerRuntime(
            parentAgent,
            AgentSpawnerConfigSchema.parse({
                ...config,
                allowedAgents: ['explore-agent', 'global-agent'],
            }),
            createMockLogger()
        );

        await expect(runtime.getAvailableAgents()).resolves.toEqual([
            expect.objectContaining({
                id: 'explore-agent',
                name: 'Explore Agent',
            }),
        ]);
    });

    it('includes installed registry agents when allowGlobalAgents is true', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        await fs.mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
        await fs.writeFile(
            path.join(workspaceRoot, 'agents', 'registry.json'),
            JSON.stringify(
                {
                    allowGlobalAgents: true,
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
        process.chdir(workspaceRoot);
        runtimeMocks.mockRegistry.getAvailableAgents.mockReturnValue({
            'global-agent': {
                id: 'global-agent',
                name: 'Global Agent',
                description: 'Installed global agent',
                author: 'global',
                tags: [],
                source: 'global-agent',
                type: 'custom',
            },
        });

        const parentAgent = {
            config: {
                agentId: 'review-agent',
                mcpServers: {},
            },
            getCurrentLLMConfig: () => ({
                provider: 'openai',
                model: 'gpt-4o-mini',
            }),
            getWorkspace: vi.fn(async () => ({
                id: 'workspace-1',
                path: workspaceRoot,
                name: 'Workspace',
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
            })),
            services: {
                approvalManager: {},
            },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const runtime = new AgentSpawnerRuntime(parentAgent, config, createMockLogger());

        await expect(runtime.getAvailableAgents()).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'explore-agent' }),
                expect.objectContaining({ id: 'global-agent' }),
            ])
        );
    });

    it('resolves installed registry agents when allowGlobalAgents is true', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const installedAgentPath = path.join(tempDir, 'global-agent', 'global-agent.yml');
        await fs.mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
        await fs.mkdir(path.dirname(installedAgentPath), { recursive: true });
        await fs.writeFile(
            path.join(workspaceRoot, 'agents', 'registry.json'),
            JSON.stringify(
                {
                    allowGlobalAgents: true,
                    agents: [
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
        await fs.writeFile(
            installedAgentPath,
            [
                "image: '@dexto/image-local'",
                'systemPrompt: |',
                '  Use the installed global agent workflow.',
                'llm:',
                '  provider: openai',
                '  model: gpt-5-mini',
                '  apiKey: $OPENAI_API_KEY',
                '',
            ].join('\n'),
            'utf8'
        );
        process.chdir(workspaceRoot);
        runtimeMocks.mockRegistry.hasAgent.mockReturnValue(true);
        runtimeMocks.mockRegistry.resolveAgent.mockResolvedValue(installedAgentPath);

        const childAgent = {
            setWorkspace: vi.fn().mockResolvedValue(undefined),
        } as unknown as DextoAgent;

        runtimeMocks.spawnAgent.mockResolvedValue({
            agentId: 'child-1',
            agent: childAgent,
        });
        runtimeMocks.executeTask.mockResolvedValue({
            success: true,
            response: 'ok',
        });
        runtimeMocks.stopAgent.mockResolvedValue(undefined);

        const parentAgent = {
            config: {
                agentId: 'review-agent',
                mcpServers: {},
            },
            getCurrentLLMConfig: () => ({
                provider: 'openai',
                model: 'gpt-4o-mini',
            }),
            getWorkspace: vi.fn(async () => ({
                id: 'workspace-1',
                path: workspaceRoot,
                name: 'Workspace',
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
            })),
            services: {
                approvalManager: {},
            },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const runtime = new AgentSpawnerRuntime(parentAgent, config, createMockLogger());
        const result = await runtime.spawnAndExecute({
            task: 'delegate global',
            instructions: 'delegate global',
            agentId: 'global-agent',
            autoApprove: true,
        });

        expect(result.success).toBe(true);
        expect(runtimeMocks.mockRegistry.resolveAgent).toHaveBeenCalledWith('global-agent');
        expect(runtimeMocks.spawnAgent).toHaveBeenCalledWith(
            expect.objectContaining({
                agentConfig: expect.objectContaining({
                    systemPrompt: 'Use the installed global agent workflow.\n',
                }),
            })
        );
    });

    it('filters out workspace subagents linked to a different parent', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        await fs.mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
        await fs.writeFile(
            path.join(workspaceRoot, 'agents', 'registry.json'),
            JSON.stringify(
                {
                    agents: [
                        {
                            id: 'explore-agent',
                            name: 'Explore Agent',
                            description: 'Workspace sub-agent',
                            configPath: './explore-agent/explore-agent.yml',
                            parentAgentId: 'review-agent',
                            tags: ['subagent'],
                        },
                    ],
                },
                null,
                2
            ),
            'utf8'
        );
        process.chdir(workspaceRoot);

        const parentAgent = {
            config: {
                agentId: 'coding-agent',
                mcpServers: {},
            },
            getCurrentLLMConfig: () => ({
                provider: 'openai',
                model: 'gpt-4o-mini',
            }),
            getWorkspace: vi.fn(async () => ({
                id: 'workspace-1',
                path: workspaceRoot,
                name: 'Workspace',
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
            })),
            services: {
                approvalManager: {},
            },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const runtime = new AgentSpawnerRuntime(parentAgent, config, createMockLogger());

        await expect(runtime.getAvailableAgents()).resolves.toEqual([]);
    });
});
