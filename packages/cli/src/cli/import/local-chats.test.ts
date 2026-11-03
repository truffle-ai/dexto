/** Verifies how local Claude Code and Codex transcripts become redacted, bounded Dexto chats. */
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    findLocalChats,
    MAX_IMPORT_MESSAGES,
    MAX_MESSAGE_CHARS,
    parseClaudeCodeTranscript,
    parseCodexRollout,
    redactSecrets,
    toImportInput,
} from './local-chats.js';

const jsonl = (lines: readonly unknown[]) => lines.map((line) => JSON.stringify(line)).join('\n');

/** A synthetic Claude Code session, shaped as the Agent SDK's messages. */
function claudeSession(sessionId: string) {
    const base = {
        cwd: '/work/api',
        gitBranch: 'main',
        isSidechain: false,
        sessionId,
        version: '2.1.0',
    };
    return jsonl([
        { leafUuid: 'a3', summary: 'Fix the flaky login test', type: 'summary' },
        {
            ...base,
            isMeta: true,
            message: { content: 'Caveat: local commands below.', role: 'user' },
            timestamp: '2026-10-01T10:00:00.000Z',
            type: 'user',
            uuid: 'm0',
        },
        {
            ...base,
            message: { content: '<command-name>/clear</command-name>', role: 'user' },
            timestamp: '2026-10-01T10:00:01.000Z',
            type: 'user',
            uuid: 'm1',
        },
        {
            ...base,
            message: { content: 'Why does login.test.ts fail?', role: 'user' },
            timestamp: '2026-10-01T10:00:02.000Z',
            type: 'user',
            uuid: 'u1',
        },
        {
            ...base,
            message: {
                content: [
                    { thinking: 'Let me look.', type: 'thinking' },
                    { text: 'Let me run it.', type: 'text' },
                ],
                id: 'msg_1',
                role: 'assistant',
            },
            timestamp: '2026-10-01T10:00:03.000Z',
            type: 'assistant',
            uuid: 'a1',
        },
        {
            ...base,
            message: {
                content: [
                    {
                        id: 'toolu_1',
                        input: { command: 'pnpm test login' },
                        name: 'Bash',
                        type: 'tool_use',
                    },
                ],
                id: 'msg_1',
                role: 'assistant',
            },
            timestamp: '2026-10-01T10:00:04.000Z',
            type: 'assistant',
            uuid: 'a2',
        },
        {
            ...base,
            message: {
                content: [
                    {
                        content: 'FAIL login.test.ts\nOPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx',
                        tool_use_id: 'toolu_1',
                        type: 'tool_result',
                    },
                ],
                role: 'user',
            },
            timestamp: '2026-10-01T10:00:05.000Z',
            type: 'user',
            uuid: 'r1',
        },
        {
            ...base,
            isSidechain: true,
            message: { content: [{ text: 'Subagent noise', type: 'text' }], role: 'assistant' },
            timestamp: '2026-10-01T10:00:06.000Z',
            type: 'assistant',
            uuid: 's1',
        },
        {
            ...base,
            message: {
                content: [{ text: 'The test races the clock.', type: 'text' }],
                id: 'msg_2',
                role: 'assistant',
            },
            timestamp: '2026-10-01T10:00:07.000Z',
            type: 'assistant',
            uuid: 'a3',
        },
        { snapshot: {}, type: 'file-history-snapshot' },
        'not json',
    ]);
}

