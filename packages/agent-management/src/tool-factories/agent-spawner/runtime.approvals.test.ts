import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DextoAgent, Logger } from '@dexto/core';
import { AgentSpawnerRuntime } from './runtime.js';
import * as approvalDelegation from '../../runtime/approval-delegation.js';

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

describe('AgentSpawnerRuntime sub-agent policies and approvals', () => {
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

    it('inherits parent toolPolicies into default sub-agent config', async () => {
        const childAgent = {} as unknown as DextoAgent;
        runtimeMocks.spawnAgent.mockResolvedValue({ agentId: 'agent-child', agent: childAgent });
        runtimeMocks.executeTask.mockResolvedValue({ success: true, response: 'ok' });
        runtimeMocks.stopAgent.mockResolvedValue(undefined);

        const parentAgent = {
            config: {
                agentId: 'coding-agent',
                mcpServers: {},
                permissions: {
                    toolPolicies: {
                        alwaysAllow: ['glob_files'],
                        alwaysDeny: ['bash_exec'],
                    },
                },
            },
            getCurrentLLMConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini' }),
            getWorkspace: vi.fn(async () => ({
                path: '/tmp/workspace',
                id: 'w',
                createdAt: 0,
                lastActiveAt: 0,
            })),
            services: { approvalManager: {} },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const runtime = new AgentSpawnerRuntime(parentAgent, config, createMockLogger());
        await runtime.spawnAndExecute({
            task: 'do thing',
            instructions: 'do thing now',
            autoApprove: true,
        });

        const spawnConfig = runtimeMocks.spawnAgent.mock.calls[0]![0];
        expect(spawnConfig.agentConfig.permissions.toolPolicies.alwaysAllow).toContain(
            'glob_files'
        );
        expect(spawnConfig.agentConfig.permissions.toolPolicies.alwaysDeny).toContain('bash_exec');
    });

    it('wires delegated approvals with parent sessionId when manual', async () => {
        const setApprovalHandler = vi.fn();
        const childAgent = { setApprovalHandler } as unknown as DextoAgent;
        runtimeMocks.spawnAgent.mockImplementation(async (spawnConfig: any) => {
            await spawnConfig.onBeforeStart?.(childAgent);
            return { agentId: 'agent-child', agent: childAgent };
        });
        runtimeMocks.executeTask.mockResolvedValue({ success: true, response: 'ok' });
        runtimeMocks.stopAgent.mockResolvedValue(undefined);

        const parentAgent = {
            config: {
                agentId: 'coding-agent',
                mcpServers: {},
            },
            getCurrentLLMConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini' }),
            getWorkspace: vi.fn(async () => ({
                path: '/tmp/workspace',
                id: 'w',
                createdAt: 0,
                lastActiveAt: 0,
            })),
            services: { approvalManager: { requestApproval: vi.fn() } },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const spy = vi.spyOn(approvalDelegation, 'createDelegatingApprovalHandler').mockReturnValue(
            Object.assign(async () => ({ status: 'approved' }), {
                cancel() {},
                cancelAll() {},
                getPending() {
                    return [];
                },
            }) as any
        );

        const runtime = new AgentSpawnerRuntime(parentAgent, config, createMockLogger());

        await runtime.spawnAndExecute({
            task: 'do thing',
            instructions: 'do thing now',
            autoApprove: false,
            sessionId: 'session-parent',
        });

        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[0]![2]).toBe('session-parent');
        expect(setApprovalHandler).toHaveBeenCalledTimes(1);
    });
});
