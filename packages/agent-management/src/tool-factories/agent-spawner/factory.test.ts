import { describe, expect, it, vi } from 'vitest';
import { agentSpawnerToolsFactory } from './factory.js';
import type { Logger, ToolExecutionContext } from '@dexto/core';

describe('agentSpawnerToolsFactory', () => {
    const createMockLogger = (): Logger => ({
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(() => createMockLogger()),
        destroy: vi.fn(),
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'info'),
        getLogFilePath: vi.fn(() => null),
    });

    const config = {
        type: 'agent-spawner' as const,
        maxConcurrentAgents: 1,
        defaultTimeout: 1000,
        allowSpawning: true,
    };

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
