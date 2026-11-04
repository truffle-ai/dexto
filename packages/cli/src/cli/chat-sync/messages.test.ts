import type { AssistantMessage, InternalMessage } from '@dexto/core';
import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_CHARS, MAX_TOOL_CHARS, toSyncedMessages } from './messages.js';

// Fixtures are assembled at runtime so no literal credential sits in the repository.
const KEY = `sk-${'a'.repeat(40)}`;
const AT = Date.parse('2026-11-04T10:00:00.000Z');

function user(text: string, extra: { timestamp?: number } = {}): InternalMessage {
    return { role: 'user', content: [{ type: 'text', text }], timestamp: AT, ...extra };
}

function assistant(
    text: string | null,
    toolCalls: { id: string; name: string; args: unknown }[] = []
): AssistantMessage {
    return {
        role: 'assistant',
        content: text === null ? null : [{ type: 'text', text }],
        assistantOutput: { status: 'complete' },
        timestamp: AT,
        ...(toolCalls.length > 0 && {
            toolCalls: toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
        }),
    };
}

function tool(toolCallId: string, name: string, text: string): InternalMessage {
    return {
        role: 'tool',
        toolCallId,
        name,
        content: [{ type: 'text', text }],
        timestamp: AT,
    };
}

function toolPart(messages: ReturnType<typeof toSyncedMessages>, index = 0) {
    const part = messages[index]?.parts.find((candidate) => candidate.type === 'tool');
    if (part?.type !== 'tool') throw new Error('no tool part');
    return part;
}

