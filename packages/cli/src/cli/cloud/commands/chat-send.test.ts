import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandFailure } from '../../failure.js';
import { UsageError, type CommandContext, type CommandInput } from '../command.js';
import { createOutput } from '../output.js';
import type { CloudRuntime } from '../runtime.js';
import { chatCommands } from './chats.js';
import { WorkspaceToolFailure } from './workspace.js';

const CHAT_ID = '6f1c2a4e-8b3d-4c5a-9e7f-1a2b3c4d5e6f';
const MISSING_CHAT_ID = '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

const query = vi.hoisted(() => vi.fn());
const scopes = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./workspace.js')>()),
    queryWorkspaceTool: query,
}));
vi.mock('./deploys.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./deploys.js')>()),
    requireLoginScopes: scopes,
}));

function command(verb: string) {
    const found = chatCommands.find((each) => each.path.join(' ') === `chat ${verb}`);
    if (found === undefined) throw new Error(`Missing chat ${verb}`);
    return found;
}

function harness(format: 'json' | 'table', prompt: CloudRuntime['prompt'] = null) {
    let stdout = '';
    const runtime = {
        color: false,
        environment: {},
        prompt,
        signal: new AbortController().signal,
        sleep: async () => undefined,
        stdoutIsTerminal: prompt !== null,
        writeError: () => undefined,
        writeOutput: (text: string) => {
            stdout += text;
        },
    } as unknown as CloudRuntime;
    const context = {
        runtime,
        output: createOutput(runtime, format),
        invocation: ['dexto', 'chat'],
    } as unknown as CommandContext;
    return { context, stdout: () => stdout };
}

function input(positionals: string[], values: CommandInput['values'] = {}): CommandInput {
    return { positionals, values };
}

const session = { id: CHAT_ID, title: 'Fix the bug', url: `https://app.dexto.ai/chat/${CHAT_ID}` };
const queued = {
    reply: { delivery: 'queued', queue: 'steer', id: 'input-1', position: 1 },
    session: { ...session, status: 'running' },
};
const followPage = (cursor: string, extra: Record<string, unknown> = {}) => ({
    outcome: 'done',
    running: false,
    cursor,
    hasMore: false,
    session: { id: CHAT_ID },
    events: [],
    answer: 'Done',
    artifacts: [],
    usage: null,
    ...extra,
});

function toolCalls() {
    return query.mock.calls.map((call) => [call[1], call[2]]);
}

beforeEach(() => {
    query.mockReset();
    scopes.mockReset();
});

describe('chat fork', () => {
    it('forks the latest message and returns the new chat', async () => {
        const { context, stdout } = harness('json');
        const result = { session: { ...session, id: 'fork-1' } };
        query.mockResolvedValueOnce(result);
        expect(await command('fork').run(context, input([CHAT_ID], { yes: true }))).toBe(0);
        expect(scopes).toHaveBeenCalledWith(context, ['sessions:write']);
        expect(toolCalls()).toEqual([['dexto_chat_fork', { sessionId: CHAT_ID }]]);
        expect(JSON.parse(stdout())).toEqual(result);
    });

    it('passes the selected message to the fork', async () => {
        const { context } = harness('json');
        query.mockResolvedValueOnce({ session });
        await command('fork').run(context, input([CHAT_ID], { message: 'msg-2', yes: true }));
        expect(toolCalls()).toEqual([
            ['dexto_chat_fork', { sessionId: CHAT_ID, messageId: 'msg-2' }],
        ]);
    });

    it('previews a fork without signing in, asking or calling the tool', async () => {
        const { context, stdout } = harness('json');
        expect(
            await command('fork').run(
                context,
                input([CHAT_ID], { message: 'msg-2', 'dry-run': true })
            )
        ).toBe(0);
        expect(JSON.parse(stdout())).toEqual({
            dry_run: true,
            tool: 'dexto_chat_fork',
            arguments: { sessionId: CHAT_ID, messageId: 'msg-2' },
        });
        expect(scopes).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
    });
});

