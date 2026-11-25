import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DextoAgent } from './DextoAgent.js';
import { InMemoryDextoStores } from '../storage/index.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { defineTool } from '../tools/index.js';

it('keeps even core tools out of a tool-free conversation', async () => {
    const execute = vi.fn(async () => 'should not run');
    const agent = new DextoAgent({
        agentId: 'tool-free-test',
        systemPrompt: 'Answer questions.',
        llm: { provider: 'openai', model: 'gpt-5', apiKey: 'test-key' },
        permissions: { mode: 'full-access' },
        elicitation: { enabled: false },
        logger: createMockLogger(),
        stores: new InMemoryDextoStores(),
        tools: [
            defineTool({
                id: 'host_tool',
                description: 'Host tool',
                inputSchema: z.object({}),
                execute,
            }),
        ],
        toolsEnabled: false,
    });
    await agent.start();
    try {
        expect(await agent.getEnabledTools()).toEqual({});
        await expect(agent.executeTool('tool_output_read', {})).rejects.toThrow();
        await expect(agent.executeTool('host_tool', {})).rejects.toThrow();
        expect(execute).not.toHaveBeenCalled();
    } finally {
        await agent.stop();
    }
});

it('rejects an invalid toolsEnabled setting instead of leaving tools available', () => {
    expect(
        () =>
            new DextoAgent({
                agentId: 'tool-free-test',
                systemPrompt: 'Answer questions.',
                llm: { provider: 'openai', model: 'gpt-5', apiKey: 'test-key' },
                logger: createMockLogger(),
                stores: new InMemoryDextoStores(),
                // @ts-expect-error JavaScript callers can pass a non-boolean value.
                toolsEnabled: 'false',
            })
    ).toThrow();
});