describe('toSyncedMessages', () => {
    it('keeps only what the person and the agent said, with each call folded into its message', () => {
        const messages = toSyncedMessages([
            { role: 'system', content: [{ type: 'text', text: 'You are Dexto.' }] },
            user('List the files'),
            {
                ...assistant('Looking.', [
                    { id: 'c1', name: 'glob_files', args: { pattern: '*' } },
                ]),
                reasoning: 'private thoughts',
            },
            tool('c1', 'glob_files', '["a.ts"]'),
            assistant('One file.'),
        ]);

        expect(messages).toEqual([
            {
                created_at: '2026-11-04T10:00:00.000Z',
                role: 'user',
                parts: [{ type: 'text', text: 'List the files' }],
            },
            {
                created_at: '2026-11-04T10:00:00.000Z',
                role: 'assistant',
                parts: [
                    { type: 'text', text: 'Looking.' },
                    {
                        type: 'tool',
                        name: 'glob_files',
                        input: '{"pattern":"*"}',
                        output: '["a.ts"]',
                        path: null,
                    },
                ],
            },
            {
                created_at: '2026-11-04T10:00:00.000Z',
                role: 'assistant',
                parts: [{ type: 'text', text: 'One file.' }],
            },
        ]);
        expect(JSON.stringify(messages)).not.toContain('private thoughts');
    });

    it('leaves out summaries, context-clear markers, drafts and empty messages', () => {
        const messages = toSyncedMessages([
            user('hi'),
            { ...assistant('[Context cleared]'), metadata: { isSummary: true } },
            { ...assistant('summary'), metadata: { isSessionSummary: true } },
            { ...assistant('half a sent'), assistantOutput: { status: 'draft' } },
            assistant(null),
            user('   '),
        ]);

        expect(messages.map((message) => message.parts)).toEqual([[{ type: 'text', text: 'hi' }]]);
    });

    it('redacts before cutting a tool input or output to 4,000 characters', () => {
        // The key straddles the cut: cutting first would leave half of it, which no pattern matches.
        const before = 'x'.repeat(MAX_TOOL_CHARS - 20);
        const output = `${before} ${KEY} trailing`;
        const part = toolPart(
            toSyncedMessages([
                assistant(null, [{ id: 'c1', name: 'bash_exec', args: { command: 'env' } }]),
                tool('c1', 'bash_exec', output),
            ])
        );

        expect(part.output).not.toContain('sk-');
        expect(part.output).not.toContain('aaaa');
        expect(part.output?.length).toBeLessThanOrEqual(MAX_TOOL_CHARS);
        expect(part.output?.startsWith(before)).toBe(true);
    });

    it('redacts text before cutting it to the message limit', () => {
        const text = `${'y'.repeat(MAX_MESSAGE_CHARS - 10)} ${KEY}`;
        const [message] = toSyncedMessages([user(text)]);
        const part = message?.parts[0];

        expect(part?.type === 'text' && part.text.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
        expect(JSON.stringify(message)).not.toContain('aaaaaaaa');
    });

    it('names the file each file tool reads or writes', () => {
        const calls = [
            { id: 'c1', name: 'read_file', args: { file_path: '/repo/src/a.ts' } },
            { id: 'c2', name: 'write_file', args: { file_path: '/repo/b.ts', content: 'x' } },
            { id: 'c3', name: 'grep_content', args: { pattern: 'TODO', path: '/repo/src' } },
            { id: 'c4', name: 'glob_files', args: { pattern: '*.ts', path: '/repo' } },
            { id: 'c5', name: 'mcp--fs--read', args: { filePath: '/repo/c.md' } },
            { id: 'c6', name: 'mcp--docs--open', args: { uri: 'file:///repo/d.md' } },
            { id: 'c7', name: 'bash_exec', args: { command: 'ls' } },
        ];
        const [message] = toSyncedMessages([
            assistant(null, calls),
            ...calls.map((call) => tool(call.id, call.name, 'ok')),
        ]);

        expect(
            message?.parts.map((part) => (part.type === 'tool' ? [part.name, part.path] : null))
        ).toEqual([
            ['read_file', '/repo/src/a.ts'],
            ['write_file', '/repo/b.ts'],
            ['grep_content', '/repo/src'],
            ['glob_files', '/repo'],
            ['mcp--fs--read', '/repo/c.md'],
            ['mcp--docs--open', '/repo/d.md'],
            ['bash_exec', null],
        ]);
    });

    it('never sends the contents of a secret-shaped file, however the call names it', () => {
        const calls = [
            { id: 'c1', name: 'read_file', args: { file_path: '/repo/.env' } },
            { id: 'c2', name: 'bash_exec', args: { command: 'cat ~/.ssh/id_ed25519' } },
            { id: 'c3', name: 'mcp--fs--read', args: { target: '/repo/config/secrets.yaml' } },
        ];
        const [message] = toSyncedMessages([
            assistant(null, calls),
            tool('c1', 'read_file', 'DB_URL=postgres://u:p@h/db'),
            tool('c2', 'bash_exec', 'PRIVATE KEY MATERIAL'),
            tool('c3', 'mcp--fs--read', 'token: abc'),
        ]);
        const parts = message?.parts.filter((part) => part.type === 'tool') ?? [];

        expect(parts.map((part) => part.type === 'tool' && part.path)).toEqual([
            '/repo/.env',
            '~/.ssh/id_ed25519',
            '/repo/config/secrets.yaml',
        ]);
        for (const part of parts) {
            if (part.type !== 'tool') continue;
            expect(part.input).toMatch(/^\[excluded: secret file/u);
            expect(part.output).toMatch(/^\[excluded: secret file/u);
        }
        expect(JSON.stringify(message)).not.toMatch(/postgres|KEY MATERIAL|abc/u);
    });

    it('drops a search output that lists a secret-shaped file', () => {
        const calls = [{ id: 'c1', name: 'grep_content', args: { pattern: 'KEY', path: '.' } }];
        const part = toolPart(
            toSyncedMessages([
                assistant(null, calls),
                tool('c1', 'grep_content', '{"matches":[{"file":"/repo/.env","line":"KEY=v"}]}'),
            ])
        );

        expect(part.output).toBe('[excluded: secret file .env]');
        expect(part.input).toBe('{"pattern":"KEY","path":"."}');
    });

    it('sends an attachment as its name, type and size only', () => {
        const [message] = toSyncedMessages([
            {
                role: 'user',
                timestamp: AT,
                content: [
                    { type: 'text', text: 'see' },
                    { type: 'image', image: Buffer.from('12345'), mimeType: 'image/png' },
                    {
                        type: 'file',
                        data: 'QUJD',
                        mimeType: 'application/pdf',
                        filename: 'report.pdf',
                    },
                ],
            },
        ]);

        expect(message?.parts).toEqual([
            { type: 'text', text: 'see' },
            { type: 'attachment', name: 'image', mime_type: 'image/png', size_bytes: 5 },
            { type: 'attachment', name: 'report.pdf', mime_type: 'application/pdf', size_bytes: 3 },
        ]);
    });

    it('keeps a message within the server limits on parts and characters', () => {
        const calls = Array.from({ length: 80 }, (_, index) => ({
            id: `c${index}`,
            name: 'read_file',
            args: { file_path: `/repo/${index}.ts` },
        }));
        const [message] = toSyncedMessages([
            assistant('Reading everything.', calls),
            ...calls.map((call) => tool(call.id, call.name, 'z'.repeat(5_000))),
        ]);
        const parts = message?.parts ?? [];
        const chars = parts.reduce(
            (total, part) =>
                total +
                (part.type === 'text'
                    ? part.text.length
                    : part.type === 'tool'
                      ? part.input.length + (part.output?.length ?? 0)
                      : 0),
            0
        );

        expect(parts.length).toBeLessThanOrEqual(50);
        expect(chars).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
        expect(parts.at(-1)).toMatchObject({
            type: 'text',
            text: expect.stringMatching(/not synced/u),
        });
    });

    it('dates a message without a timestamp from the one before it, so a resend matches', () => {
        const messages = toSyncedMessages([
            user('a'),
            { role: 'user', content: [{ type: 'text', text: 'b' }] },
        ]);

        expect(messages.map((message) => message.created_at)).toEqual([
            '2026-11-04T10:00:00.000Z',
            '2026-11-04T10:00:00.000Z',
        ]);
    });
});
