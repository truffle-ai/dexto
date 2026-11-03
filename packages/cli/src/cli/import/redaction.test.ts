/** Verifies that what an import sends is redacted and within the server's bounds. */
import { describe, expect, it } from 'vitest';

import { parseClaudeCodeTranscript } from './claude-code.js';
import { parseCodexRollout } from './codex.js';
import {
    MAX_IMPORT_CHARS,
    MAX_IMPORT_MESSAGES,
    MAX_MESSAGE_CHARS,
    redactSecrets,
    toImportInput,
} from './redaction.js';
import { claudeSession, jsonl } from './test-utils.js';

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
            '/x/rollout-t1.jsonl',
            () => null
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
            source: 'codex',
            title: 'Paths',
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

    it('truncates an oversize message', () => {
        const at = '2026-10-01T10:00:00.000Z';
        const long = toImportInput({
            cwd: null,
            gitBranch: null,
            id: 's',
            messages: [{ createdAt: at, role: 'user', text: 'x'.repeat(MAX_MESSAGE_CHARS + 10) }],
            source: 'codex',
            title: 'Long',
        });
        expect(long.kind === 'ready' && long.input.messages[0]?.text.length).toBe(
            MAX_MESSAGE_CHARS
        );
    });

    it('keeps the newest messages of a session over the message limit, after a note', () => {
        const total = MAX_IMPORT_MESSAGES + 5;
        const prepared = toImportInput({
            cwd: null,
            gitBranch: null,
            id: 's',
            messages: Array.from({ length: total }, (_, index) => ({
                createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString(),
                role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
                text: `message ${index}`,
            })),
            source: 'claude-code',
            title: 'Many',
        });
        if (prepared.kind !== 'ready') throw new Error('Expected it to be ready.');
        const sent = prepared.input.messages;

        expect(sent).toHaveLength(MAX_IMPORT_MESSAGES);
        expect(prepared.leftOut).toBe(6);
        expect(sent[0]).toEqual({
            createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, 5)).toISOString(),
            role: 'assistant',
            text: "[Imported from Claude Code: the first 6 messages of this session were left out. Dexto imports up to a session's newest 2,000 messages.]",
        });
        expect(sent[1]?.text).toBe('message 6');
        expect(sent.at(-1)?.text).toBe(`message ${total - 1}`);
    });

    it('keeps the newest messages that fit the character limit, after a note', () => {
        const prepared = toImportInput({
            cwd: null,
            gitBranch: null,
            id: 's',
            messages: Array.from({ length: 70 }, (_, index) => ({
                createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString(),
                role: 'user' as const,
                text: `${index} `.padEnd(MAX_MESSAGE_CHARS, 'x'),
            })),
            source: 'codex',
            title: 'Wide',
        });
        if (prepared.kind !== 'ready') throw new Error('Expected it to be ready.');
        const sent = prepared.input.messages;
        const chars = sent.reduce((sum, message) => sum + message.text.length, 0);

        expect(chars).toBeLessThanOrEqual(MAX_IMPORT_CHARS);
        expect(prepared.leftOut).toBe(70 - (sent.length - 1));
        expect(sent[0]?.text).toContain('Imported from Codex: the first');
        expect(sent.at(-1)?.text.startsWith('69 ')).toBe(true);
    });

    it('orders the omission note before retained messages even when timestamps tie', () => {
        const at = '2026-10-01T00:00:00.000Z';
        const prepared = toImportInput({
            cwd: null,
            gitBranch: null,
            id: 's',
            source: 'codex',
            title: 'T',
            messages: Array.from({ length: MAX_IMPORT_MESSAGES + 1 }, (_, i) => ({
                createdAt: at,
                role: i % 2 ? ('assistant' as const) : ('user' as const),
                text: `${i}`,
            })),
        });
        if (prepared.kind !== 'ready') throw new Error('Expected it to be ready.');
        expect(Date.parse(prepared.input.messages[0]?.createdAt ?? '')).toBeLessThan(
            Date.parse(at)
        );
    });
});