describe('chat send', () => {
    it('steers by default and maps --model to dexto_chat_send', async () => {
        const { context, stdout } = harness('json');
        query.mockResolvedValueOnce(queued);
        expect(
            await command('send').run(
                context,
                input([CHAT_ID, 'Also update the docs'], { model: 'grok-4', yes: true })
            )
        ).toBe(0);
        expect(scopes).toHaveBeenCalledWith(context, ['sessions:write']);
        expect(toolCalls()).toEqual([
            [
                'dexto_chat_send',
                {
                    sessionId: CHAT_ID,
                    message: 'Also update the docs',
                    queue: 'steer',
                    model: 'grok-4',
                },
            ],
        ]);
        expect(JSON.parse(stdout())).toEqual(queued);
    });

    it('queues with --follow-up and says so', async () => {
        const { context, stdout } = harness('table');
        query.mockResolvedValueOnce({
            ...queued,
            reply: { ...queued.reply, queue: 'follow-up' },
        });
        await command('send').run(
            context,
            input([CHAT_ID, 'Then open a PR'], { 'follow-up': true, yes: true })
        );
        expect(query.mock.calls[0]?.[2]).toMatchObject({ queue: 'follow-up' });
        expect(stdout()).toContain('Sent to Fix the bug. Queued for after its current work.');
    });

    it('reports a continued idle chat as its next turn', async () => {
        const { context, stdout } = harness('table');
        query.mockResolvedValueOnce({
            status: 'accepted',
            replayed: false,
            run: { id: 'run-2' },
            session,
        });
        await command('send').run(context, input([CHAT_ID, 'Next step'], { yes: true }));
        expect(stdout()).toContain('It started its next turn.');
    });

    it('fails when the chat started another turn before the message arrived', async () => {
        const { context } = harness('json');
        query.mockResolvedValueOnce({ status: 'active', session, nextAction: 'Use send.' });
        await expect(
            command('send').run(context, input([CHAT_ID, 'Next step'], { yes: true }))
        ).rejects.toMatchObject({ kind: 'failed', message: expect.stringContaining('Not sent') });
    });

    it('refuses without --yes when it cannot ask, naming --yes, and sends nothing', async () => {
        const { context } = harness('table');
        const refused = command('send').run(context, input([CHAT_ID, 'Hi']));
        await expect(refused).rejects.toBeInstanceOf(CommandFailure);
        await expect(refused).rejects.toMatchObject({
            kind: 'needs_confirmation',
            message: expect.stringContaining('--yes'),
        });
        expect(query).not.toHaveBeenCalled();
    });

    it('requires --yes under --json even at a terminal', async () => {
        const prompt = vi.fn(async () => 'yes');
        const { context } = harness('json', prompt);
        await expect(command('send').run(context, input([CHAT_ID, 'Hi']))).rejects.toMatchObject({
            kind: 'needs_confirmation',
        });
        expect(prompt).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
    });

    it('rejects --wait with --follow-up before sending', async () => {
        const { context } = harness('json');
        await expect(
            command('send').run(
                context,
                input([CHAT_ID, 'Hi'], { wait: true, 'follow-up': true, yes: true })
            )
        ).rejects.toBeInstanceOf(UsageError);
        expect(query).not.toHaveBeenCalled();
    });

    it('--wait reads the latest cursor, sends once, then prints only events after it', async () => {
        const { context, stdout } = harness('json');
        query
            .mockResolvedValueOnce(followPage('chat-1:100', { hasMore: true }))
            .mockResolvedValueOnce(followPage('chat-1:140'))
            .mockResolvedValueOnce(queued)
            .mockResolvedValueOnce(
                followPage('chat-1:142', {
                    events: [{ sequence: 141 }, { sequence: 142 }],
                    answer: 'Docs updated',
                })
            );
        expect(
            await command('send').run(
                context,
                input([CHAT_ID, 'Docs too'], { wait: true, yes: true })
            )
        ).toBe(0);
        expect(scopes).toHaveBeenCalledWith(context, ['sessions:write', 'sessions:read']);
        expect(toolCalls()).toEqual([
            ['dexto_chat_follow', { sessionId: CHAT_ID, waitSeconds: 0 }],
            ['dexto_chat_follow', { sessionId: CHAT_ID, cursor: 'chat-1:100', waitSeconds: 0 }],
            ['dexto_chat_send', { sessionId: CHAT_ID, message: 'Docs too', queue: 'steer' }],
            [
                'dexto_chat_follow',
                expect.objectContaining({ sessionId: CHAT_ID, cursor: 'chat-1:140' }),
            ],
        ]);
        const lines = stdout()
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(lines.map((line) => line.type)).toEqual(['event', 'event', 'final']);
        expect(lines.at(-1)).toMatchObject({ outcome: 'done', answer: 'Docs updated' });
    });

    it('--wait never sends again when the read after the send fails', async () => {
        const { context, stdout } = harness('json');
        query
            .mockResolvedValueOnce(followPage('chat-1:7'))
            .mockResolvedValueOnce(queued)
            .mockRejectedValueOnce(new CommandFailure('failed', 'Read failed.', null));
        expect(
            await command('send').run(context, input([CHAT_ID, 'Hi'], { wait: true, yes: true }))
        ).toBe(1);
        expect(query.mock.calls.filter((call) => call[1] === 'dexto_chat_send')).toHaveLength(1);
        expect(JSON.parse(stdout().trim())).toMatchObject({
            type: 'final',
            outcome: 'error',
            nextAction: {
                tool: 'dexto_chat_follow',
                arguments: { sessionId: CHAT_ID, cursor: 'chat-1:7' },
            },
        });
    });
});

