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
