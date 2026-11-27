import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandFailure } from '../../failure.js';
import { type CommandContext, type CommandInput } from '../command.js';
import { createOutput } from '../output.js';
import type { CloudRuntime } from '../runtime.js';
import { chatCommands } from './chats.js';
import { WorkspaceToolFailure } from './workspace.js';

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

const command = chatCommands.find((each) => each.path.join(' ') === 'chat continue');

function harness(format: 'json' | 'table') {
    let stdout = '';
    const runtime = {
        color: false,
        environment: {},
        prompt: null,
        signal: new AbortController().signal,
        sleep: async () => undefined,
        stdoutIsTerminal: false,
        writeError: () => undefined,
        writeOutput: (text: string) => {
            stdout += text;
        },
    } as unknown as CloudRuntime;
    const context = {
        runtime,
        output: createOutput(runtime, format),
        invocation: ['chat', 'continue', 'chat-1', 'Next step', '--yes'],
    } as unknown as CommandContext;
    return { context, stdout: () => stdout };
}

function input(values: CommandInput['values'] = {}): CommandInput {
    return { positionals: ['chat-1', 'Next step'], values: { yes: true, ...values } };
}

function run(context: CommandContext, values: CommandInput['values'] = {}) {
    if (command === undefined) throw new Error('Missing chat continue');
    return command.run(context, input(values));
}

const session = { id: 'chat-1', title: 'Fix the bug', url: 'https://app.dexto.ai/chat/chat-1' };
const accepted = {
    status: 'accepted',
    replayed: false,
    run: { id: 'run-2', status: 'queued' },
    session,
    nextAction: 'Read progress with dexto_chat_get.',
};

function sentKey(): unknown {
    return query.mock.calls[0]?.[2]?.idempotencyKey;
}

beforeEach(() => {
    query.mockReset();
    scopes.mockReset();
});

describe('chat continue', () => {
    it('forwards the chat, message, model and key to dexto_chat_continue', async () => {
        const { context, stdout } = harness('json');
        query.mockResolvedValueOnce(accepted);
        expect(await run(context, { model: 'grok-4', 'idempotency-key': 'next-1' })).toBe(0);
        expect(scopes).toHaveBeenCalledWith(context, ['sessions:write']);
        expect(query.mock.calls.map((call) => [call[1], call[2]])).toEqual([
            [
                'dexto_chat_continue',
                {
                    sessionId: 'chat-1',
                    message: 'Next step',
                    idempotencyKey: 'next-1',
                    model: 'grok-4',
                },
            ],
        ]);
        expect(JSON.parse(stdout())).toEqual({ ...accepted, idempotencyKey: 'next-1' });
    });

    it('picks a key when none is given and prints it for a retry', async () => {
        const { context, stdout } = harness('table');
        query.mockResolvedValueOnce(accepted);
        await run(context);
        const key = sentKey();
        expect(key).toMatch(/^cli-[0-9a-f-]{36}$/u);
        expect(query.mock.calls[0]?.[2]).not.toHaveProperty('model');
        expect(stdout()).toContain('Continued Fix the bug: run run-2.');
        expect(stdout()).toContain('dexto chat follow chat-1');
        expect(stdout()).toContain(`Idempotency key: ${String(key)}`);
    });

    it('says when the key replayed a continuation that was already accepted', async () => {
        const { context, stdout } = harness('table');
        query.mockResolvedValueOnce({ ...accepted, replayed: true });
        await run(context, { 'idempotency-key': 'next-1' });
        expect(stdout()).toContain('Already continued with this key');
    });

    it('fails on a running chat, printing its status and next action under --json', async () => {
        const { context, stdout } = harness('json');
        const active = {
            status: 'active',
            session: { ...session, status: 'running' },
            nextAction: 'Use dexto_chat_send for a queued steer.',
        };
        query.mockResolvedValueOnce(active);
        await expect(run(context, { 'idempotency-key': 'next-1' })).rejects.toMatchObject({
            kind: 'conflict',
            message: expect.stringContaining('dexto chat send'),
        });
        expect(JSON.parse(stdout())).toEqual({ ...active, idempotencyKey: 'next-1' });
    });

    it('reports a key reused with a different message as a conflict', async () => {
        const { context } = harness('json');
        query.mockRejectedValueOnce(
            new WorkspaceToolFailure(new CommandFailure('failed', 'Key already used.', null), {
                kind: 'conflict',
                retryable: false,
                resume: null,
            })
        );
        await expect(run(context, { 'idempotency-key': 'next-1' })).rejects.toMatchObject({
            kind: 'conflict',
            message: 'Key already used.',
        });
    });

    it('passes a refusal through unchanged, without a retry fix', async () => {
        const { context } = harness('json');
        query.mockRejectedValueOnce(
            new WorkspaceToolFailure(
                new CommandFailure(
                    'failed',
                    'This Claude Code chat takes no words from a Loop.',
                    null
                ),
                { kind: 'unavailable', retryable: false, resume: null }
            )
        );
        await expect(run(context)).rejects.toMatchObject({
            kind: 'failed',
            message: 'This Claude Code chat takes no words from a Loop.',
            fix: null,
        });
    });

    it('names the same key to rerun with when the outcome is uncertain', async () => {
        const { context } = harness('json');
        query.mockRejectedValueOnce(new TypeError('fetch failed'));
        const failure = await run(context).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(CommandFailure);
        expect(failure).toMatchObject({
            kind: 'failed',
            fix: `dexto chat continue chat-1 'Next step' --yes --idempotency-key ${String(sentKey())}`,
        });
    });

    it('names the key to rerun with when the answer is unreadable', async () => {
        const { context } = harness('json');
        query.mockResolvedValueOnce({ status: 'accepted' });
        const failure = await run(context).catch((error: unknown) => error);
        expect(failure).toMatchObject({
            kind: 'failed',
            message: expect.stringContaining("Dexto didn't return a valid chat continue result."),
            fix: expect.stringContaining(`--idempotency-key ${String(sentKey())}`),
        });
    });

    it('reruns as typed when the uncertain call already named its key', async () => {
        const { context } = harness('json');
        query.mockRejectedValueOnce(new TypeError('fetch failed'));
        await expect(run(context, { 'idempotency-key': 'next-1' })).rejects.toMatchObject({
            fix: "dexto chat continue chat-1 'Next step' --yes",
        });
    });

    it('sends nothing without the sessions:write scope', async () => {
        const { context } = harness('json');
        scopes.mockRejectedValueOnce(
            new CommandFailure('needs_permission', 'Needs sessions:write.', 'dexto login')
        );
        await expect(run(context)).rejects.toMatchObject({ kind: 'needs_permission' });
        expect(query).not.toHaveBeenCalled();
    });

    it('refuses without --yes when it cannot ask, and sends nothing', async () => {
        const { context } = harness('table');
        await expect(run(context, { yes: false })).rejects.toMatchObject({
            kind: 'needs_confirmation',
        });
        expect(query).not.toHaveBeenCalled();
    });
});
