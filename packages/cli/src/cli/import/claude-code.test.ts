/** Verifies how a Claude Code session file reads into a chat. */
import { describe, expect, it } from 'vitest';

import { parseClaudeCodeTranscript } from './claude-code.js';
import { claudeSession, jsonl } from './test-utils.js';

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

describe('Claude Code models', () => {
    const line = (
        type: 'assistant' | 'user',
        content: unknown,
        second: number,
        model?: string
    ) => ({
        cwd: '/work',
        message: { content, role: type, ...(model === undefined ? {} : { model }) },
        sessionId: 's',
        timestamp: `2026-11-01T10:00:${String(second).padStart(2, '0')}.000Z`,
        type,
    });

    it("gives each answer its last line's message.model, skipping <synthetic>", () => {
        const chat = parseClaudeCodeTranscript(
            jsonl([
                line('user', 'First question', 1),
                line('assistant', [{ text: 'Looking', type: 'text' }], 2, 'claude-opus-5-5'),
                line(
                    'assistant',
                    [{ id: 'tu', input: {}, name: 'Bash', type: 'tool_use' }],
                    3,
                    'claude-sonnet-5-20261001'
                ),
                line('user', [{ content: 'ok', tool_use_id: 'tu', type: 'tool_result' }], 4),
                line('assistant', 'No response requested.', 5, '<synthetic>'),
                line('user', 'Second question', 6),
                line('assistant', 'Plain answer', 7),
            ]),
            '/x/s.jsonl'
        );

        expect(chat?.messages.map((message) => message.role)).toEqual([
            'user',
            'assistant',
            'user',
            'assistant',
        ]);
        expect(chat?.messages[1]).toMatchObject({ model: 'claude-sonnet-5-20261001' });
        expect(chat?.messages[1]).not.toHaveProperty('reasoningEffort');
        expect(chat?.messages[1]?.text).toContain('No response requested.');
        expect(chat?.messages[3]).not.toHaveProperty('model');
    });
});

describe('Claude Code titles', () => {
    const turn = {
        cwd: '/work',
        message: { content: 'First line', role: 'user' },
        sessionId: 's',
        timestamp: '2026-11-01T10:00:00.000Z',
        type: 'user',
    };

    it('prefers the title the person gave, then the newest ai-title, then a summary', () => {
        const title = (lines: readonly unknown[]) =>
            parseClaudeCodeTranscript(jsonl([...lines, turn]), '/x/s.jsonl')?.title;

        expect(
            title([
                { summary: 'Summary', type: 'summary' },
                { aiTitle: 'Generated', sessionId: 's', type: 'ai-title' },
                { customTitle: 'Renamed', sessionId: 's', type: 'custom-title' },
                { aiTitle: 'Generated again', sessionId: 's', type: 'ai-title' },
            ])
        ).toBe('Renamed');
        expect(
            title([
                { aiTitle: 'Generated', sessionId: 's', type: 'ai-title' },
                { aiTitle: 'Generated again', sessionId: 's', type: 'ai-title' },
                { summary: 'Summary', type: 'summary' },
            ])
        ).toBe('Generated again');
        expect(title([{ summary: 'Summary', type: 'summary' }])).toBe('Summary');
        expect(title([{ aiTitle: '  ', sessionId: 's', type: 'ai-title' }])).toBe('First line');
    });
});
