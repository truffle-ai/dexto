import { beforeEach, expect, it, vi } from 'vitest';
import type { CommandContext } from '../command.js';
import { createOutput } from '../output.js';
import { nodeCloudRuntime } from '../runtime.js';
import { chatMoveCommands } from './chat-move.js';

const { readChat, writeChat, queryWorkspaceTool, readCheckpoint, moveToCloud } = vi.hoisted(() => ({
    readChat: vi.fn(),
    writeChat: vi.fn(),
    queryWorkspaceTool: vi.fn(),
    readCheckpoint: vi.fn(),
    moveToCloud: vi.fn(),
}));
vi.mock('../../chat-sync/move.js', async (original) => {
    const actual = await original<typeof import('../../chat-sync/move.js')>();
    moveToCloud.mockImplementation(actual.moveToCloud);
    return { ...actual, moveToCloud };
});
vi.mock('./workspace.js', () => ({ queryWorkspaceTool }));

beforeEach(() => {
    readCheckpoint.mockRejectedValue(
        Object.assign(new Error('missing fixture checkpoint'), { code: 'ENOENT' })
    );
    readChat.mockResolvedValue({
        status: 'paused',
        reason: 'chat_in_cloud',
        cloudChatId: 'cloud-chat',
        nextIndex: 5,
        sentCount: 5,
        since: '2026-11-06T00:00:00Z',
    });
    writeChat.mockReset();
    queryWorkspaceTool.mockReset();
    moveToCloud.mockClear();
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
    readFile: readCheckpoint,
    writeFile: vi.fn(),
    rename: vi.fn(),
}));
vi.mock('../../chat-sync/return-tree.js', async (original) => ({
    ...(await original<typeof import('../../chat-sync/return-tree.js')>()),
    assertLocalTreeMatches: async () => undefined,
}));
vi.mock('../../chat-sync/working-tree.js', async (original) => ({
    ...(await original<typeof import('../../chat-sync/working-tree.js')>()),
    buildWorkingTree: async () => ({
        repository: '/fake/working/tree',
        branch: 'main',
        head_commit: 'a'.repeat(40),
        bundle: Buffer.alloc(2048),
        patch: Buffer.alloc(512),
        changedFiles: 3,
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
    return { context, output: () => JSON.parse(output), rawOutput: () => output };
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

it('explains how to move a chat that has never had a cloud hand-off', async () => {
    await expect(run({ to: 'local' })).rejects.toMatchObject({
        kind: 'invalid_input',
        fix: 'dexto chat move local-chat --to cloud',
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
        command.run(h.context, { positionals: ['local-chat'], values: { to: 'cloud', yes: true } })
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
        command.run(context, { positionals: ['local-chat'], values: { to: 'cloud', yes: true } })
    ).rejects.toMatchObject({ status: 429 });
    expect(writeChat).toHaveBeenCalledTimes(2);
    expect(writeChat.mock.calls[1]?.[2]).toEqual({
        status: 'syncing',
        cloudChatId: 'cloud-chat',
        nextIndex: 5,
        sentCount: 5,
    });
});

it('watches through a transient failure and prints changed messages as one-line NDJSON', async () => {
    const h = harness(false);
    const controller = new AbortController();
    queryWorkspaceTool
        .mockRejectedValueOnce(new TypeError('temporary disconnect'))
        .mockResolvedValueOnce({ messages: [{ id: 'message', role: 'assistant', text: 'hello' }] })
        .mockResolvedValueOnce({
            messages: [{ id: 'message', role: 'assistant', text: 'hello again' }],
        });
    const context = {
        ...h.context,
        runtime: {
            ...h.context.runtime,
            signal: controller.signal,
            sleep: async () => {
                if (queryWorkspaceTool.mock.calls.length >= 3) controller.abort();
            },
        },
    };
    const watch = chatMoveCommands.find((command) => command.path[1] === 'watch');
    if (watch === undefined) throw new Error('Missing watch command');
    await watch.run(context, { positionals: ['local-chat'], values: {} });
    const rows = h
        .rawOutput()
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ event: 'message', delta: 'hello' });
    expect(rows[1]).toMatchObject({ event: 'message', delta: ' again' });
});

for (const status of [429, 403]) {
    for (const prior of ['paused', 'syncing']) {
        for (const stage of ['start', 'read', 'cancel', 'restart']) {
            if (prior === 'syncing' && stage === 'start') continue;
            it(`keeps ${prior} ownership uncertain after ${status} during ${stage}`, async () => {
                readChat.mockResolvedValue({
                    status: prior,
                    reason: 'move_in_progress',
                    cloudChatId: 'cloud-chat',
                    nextIndex: 5,
                    sentCount: 5,
                });
                readCheckpoint.mockResolvedValue(
                    JSON.stringify({
                        phase: 'cloud',
                        branch: 'main',
                        head: 'a'.repeat(40),
                        patchHash: 'fake',
                    })
                );
                const h = harness(false);
                let calls = 0;
                const fetch: typeof globalThis.fetch = async () => {
                    calls += 1;
                    const failureAt =
                        stage === 'start' ? 1 : stage === 'read' ? 2 : stage === 'cancel' ? 3 : 4;
                    if (calls === failureAt)
                        return Response.json(
                            {
                                error: {
                                    code: status === 429 ? 'rate_limited' : 'forbidden',
                                    message: 'fake refusal',
                                    retryable: false,
                                },
                            },
                            { status }
                        );
                    if (calls === 1)
                        return Response.json(
                            {
                                error: {
                                    code: 'move_in_progress',
                                    message: 'open move',
                                    details: { move_id: 'open' },
                                    retryable: false,
                                },
                            },
                            { status: 409 }
                        );
                    return Response.json({
                        id: 'open',
                        to: 'cloud',
                        status: calls === 2 ? 'awaiting_upload' : 'canceled',
                        uploads: [],
                    });
                };
                const command = chatMoveCommands.find((item) => item.path[1] === 'move');
                if (command === undefined) throw new Error('Missing move command');
                await expect(
                    command.run(
                        { ...h.context, runtime: { ...h.context.runtime, fetch } },
                        { positionals: ['local-chat'], values: { to: 'cloud', yes: true } }
                    )
                ).rejects.toMatchObject({ status });
                expect(calls).toBe(
                    stage === 'start' ? 1 : stage === 'read' ? 2 : stage === 'cancel' ? 3 : 4
                );
                expect(writeChat.mock.calls.map((call) => call[2].status)).toEqual(['paused']);
            });
        }
    }
}

it.each([
    { status: 429, retryAfter: '3', expectedDelay: 3_000 },
    { status: 503, retryAfter: null, expectedDelay: 2_000 },
])(
    'keeps watching after MCP HTTP $status with the server retry delay',
    async ({ status, retryAfter, expectedDelay }) => {
        const workspace = await vi.importActual<typeof import('./workspace.js')>('./workspace.js');
        queryWorkspaceTool.mockImplementation(workspace.queryWorkspaceTool);
        const h = harness(false);
        const controller = new AbortController();
        let calls = 0;
        const delays: number[] = [];
        const context = {
            ...h.context,
            runtime: {
                ...h.context.runtime,
                signal: controller.signal,
                fetch: async () => {
                    calls += 1;
                    if (calls === 1)
                        return new Response('temporary MCP refusal', {
                            status,
                            headers: retryAfter === null ? {} : { 'Retry-After': retryAfter },
                        });
                    return Response.json({
                        jsonrpc: '2.0',
                        id: 1,
                        result: {
                            content: [],
                            structuredContent: {
                                messages: [
                                    { id: 'message', role: 'assistant', text: 'still attached' },
                                ],
                            },
                        },
                    });
                },
                sleep: async (delay: number) => {
                    delays.push(delay);
                    if (calls === 2) controller.abort();
                },
            },
        };
        const watch = chatMoveCommands.find((command) => command.path[1] === 'watch');
        if (watch === undefined) throw new Error('Missing watch command');
        await watch.run(context, { positionals: ['local-chat'], values: {} });
        expect(calls).toBe(2);
        expect(delays).toEqual([expectedDelay, 2_000]);
        expect(JSON.parse(h.rawOutput())).toMatchObject({
            event: 'message',
            delta: 'still attached',
        });
    }
);

const SUMMARY =
    'Upload /fake/working/tree (branch main, 3 changed or untracked files, 2.5 KiB) to the cloud computer.';

function syncingChat(): void {
    readChat.mockResolvedValue({
        status: 'syncing',
        cloudChatId: 'cloud-chat',
        nextIndex: 5,
        sentCount: 5,
    });
}

function terminalHarness(answer: string | null) {
    const h = harness(false);
    let errors = '';
    const questions: string[] = [];
    const runtime = {
        ...h.context.runtime,
        stdoutIsTerminal: true,
        writeError: (text: string) => {
            errors += text;
        },
        prompt:
            answer === null
                ? null
                : async (question: string) => {
                      questions.push(question);
                      return answer;
                  },
    };
    const context: CommandContext = {
        ...h.context,
        runtime,
        output: createOutput(runtime, 'table'),
        invocation: ['chat', 'move', 'local-chat', '--to', 'cloud'],
    };
    return { context, errors: () => errors, questions };
}

function moveCommand() {
    const command = chatMoveCommands.find((item) => item.path[1] === 'move');
    if (command === undefined) throw new Error('Missing move command');
    return command;
}

it('asks with a one-line summary and leaves the chat local when the person declines', async () => {
    syncingChat();
    const t = terminalHarness('n');
    await expect(
        moveCommand().run(t.context, { positionals: ['local-chat'], values: { to: 'cloud' } })
    ).rejects.toMatchObject({ kind: 'needs_confirmation', message: 'Not done.' });
    expect(t.questions).toEqual([`${SUMMARY} Go ahead? [y/N] `]);
    expect(writeChat).not.toHaveBeenCalled();
    expect(moveToCloud).not.toHaveBeenCalled();
});

it('uploads after the person answers y', async () => {
    syncingChat();
    moveToCloud.mockResolvedValueOnce(undefined);
    const t = terminalHarness('y');
    await moveCommand().run(t.context, {
        positionals: ['local-chat'],
        values: { to: 'cloud', detach: true },
    });
    expect(t.questions).toHaveLength(1);
    expect(moveToCloud).toHaveBeenCalledTimes(1);
});

it('prints the summary and skips the prompt with --yes', async () => {
    syncingChat();
    moveToCloud.mockResolvedValueOnce(undefined);
    const t = terminalHarness('n');
    await moveCommand().run(t.context, {
        positionals: ['local-chat'],
        values: { to: 'cloud', detach: true, yes: true },
    });
    expect(t.questions).toEqual([]);
    expect(t.errors()).toBe(`${SUMMARY}\n`);
    expect(moveToCloud).toHaveBeenCalledTimes(1);
});

it('fails without prompting in a non-interactive terminal run that lacks --yes', async () => {
    syncingChat();
    const t = terminalHarness(null);
    await expect(
        moveCommand().run(t.context, { positionals: ['local-chat'], values: { to: 'cloud' } })
    ).rejects.toMatchObject({
        kind: 'needs_confirmation',
        message: `${SUMMARY} Run it again with --yes once your person has agreed.`,
        fix: 'dexto chat move local-chat --to cloud --yes',
    });
    expect(writeChat).not.toHaveBeenCalled();
    expect(moveToCloud).not.toHaveBeenCalled();
});

it('never prompts in JSON mode: without --yes it fails before pausing or uploading', async () => {
    syncingChat();
    const h = harness(false);
    const prompt = vi.fn(async () => 'y');
    const context = {
        ...h.context,
        runtime: { ...h.context.runtime, prompt },
        invocation: ['chat', 'move', 'local-chat', '--to', 'cloud', '--json'],
    };
    await expect(
        moveCommand().run(context, { positionals: ['local-chat'], values: { to: 'cloud' } })
    ).rejects.toMatchObject({
        kind: 'needs_confirmation',
        message: `${SUMMARY} Run it again with --yes once your person has agreed.`,
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(writeChat).not.toHaveBeenCalled();
    expect(moveToCloud).not.toHaveBeenCalled();
});

it('moves in JSON mode with --yes and reports the hand-off in the result', async () => {
    syncingChat();
    moveToCloud.mockResolvedValueOnce(undefined);
    const h = harness(false);
    await moveCommand().run(h.context, {
        positionals: ['local-chat'],
        values: { to: 'cloud', yes: true },
    });
    expect(h.output()).toEqual({
        id: 'local-chat',
        location: 'cloud',
        attached: false,
        handOff: {
            repository: '/fake/working/tree',
            branch: 'main',
            changedFiles: 3,
            totalBytes: 2560,
        },
    });
    expect(writeChat.mock.calls.map((call) => call[2].reason)).toEqual([
        'move_in_progress',
        'chat_in_cloud',
    ]);
});

it('reports the hand-off plan on a dry run without asking', async () => {
    syncingChat();
    expect(await run({ to: 'cloud', 'dry-run': true })).toMatchObject({
        dryRun: true,
        repository: '/fake/working/tree',
        branch: 'main',
        changedFiles: 3,
        totalBytes: 2560,
    });
    expect(moveToCloud).not.toHaveBeenCalled();
});
