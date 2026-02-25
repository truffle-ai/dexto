import { describe, expect, it, vi } from 'vitest';
import { agentSpawnerToolsFactory } from './factory.js';
import type { Logger, ToolExecutionContext } from '@dexto/core';
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

describe('agentSpawnerToolsFactory', () => {
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
});
