import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DextoAgent, Logger } from '@dexto/core';
import { AgentSpawnerRuntime } from './runtime.js';

const runtimeMocks = vi.hoisted(() => ({
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

const createMockLogger = (): Logger => {
    const logger: Logger = {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(() => logger),
        destroy: vi.fn(async () => undefined),
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'info' as const),
        getLogFilePath: vi.fn(() => null),
    };
    return logger;
};

describe('AgentSpawnerRuntime workspace inheritance', () => {
    const config = {
        type: 'agent-spawner' as const,
        maxConcurrentAgents: 1,
        defaultTimeout: 1000,
        allowSpawning: true,
    };

    beforeEach(() => {
        runtimeMocks.spawnAgent.mockReset();
        runtimeMocks.executeTask.mockReset();
        runtimeMocks.stopAgent.mockReset();
        runtimeMocks.listAgents.mockReset();
        runtimeMocks.listAgents.mockReturnValue([]);
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
});
