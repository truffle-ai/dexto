import { describe, expect, it } from 'vitest';
import { agentSpawnerToolsFactory } from './factory.js';
import type { ToolExecutionContext } from '@dexto/core';

describe('agentSpawnerToolsFactory', () => {
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

        expect(() => spawnTool!.execute({ task: 't', instructions: 'i' })).toThrow(
            /ToolExecutionContext\.agent/
        );
    });

    it('throws when ToolExecutionContext.logger is missing', () => {
        const tools = agentSpawnerToolsFactory.create(config);
        const spawnTool = tools.find((tool) => tool.id === 'spawn_agent');
        expect(spawnTool).toBeDefined();

        expect(() =>
            spawnTool!.execute({ task: 't', instructions: 'i' }, {
                agent: {},
            } as unknown as ToolExecutionContext)
        ).toThrow(/ToolExecutionContext\.logger/);
    });
});
