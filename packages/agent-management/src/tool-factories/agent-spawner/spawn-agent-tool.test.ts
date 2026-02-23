import { describe, expect, it } from 'vitest';
import { createSpawnAgentTool } from './spawn-agent-tool.js';

describe('spawn_agent presentation', () => {
    it('includes task as primaryText and truncates it', async () => {
        const tool = createSpawnAgentTool({
            // Only used for description generation
            getAvailableAgents: () => [],
        } as any);

        const snapshot = await Promise.resolve(
            tool.presentation?.describeCall?.(
                {
                    task: 'a'.repeat(200),
                    instructions: 'b'.repeat(10_000),
                } as any,
                {
                    sessionId: 'test-session',
                    toolCallId: 'call-1',
                    logger: {
                        debug: () => {},
                        silly: () => {},
                        info: () => {},
                        warn: () => {},
                        error: () => {},
                        trackException: () => {},
                        createChild: () => ({}) as any,
                        createFileOnlyChild: () => ({}) as any,
                        destroy: async () => {},
                        setLevel: () => {},
                        getLevel: () => 'info',
                        getLogFilePath: () => null,
                    },
                } as any
            ) ?? null
        );

        expect(snapshot?.version).toBe(1);
        expect(snapshot?.header?.primaryText).toBe('a'.repeat(117) + '...');
    });
});
