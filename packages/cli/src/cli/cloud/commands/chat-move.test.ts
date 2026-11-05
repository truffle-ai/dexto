import { beforeEach, expect, it, vi } from 'vitest';
import type { CommandContext } from '../command.js';
import { createOutput } from '../output.js';
import { nodeCloudRuntime } from '../runtime.js';
import { chatMoveCommands } from './chat-move.js';

const { readChat, writeChat } = vi.hoisted(() => ({ readChat: vi.fn(), writeChat: vi.fn() }));

beforeEach(() => {
    readChat.mockResolvedValue({
        status: 'paused',
        reason: 'chat_in_cloud',
        cloudChatId: 'cloud-chat',
        nextIndex: 5,
        sentCount: 5,
        since: '2026-11-06T00:00:00Z',
    });
    writeChat.mockReset();
});

vi.mock('../../chat-sync/node.js', () => ({
    nodeChatSyncStore: () => ({
        readChat,
        writeChat,
        readChatFolder: async () => '/fake/working/tree',
    }),
    startNodeChatSync: async () => {
        throw new Error('must not sync');
    },
}));
vi.mock('node:fs/promises', async (original) => ({
    ...(await original<typeof import('node:fs/promises')>()),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
}));
vi.mock('../../chat-sync/working-tree.js', async (original) => ({
    ...(await original<typeof import('../../chat-sync/working-tree.js')>()),
    buildWorkingTree: async () => ({
        branch: 'main',
        head_commit: 'a'.repeat(40),
        bundle: Buffer.from('fake bundle'),
        patch: null,
        cleanup: async () => undefined,
    }),
}));

function harness(withAgent: boolean) {
    let output = '';
    const runtime = {
        ...nodeCloudRuntime(new AbortController().signal),
        stdoutIsTerminal: false,
        writeOutput: (text: string) => {
            output += text;
        },
        fetch: async () => {
            throw new Error('must not call server');
        },
    };
    const context: CommandContext = {
        runtime,
        output: createOutput(runtime, 'json'),
        invocation: [],
        overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
        ...(withAgent
            ? {
                  openLocalAgent: async () => {
                      throw new Error('must not open agent');
                  },
              }
            : {}),
        client: async () => {
            throw new Error('must not call server');
        },
        connection: async () => ({
            kind: 'oauth',
            source: 'login',
            profile: 'default',
            apiBaseUrl: 'https://api.invalid',
            token: 'fake',
            cloudProject: null,
            login: {
                kind: 'oauth',
                accessToken: 'fake',
                refreshToken: 'fake',
                clientId: 'test',
                appUrl: 'https://app.invalid',
                apiBaseUrl: 'https://api.invalid',
                resource: 'https://app.invalid/mcp',
                tokenEndpoint: 'https://app.invalid/token',
                scopes: ['chats:sync'],
                savedAt: '2026-11-06T00:00:00Z',
                expiresAt: '2099-01-01T00:00:00Z',
                signedInAs: null,
                cloudProject: null,
            },
        }),
    };
    return { context, output: () => JSON.parse(output) };
}

async function run(values: Record<string, string | boolean>): Promise<unknown> {
    const h = harness(true);
    const command = chatMoveCommands.find((item) => item.path[1] === 'move');
    if (command === undefined) throw new Error('Missing move command');
    await command.run(h.context, { positionals: ['local-chat'], values });
    return h.output();
}

it('plans a local return without syncing, opening the agent or mutating the server', async () => {
    expect(await run({ to: 'local', 'dry-run': true })).toMatchObject({
        dryRun: true,
        to: 'local',
        folder: '/fake/working/tree',
    });
});

it('treats a repeated JSON move to cloud as already complete without uploading again', async () => {
    expect(await run({ to: 'cloud' })).toEqual({
        id: 'local-chat',
        location: 'cloud',
        alreadyThere: true,
    });
});

it('pauses local execution before a start request whose response is lost', async () => {
    readChat.mockResolvedValue({
        status: 'syncing',
        cloudChatId: 'cloud-chat',
        nextIndex: 5,
        sentCount: 5,
    });
    const h = harness(false);
    const command = chatMoveCommands.find((item) => item.path[1] === 'move');
    if (command === undefined) throw new Error('Missing move command');
    await expect(
        command.run(h.context, { positionals: ['local-chat'], values: { to: 'cloud' } })
    ).rejects.toMatchObject({ kind: 'failed', fix: 'dexto chat move local-chat --to local' });
    expect(writeChat).toHaveBeenCalledTimes(1);
    expect(writeChat.mock.calls[0]?.[2]).toMatchObject({
        status: 'paused',
        reason: 'move_in_progress',
    });
});

it('restores local execution after a confirmed start refusal', async () => {
    readChat.mockResolvedValue({
        status: 'syncing',
        cloudChatId: 'cloud-chat',
        nextIndex: 5,
        sentCount: 5,
    });
    const h = harness(false);
    const context = {
        ...h.context,
        runtime: {
            ...h.context.runtime,
            fetch: async () =>
                Response.json(
                    {
                        error: {
                            code: 'rate_limited',
                            message: 'fake refusal',
                            requestId: null,
                            retryable: true,
                        },
                    },
                    { status: 429 }
                ),
        },
    };
    const command = chatMoveCommands.find((item) => item.path[1] === 'move');
    if (command === undefined) throw new Error('Missing move command');
    await expect(
        command.run(context, { positionals: ['local-chat'], values: { to: 'cloud' } })
    ).rejects.toMatchObject({ status: 429 });
    expect(writeChat).toHaveBeenCalledTimes(2);
    expect(writeChat.mock.calls[1]?.[2]).toEqual({
        status: 'syncing',
        cloudChatId: 'cloud-chat',
        nextIndex: 5,
        sentCount: 5,
    });
});
