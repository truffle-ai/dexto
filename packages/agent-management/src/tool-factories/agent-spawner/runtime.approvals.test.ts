import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DextoAgent, Logger } from '@dexto/core';
import { AgentSpawnerRuntime } from './runtime.js';
import { ApprovalStatus, ApprovalType } from '@dexto/core';
import type { ApprovalRequest } from '@dexto/core';
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
    const config = AgentSpawnerConfigSchema.parse({
        type: 'agent-spawner',
        maxConcurrentAgents: 1,
        defaultTimeout: 1000,
        allowSpawning: true,
    });

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

        // Safety defaults: keep spawned sub-agents lightweight even if parent is configured for heavy reasoning.
        expect(spawnConfig.agentConfig.llm.maxIterations).toBe(100);
        expect(spawnConfig.agentConfig.llm.reasoning).toBeUndefined();
    });

    it('falls back to the lowest supported reasoning variant when preferred variant is unsupported', async () => {
        const childAgent = {} as unknown as DextoAgent;
        runtimeMocks.spawnAgent.mockResolvedValue({ agentId: 'agent-child', agent: childAgent });
        runtimeMocks.executeTask.mockResolvedValue({ success: true, response: 'ok' });
        runtimeMocks.stopAgent.mockResolvedValue(undefined);

        const parentAgent = {
            config: {
                agentId: 'coding-agent',
                mcpServers: {},
            },
            getCurrentLLMConfig: () => ({ provider: 'openai', model: 'gpt-5' }),
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
        expect(spawnConfig.agentConfig.llm.reasoning).toEqual({ variant: 'minimal' });
    });

    it('wires delegated approvals with parent sessionId when manual', async () => {
        const setApprovalHandler = vi.fn();
        const childAgent = {
            setApprovalHandler,
            config: { agentId: 'agent-child' },
        } as unknown as DextoAgent;
        runtimeMocks.spawnAgent.mockImplementation(async (spawnConfig: any) => {
            await spawnConfig.onBeforeStart?.(childAgent);
            return { agentId: 'agent-child', agent: childAgent };
        });
        runtimeMocks.executeTask.mockResolvedValue({ success: true, response: 'ok' });
        runtimeMocks.stopAgent.mockResolvedValue(undefined);

        const parentRequestApproval = vi.fn(async (details: any) => {
            return {
                approvalId: details.approvalId ?? 'approval-1',
                status: ApprovalStatus.APPROVED,
                sessionId: details.sessionId,
            };
        });

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
            getSession: vi.fn(async () => ({ logger: createMockLogger() })),
            services: {
                approvalManager: {
                    requestApproval: parentRequestApproval,
                    cancelApproval: vi.fn(),
                },
            },
            emit: vi.fn(),
        } as unknown as DextoAgent;

        const runtime = new AgentSpawnerRuntime(parentAgent, config, createMockLogger());

        await runtime.spawnAndExecute({
            task: 'do thing',
            instructions: 'do thing now',
            autoApprove: false,
            sessionId: 'session-parent',
        });

        expect(setApprovalHandler).toHaveBeenCalledTimes(1);

        const handler = setApprovalHandler.mock.calls[0]![0] as (
            request: ApprovalRequest
        ) => Promise<any>;

        await handler({
            approvalId: 'approval-sub',
            type: ApprovalType.TOOL_APPROVAL,
            sessionId: 'session-sub',
            timeout: 0,
            metadata: {
                toolName: 'glob_files',
                toolCallId: 'call-1',
                args: { pattern: '**/*' },
            },
        } as any);

        expect(parentRequestApproval).toHaveBeenCalledTimes(1);
        expect(parentRequestApproval.mock.calls[0]![0].sessionId).toBe('session-parent');
    });
});
