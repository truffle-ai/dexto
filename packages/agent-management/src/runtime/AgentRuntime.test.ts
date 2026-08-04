import { describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '@dexto/agent-config';
import type { DextoAgent, Logger } from '@dexto/core';
import type { ModelRegistry } from '@dexto/llm';
import { AgentRuntime } from './AgentRuntime.js';

const { createDextoAgentFromConfigMock } = vi.hoisted(() => ({
    createDextoAgentFromConfigMock: vi.fn(),
}));

vi.mock('../agent-creation.js', () => ({
    createDextoAgentFromConfig: createDextoAgentFromConfigMock,
}));

function createMockLogger(): Logger {
    return {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(),
        createFileOnlyChild: vi.fn(),
        destroy: vi.fn(async () => undefined),
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'info' as const),
        getLogFilePath: vi.fn(() => null),
    } as unknown as Logger;
}

describe('AgentRuntime', () => {
    it('uses the active registry when creating a spawned agent', async () => {
        const llmRegistry = {} as ModelRegistry;
        const agent = {
            start: vi.fn(async () => undefined),
        } as unknown as DextoAgent;
        createDextoAgentFromConfigMock.mockResolvedValue(agent);

        const runtime = new AgentRuntime({
            logger: createMockLogger(),
            config: { maxAgents: 1, defaultTaskTimeout: 0 },
            llmRegistry,
        });

        await runtime.spawnAgent({
            agentId: 'child-agent',
            agentConfig: {} as AgentConfig,
        });

        expect(createDextoAgentFromConfigMock).toHaveBeenCalledWith(
            expect.objectContaining({
                runtimeOverrides: { llmRegistry },
            })
        );
    });
});