/** A synthetic Codex rollout, shaped as `RolloutItemWire` lines. */
function codexRollout(id: string) {
    return jsonl([
        {
            payload: {
                cli_version: '0.50.0',
                cwd: '/work/web',
                git: { branch: 'feature/x', commit_hash: 'abc' },
                id,
                originator: 'codex_cli_rs',
                timestamp: '2026-10-02T09:00:00.000Z',
            },
            timestamp: '2026-10-02T09:00:00.000Z',
            type: 'session_meta',
        },
        {
            payload: {
                content: [{ text: 'You are Codex.', type: 'input_text' }],
                role: 'developer',
                type: 'message',
            },
            timestamp: '2026-10-02T09:00:00.100Z',
            type: 'response_item',
        },
        {
            payload: {
                content: [
                    {
                        text: '<environment_context>\n  <cwd>/work/web</cwd>\n</environment_context>',
                        type: 'input_text',
                    },
                ],
                role: 'user',
                type: 'message',
            },
            timestamp: '2026-10-02T09:00:00.200Z',
            type: 'response_item',
        },
        {
            payload: {
                content: [{ text: 'List the routes.', type: 'input_text' }],
                role: 'user',
                type: 'message',
            },
            timestamp: '2026-10-02T09:00:01.000Z',
            type: 'response_item',
        },
        {
            payload: { content: null, encrypted_content: 'x', summary: [], type: 'reasoning' },
            timestamp: '2026-10-02T09:00:02.000Z',
            type: 'response_item',
        },
        {
            payload: {
                arguments: '{"command":["rg","route"]}',
                call_id: 'call_1',
                name: 'shell',
                type: 'function_call',
            },
            timestamp: '2026-10-02T09:00:03.000Z',
            type: 'response_item',
        },
        {
            payload: { call_id: 'call_1', output: 'src/routes.ts', type: 'function_call_output' },
            timestamp: '2026-10-02T09:00:04.000Z',
            type: 'response_item',
        },
        {
            payload: {
                call_id: 'call_2',
                input: '*** Begin Patch',
                name: 'apply_patch',
                type: 'custom_tool_call',
            },
            timestamp: '2026-10-02T09:00:05.000Z',
            type: 'response_item',
        },
        {
            payload: {
                call_id: 'call_2',
                output: [{ text: 'Done.', type: 'input_text' }],
                type: 'custom_tool_call_output',
            },
            timestamp: '2026-10-02T09:00:06.000Z',
            type: 'response_item',
        },
        {
            payload: {
                content: [{ text: 'One route: /health.', type: 'output_text' }],
                role: 'assistant',
                type: 'message',
            },
            timestamp: '2026-10-02T09:00:07.000Z',
            type: 'response_item',
        },
        {
            payload: { message: 'ignored', type: 'agent_message' },
            timestamp: '2026-10-02T09:00:08.000Z',
            type: 'event_msg',
        },
    ]);
}

