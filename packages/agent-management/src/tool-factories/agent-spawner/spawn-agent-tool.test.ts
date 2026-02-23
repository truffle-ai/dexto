import { describe, expect, it } from 'vitest';
import { createSpawnAgentTool } from './spawn-agent-tool.js';

describe('spawn_agent presentation', () => {
    it('includes task as primaryText and truncates it', () => {
        const tool = createSpawnAgentTool({
            // Only used for description generation
            getAvailableAgents: () => [],
        } as any);

        const snapshot = tool.presentation?.describeCall?.({
            task: 'a'.repeat(200),
            instructions: 'b'.repeat(10_000),
        } as any);

        expect(snapshot?.version).toBe(1);
        expect(snapshot?.header?.primaryText).toBe('a'.repeat(117) + '...');
    });
});
