import { expect, it, vi } from 'vitest';
import type { CommandContext } from '../command.js';
import { createOutput } from '../output.js';
import { nodeCloudRuntime } from '../runtime.js';
import { chatMoveCommands } from './chat-move.js';

vi.mock('../../chat-sync/node.js', () => ({
    nodeChatSyncStore: () => ({
        readChat: async () => ({
            status: 'paused',
            reason: 'chat_in_cloud',
            cloudChatId: 'cloud-chat',
            nextIndex: 5,
            sentCount: 5,
            since: '2026-11-06T00:00:00Z',
        }),
        readChatFolder: async () => '/fake/working/tree',
    }),
    startNodeChatSync: async () => {
        throw new Error('must not sync');
    },
}));

async function run(values: Record<string, string | boolean>): Promise<unknown> {
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
        openLocalAgent: async () => {
            throw new Error('must not open agent');
        },
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
    const command = chatMoveCommands.find((item) => item.path[1] === 'move');
    if (command === undefined) throw new Error('Missing move command');
    await command.run(context, { positionals: ['local-chat'], values });
    return JSON.parse(output);
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
