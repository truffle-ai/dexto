import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentConfigSchema } from '@dexto/agent-config';
import { DextoAgent, InMemoryDextoStores, createLogger } from '@dexto/core';
import type { TuiRuntimeServices } from '@dexto/tui';
import type { CloudHost } from '../cloud/run.js';
import { HELD_COMMANDS } from '../cloud/held-commands.js';
import type { MainModeContext } from './context.js';

const applyWorkspaceToAgent = vi.fn();
let runCliMode: typeof import('./cli.js').runCliMode;

const captured = vi.hoisted(() => {
    const value: { services: TuiRuntimeServices | null } = { services: null };
    return value;
});
const { startSync, runCloudCommand } = vi.hoisted(() => ({
    startSync: vi.fn(),
    runCloudCommand: vi.fn(),
}));
vi.mock('../cloud/run.js', () => ({ runCloud: runCloudCommand }));
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
    startNodeChatSync: startSync,
}));
vi.mock('../../config/cli-overrides.js', () => ({ hasUsableCredentials: () => true }));

afterEach(() => vi.unstubAllEnvs());

function installedServices(): TuiRuntimeServices {
    const services = captured.services;
    if (services === null) throw new Error('TUI services were not installed.');
    return services;
}

function testContext(): MainModeContext {
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
    return {
        agent,
        opts: {},
        workspaceRoot: '/tmp',
        validatedConfig: config,
        resolvedPath: '/tmp/fake.yml',
        initialPrompt: undefined,
        getVersionCheckResult: async () => null,
    };
}

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
        startSync.mockReset();
        runCloudCommand.mockReset();
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
        const context = testContext();
        const stream = vi.spyOn(context.agent, 'stream');
        await runCliMode(context);
        const services = installedServices();
        const guard = services.assertLocalChat;
        if (guard === undefined) throw new Error('Missing local ownership guard');
        await expect(guard('cloud-owned-chat')).rejects.toThrow('cloud computer');
        // While hand-off is held, the way out is chat watch, never the held /local.
        if (HELD_COMMANDS.has('chat move'))
            await expect(guard('cloud-owned-chat')).rejects.toThrow(
                /dexto chat watch cloud-owned-chat(?!.*\/local)/u
            );
        expect(services.chatSync).toBeUndefined();
        expect(stream).not.toHaveBeenCalled();
        expect(startSync).not.toHaveBeenCalled();
    }, 20_000);

    it.runIf(HELD_COMMANDS.has('chat move'))(
        'holds /cloud and /local with chat move: /sync and /private stay',
        async () => {
            vi.stubEnv('DEXTO_FEATURE_AUTH', 'true');
            vi.stubEnv('DEXTO_LLM_REGISTRY_DISABLE_FETCH', '1');
            applyWorkspaceToAgent.mockResolvedValue(undefined);
            startSync.mockResolvedValue({
                engine: { sync: async () => undefined },
                start: async () => undefined,
                command: async () => '',
                onNotice: () => () => undefined,
                stop: () => undefined,
            });
            await runCliMode(testContext());
            const services = installedServices();
            expect(services?.chatSync).toBeDefined();
            expect(services?.chatMove).toBeUndefined();
            expect(services !== null && 'abortChatMove' in services).toBe(false);
        },
        20_000
    );

    it.skipIf(HELD_COMMANDS.has('chat move'))(
        'aborts an interactive hand-off through the Ctrl-C host hook',
        async () => {
            vi.stubEnv('DEXTO_FEATURE_AUTH', 'true');
            vi.stubEnv('DEXTO_LLM_REGISTRY_DISABLE_FETCH', '1');
            applyWorkspaceToAgent.mockResolvedValue(undefined);
            startSync.mockResolvedValue({
                engine: { sync: async () => undefined },
                start: async () => undefined,
                command: async () => '',
                onNotice: () => () => undefined,
                stop: () => undefined,
            });
            runCloudCommand.mockImplementation(async (host: CloudHost) => {
                if (!host.runtime.signal.aborted)
                    await new Promise<void>((resolve) =>
                        host.runtime.signal.addEventListener('abort', () => resolve(), {
                            once: true,
                        })
                    );
                return 1;
            });
            await runCliMode(testContext());
            const services = installedServices();
            if (
                services === null ||
                services.chatMove === undefined ||
                !('abortChatMove' in services) ||
                typeof services.abortChatMove !== 'function'
            )
                throw new Error('Missing hand-off abort hook');
            const moving = expect(services.chatMove('cloud', 'chat')).rejects.toBeInstanceOf(Error);
            expect(services.abortChatMove()).toBe(true);
            expect(services.abortChatMove()).toBe(false);
            await moving;
            expect(services.abortChatMove()).toBe(false);
        },
        20_000
    );
});
