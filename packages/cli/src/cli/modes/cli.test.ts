import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentConfigSchema } from '@dexto/agent-config';
import { DextoAgent, InMemoryDextoStores, createLogger } from '@dexto/core';
import type { TuiRuntimeServices } from '@dexto/tui';
import type { MainModeContext } from './context.js';

const applyWorkspaceToAgent = vi.fn();
let runCliMode: typeof import('./cli.js').runCliMode;

const captured = vi.hoisted(() => {
    const value: { services: TuiRuntimeServices | null } = { services: null };
    return value;
});
vi.mock('@dexto/tui', () => ({
    startInkCliRefactored: async () => undefined,
    setTuiRuntimeServices: (services: TuiRuntimeServices) => {
        captured.services = services;
    },
}));
vi.mock('../chat-sync/node.js', () => ({
    nodeChatSyncStore: () => ({
        listAccounts: async () => ['account'],
        readChat: async () => ({ status: 'paused', reason: 'chat_in_cloud' }),
    }),
    startNodeChatSync: () => {
        throw new Error('auth-disabled chat sync must not start');
    },
}));
vi.mock('../../config/cli-overrides.js', () => ({ hasUsableCredentials: () => true }));

afterEach(() => vi.unstubAllEnvs());

vi.mock('../../utils/workspace.js', () => ({
    applyWorkspaceToAgent,
}));

vi.mock('../../analytics/wrapper.js', () => ({
    ExitSignal: class ExitSignal extends Error {},
    safeExit: vi.fn(),
}));

describe('runCliMode', () => {
    beforeAll(async () => {
        ({ runCliMode } = await import('./cli.js'));
    }, 20_000);

    beforeEach(() => {
        vi.resetModules();
        applyWorkspaceToAgent.mockReset();
    });

    it('stops the agent when workspace application fails after startup', async () => {
        applyWorkspaceToAgent.mockRejectedValue(new Error('workspace sync failed'));

        const agent = {
            start: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
        };

        const context = {
            agent,
            opts: {},
            workspaceRoot: '/tmp/dexto-cloud',
            validatedConfig: {
                permissions: { mode: 'auto' },
                elicitation: { enabled: false },
            },
            resolvedPath: '/tmp/dexto-cloud/agent.yml',
            initialPrompt: undefined,
            getVersionCheckResult: vi.fn().mockResolvedValue(null),
        } as unknown as MainModeContext;
        await expect(runCliMode(context)).rejects.toThrow('workspace sync failed');
        expect(agent.start).toHaveBeenCalledOnce();
        expect(applyWorkspaceToAgent).toHaveBeenCalledWith(agent, '/tmp/dexto-cloud');
        expect(agent.stop).toHaveBeenCalledOnce();
    }, 15_000);

    it('installs the persisted ownership guard even with auth disabled', async () => {
        vi.stubEnv('DEXTO_FEATURE_AUTH', 'false');
        vi.stubEnv('DEXTO_LLM_REGISTRY_DISABLE_FETCH', '1');
        applyWorkspaceToAgent.mockResolvedValue(undefined);
        captured.services = null;
        const config = AgentConfigSchema.parse({
            systemPrompt: 'Test',
            llm: { provider: 'openai', model: 'gpt-5', apiKey: 'fake-test-key' },
            permissions: { mode: 'auto-approve' },
            elicitation: { enabled: false },
        });
        const agent = new DextoAgent({
            agentId: 'ownership-test',
            systemPrompt: 'Test',
            llm: { provider: 'openai', model: 'gpt-5', apiKey: 'fake-test-key' },
            permissions: { mode: 'auto-approve' },
            elicitation: { enabled: false },
            stores: new InMemoryDextoStores(),
            logger: createLogger({
                agentId: 'ownership-test',
                config: { level: 'error', transports: [{ type: 'silent' }] },
            }),
        });
        const stream = vi.spyOn(agent, 'stream');
        await runCliMode({
            agent,
            opts: {},
            workspaceRoot: '/tmp',
            validatedConfig: config,
            resolvedPath: '/tmp/fake.yml',
            initialPrompt: undefined,
            getVersionCheckResult: async () => null,
        });
        const guard = captured.services?.assertLocalChat;
        if (guard === undefined) throw new Error('Missing local ownership guard');
        await expect(guard('cloud-owned-chat')).rejects.toThrow('cloud computer');
        expect(captured.services?.chatSync).toBeUndefined();
        expect(stream).not.toHaveBeenCalled();
    }, 20_000);
});