describe('chat cancel', () => {
    it('stops the active run and reports it', async () => {
        const { context, stdout } = harness('json');
        const stopped = { run: { id: 'run-1', status: 'cancelled' }, session };
        query.mockResolvedValueOnce(stopped);
        expect(await command('cancel').run(context, input([CHAT_ID], { yes: true }))).toBe(0);
        expect(scopes).toHaveBeenCalledWith(context, ['sessions:write']);
        expect(toolCalls()).toEqual([['dexto_chat_cancel', { sessionId: CHAT_ID }]]);
        expect(JSON.parse(stdout())).toEqual({ cancelled: true, ...stopped });
    });

    it('returns a clean result when no run is active', async () => {
        const { context, stdout } = harness('json');
        query.mockRejectedValueOnce(
            new WorkspaceToolFailure(
                new CommandFailure('failed', 'Dexto session does not have an active run.', null),
                { kind: 'unavailable', retryable: false, resume: null }
            )
        );
        expect(await command('cancel').run(context, input([CHAT_ID], { yes: true }))).toBe(0);
        expect(JSON.parse(stdout())).toEqual({ cancelled: false, session: { id: CHAT_ID } });
    });

    it('still fails for a chat that does not exist', async () => {
        const { context } = harness('json');
        query.mockRejectedValueOnce(
            new WorkspaceToolFailure(
                new CommandFailure('not_found', 'Dexto session was not found.', null),
                { kind: 'not_found', retryable: false, resume: null }
            )
        );
        await expect(
            command('cancel').run(context, input([MISSING_CHAT_ID], { yes: true }))
        ).rejects.toMatchObject({ kind: 'not_found' });
    });

    it('refuses without --yes when it cannot ask', async () => {
        const { context } = harness('table');
        await expect(command('cancel').run(context, input([CHAT_ID]))).rejects.toMatchObject({
            kind: 'needs_confirmation',
            message: expect.stringContaining('--yes'),
        });
        expect(query).not.toHaveBeenCalled();
    });
});