describe('parseClaudeCodeTranscript', () => {
    it("keeps the person's and assistant's turns, tool history as text, and drops the rest", () => {
        const chat = parseClaudeCodeTranscript(claudeSession('sess-1'), '/x/sess-1.jsonl');

        expect(chat).toMatchObject({
            cwd: '/work/api',
            gitBranch: 'main',
            id: 'sess-1',
            source: 'claude-code',
            startedAt: '2026-10-01T10:00:02.000Z',
            title: 'Fix the flaky login test',
            updatedAt: '2026-10-01T10:00:07.000Z',
        });
        expect(chat?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
        expect(chat?.messages[0]).toEqual({
            createdAt: '2026-10-01T10:00:02.000Z',
            role: 'user',
            text: 'Why does login.test.ts fail?',
        });
        const answer = chat?.messages[1]?.text ?? '';
        expect(answer).toContain('Let me run it.');
        expect(answer).toContain('**Tool call: Bash**');
        expect(answer).toContain('"command": "pnpm test login"');
        expect(answer).toContain('**Tool result**');
        expect(answer).toContain('FAIL login.test.ts');
        expect(answer).toContain('The test races the clock.');
        expect(answer).not.toContain('Let me look.');
        expect(answer).not.toContain('Subagent noise');
    });

    it('titles a session without a summary by its first message, and skips one with no turns', () => {
        const lines = claudeSession('sess-2').split('\n').slice(1).join('\n');
        expect(parseClaudeCodeTranscript(lines, '/x/sess-2.jsonl')?.title).toBe(
            'Why does login.test.ts fail?'
        );
        expect(parseClaudeCodeTranscript(jsonl([{ type: 'summary' }]), '/x/e.jsonl')).toBeNull();
    });
});

describe('parseCodexRollout', () => {
    it('reads the session meta, leaves out developer and injected context, and renders tools', () => {
        const chat = parseCodexRollout(codexRollout('thread-1'), '/x/rollout.jsonl');

        expect(chat).toMatchObject({
            cwd: '/work/web',
            gitBranch: 'feature/x',
            id: 'thread-1',
            source: 'codex',
            startedAt: '2026-10-02T09:00:01.000Z',
            title: 'List the routes.',
            updatedAt: '2026-10-02T09:00:07.000Z',
        });
        expect(chat?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
        const answer = chat?.messages[1]?.text ?? '';
        expect(answer).toContain('**Tool call: shell**');
        expect(answer).toContain('"rg"');
        expect(answer).toContain('src/routes.ts');
        expect(answer).toContain('**Tool call: apply_patch**');
        expect(answer).toContain('Done.');
        expect(answer).toContain('One route: /health.');
        expect(answer).not.toContain('You are Codex.');
        expect(answer).not.toContain('environment_context');
    });
});

describe('redactSecrets', () => {
    it('replaces credentials and counts them by kind', () => {
        const { counts, text } = redactSecrets(
            [
                'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
                'gh ghp_abcdefghijklmnopqrstuvwxyz0123456789',
                'aws AKIAABCDEFGHIJKLMNOP',
                'Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123',
                'password = hunter2hunter2',
                '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
                'plain words stay',
            ].join('\n')
        );

        expect(text).not.toMatch(/sk-ant|ghp_|AKIA|hunter2|MIIabc/u);
        expect(text).toContain('password = [redacted:assignment]');
        expect(text).toContain('plain words stay');
        expect(counts).toEqual({
            assignment: 1,
            aws_access_key: 1,
            bearer_token: 1,
            github_token: 1,
            private_key: 1,
            secret_key: 1,
        });
    });
});

describe('toImportInput', () => {
    it('sends the redacted transcript with its provenance, and counts what it redacted', () => {
        const chat = parseClaudeCodeTranscript(claudeSession('sess-1'), '/x/sess-1.jsonl');
        if (chat === null) throw new Error('Expected a chat.');
        const prepared = toImportInput(chat);

        expect(prepared.kind).toBe('ready');
        if (prepared.kind !== 'ready') return;
        expect(prepared.redactions).toEqual({ secret_key: 1 });
        expect(prepared.input).toMatchObject({
            cwd: '/work/api',
            gitBranch: 'main',
            source: 'claude-code',
            sourceSessionId: 'sess-1',
            title: 'Fix the flaky login test',
        });
        expect(JSON.stringify(prepared.input)).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    });

    it("redacts a private key a tool result's size cut would split, and counts it", () => {
        const key = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(5_000)}\n-----END PRIVATE KEY-----`;
        const chat = parseCodexRollout(
            jsonl([
                {
                    payload: { cwd: '/work/web', id: 't1' },
                    timestamp: '2026-10-02T09:00:00.000Z',
                    type: 'session_meta',
                },
                {
                    payload: {
                        content: [{ text: 'Read the key file.', type: 'input_text' }],
                        role: 'user',
                        type: 'message',
                    },
                    timestamp: '2026-10-02T09:00:01.000Z',
                    type: 'response_item',
                },
                {
                    payload: { call_id: 'c1', output: key, type: 'function_call_output' },
                    timestamp: '2026-10-02T09:00:02.000Z',
                    type: 'response_item',
                },
            ]),
            '/x/rollout-t1.jsonl'
        );
        if (chat === null) throw new Error('Expected a chat.');
        const prepared = toImportInput(chat);

        expect(prepared.kind === 'ready' && prepared.redactions).toEqual({ private_key: 1 });
        expect(JSON.stringify(prepared)).not.toContain('AAAAAAAA');
    });

    it('redacts secrets in the working directory and branch it sends', () => {
        const at = '2026-10-01T10:00:00.000Z';
        const prepared = toImportInput({
            cwd: '/work/token=abcdefgh12345678',
            gitBranch: 'fix/sk-abcdefghijklmnopqrstuvwx',
            id: 's',
            messages: [{ createdAt: at, role: 'user', text: 'hi' }],
            path: '/x',
            source: 'codex',
            startedAt: at,
            title: 'Paths',
            updatedAt: at,
        });

        expect(prepared.kind === 'ready' && prepared.input).toMatchObject({
            cwd: '/work/token=[redacted:assignment]',
            gitBranch: 'fix/[redacted:secret_key]',
        });
        expect(prepared.kind === 'ready' && prepared.redactions).toEqual({
            assignment: 1,
            secret_key: 1,
        });
    });

    it('truncates an oversize message and skips a session with too many', () => {
        const at = '2026-10-01T10:00:00.000Z';
        const long = toImportInput({
            cwd: null,
            gitBranch: null,
            id: 's',
            messages: [{ createdAt: at, role: 'user', text: 'x'.repeat(MAX_MESSAGE_CHARS + 10) }],
            path: '/x',
            source: 'codex',
            startedAt: at,
            title: 'Long',
            updatedAt: at,
        });
        expect(long.kind === 'ready' && long.input.messages[0]?.text.length).toBe(
            MAX_MESSAGE_CHARS
        );

        const many = toImportInput({
            cwd: null,
            gitBranch: null,
            id: 's',
            messages: Array.from({ length: MAX_IMPORT_MESSAGES + 1 }, () => ({
                createdAt: at,
                role: 'user' as const,
                text: 'hi',
            })),
            path: '/x',
            source: 'codex',
            startedAt: at,
            title: 'Many',
            updatedAt: at,
        });
        expect(many).toEqual({
            kind: 'skipped',
            reason: `It has more than ${MAX_IMPORT_MESSAGES} messages.`,
        });
    });
});

describe('findLocalChats', () => {
    it('finds Claude Code sessions one folder deep and Codex rollouts by date, newest first', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'local-chats-'));
        const project = path.join(home, '.claude', 'projects', '-work-api');
        await mkdir(path.join(project, 'sess-1', 'subagents'), { recursive: true });
        await writeFile(path.join(project, 'sess-1.jsonl'), claudeSession('sess-1'));
        await writeFile(path.join(project, 'sess-1', 'subagents', 'agent.jsonl'), '{}');
        const day = path.join(home, '.codex', 'sessions', '2026', '10', '02');
        await mkdir(day, { recursive: true });
        await writeFile(path.join(day, 'rollout-2026-10-02T09-00-00-t1.jsonl'), codexRollout('t1'));
        await writeFile(path.join(day, 'rollout-2026-10-02T10-00-00-t2.jsonl.zst'), '');
        const old = path.join(day, 'rollout-2026-10-02T08-00-00-t0.jsonl');
        await writeFile(old, codexRollout('t0').replaceAll('2026-10-02', '2026-09-02'));
        await utimes(old, new Date('2026-09-02'), new Date('2026-09-02'));

        const claude = await findLocalChats(
            { environment: {}, homeDirectory: home },
            {
                dir: null,
                folder: null,
                since: null,
                source: 'claude-code',
            }
        );
        expect(claude.map((chat) => chat.id)).toEqual(['sess-1']);

        const codex = await findLocalChats(
            { environment: {}, homeDirectory: home },
            {
                dir: null,
                folder: null,
                since: null,
                source: 'codex',
            }
        );
        expect(codex.map((chat) => chat.id)).toEqual(['t1', 't0']);

        const recent = await findLocalChats(
            { environment: { CODEX_HOME: path.join(home, '.codex') }, homeDirectory: '/nowhere' },
            { dir: null, folder: '/work/web', since: '2026-10-01', source: 'codex' }
        );
        expect(recent.map((chat) => chat.id)).toEqual(['t1']);

        const elsewhere = await findLocalChats(
            { environment: {}, homeDirectory: home },
            {
                dir: null,
                folder: '/work/other',
                since: null,
                source: 'codex',
            }
        );
        expect(elsewhere).toEqual([]);
    });

    it('keeps a copied transcript whose file time is older than its last turn', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'local-chats-copied-'));
        const file = path.join(dir, 'rollout-2026-10-02T09-00-00-t1.jsonl');
        await writeFile(file, codexRollout('t1'));
        await utimes(file, new Date('2026-09-01'), new Date('2026-09-01'));

        const found = await findLocalChats(
            { environment: {}, homeDirectory: '/nowhere' },
            { dir, folder: null, since: '2026-10-01', source: 'codex' }
        );
        expect(found.map((chat) => chat.id)).toEqual(['t1']);
    });

    it('refuses a --dir it cannot read rather than finding nothing', async () => {
        await expect(
            findLocalChats(
                { environment: {}, homeDirectory: '/nowhere' },
                { dir: '/no/such/sessions', folder: null, since: null, source: 'codex' }
            )
        ).rejects.toThrow('--dir /no/such/sessions is not a folder this can read.');
    });
});
