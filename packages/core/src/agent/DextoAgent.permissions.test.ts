import { describe, expect, it } from 'vitest';
import { DextoAgent } from './DextoAgent.js';
import { InMemoryDextoStores } from '../storage/index.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

function createAgent(stores: InMemoryDextoStores) {
    return new DextoAgent({
        agentId: 'permissions-test',
        systemPrompt: 'Test agent',
        llm: { provider: 'openai', model: 'gpt-5', apiKey: 'test-key' },
        permissions: { mode: 'auto-approve' },
        elicitation: { enabled: false },
        stores,
        logger: createMockLogger(),
    });
}

describe('session permissions', () => {
    it('does not restore another grant when two tools are revoked concurrently', async () => {
        const agent = createAgent(new InMemoryDextoStores());
        await agent.start();
        try {
            await agent.setSessionAutoApproveTools('a', ['write_file', 'edit_file']);
            await Promise.all([
                agent.revokeSessionApproval('a', { kind: 'tool', value: 'write_file' }),
                agent.revokeSessionApproval('a', { kind: 'tool', value: 'edit_file' }),
            ]);
            expect(await agent.getSessionApprovals('a')).toEqual([]);
        } finally {
            await agent.stop();
        }
    });

    it('lists and revokes remembered actions and user tool grants without changing another session', async () => {
        const stores = new InMemoryDextoStores();
        const agent = createAgent(stores);
        await agent.start();
        try {
            await stores
                .getStore('toolPreferences')
                .allowTool({ toolName: 'legacy_tool', sessionId: 'a' });
            await stores.getStore('toolPreferences').allowTool({ toolName: 'global_tool' });
            await agent.setSessionAutoApproveTools('a', ['write_file']);
            await agent.setSessionAutoApproveTools('b', ['write_file']);
            await agent.services.approvalManager.addApprovedKey(
                'bash:git status *',
                'session',
                'a'
            );
            expect(await agent.getSessionApprovals('a')).toEqual([
                { kind: 'tool', value: 'legacy_tool' },
                { kind: 'tool', value: 'write_file' },
                { kind: 'action', value: 'bash:git status *' },
            ]);
            await agent.revokeSessionApproval('a', { kind: 'tool', value: 'write_file' });
            await agent.revokeSessionApproval('a', { kind: 'action', value: 'bash:git status *' });
            await agent.revokeSessionApproval('a', { kind: 'tool', value: 'legacy_tool' });
            expect(await agent.getSessionApprovals('a')).toEqual([]);
            expect(
                await stores.getStore('toolPreferences').isToolAllowed({ toolName: 'global_tool' })
            ).toBe(true);
            expect(await agent.getSessionAutoApproveTools('b')).toEqual(['write_file']);
        } finally {
            await agent.stop();
        }
        const resumed = createAgent(stores);
        await resumed.start();
        try {
            expect(await resumed.getSessionApprovals('a')).toEqual([]);
            expect(await resumed.getSessionAutoApproveTools('b')).toEqual(['write_file']);
        } finally {
            await resumed.stop();
        }
    });
});
