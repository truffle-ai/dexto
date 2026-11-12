/** Each supported Claude Code and Codex version, read from a hand-written transcript of its line shapes. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseClaudeCodeTranscript } from './claude-code.js';
import { parseCodexRollout } from './codex.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

describe('Claude Code 2.1.316', () => {
    const chat = parseClaudeCodeTranscript(
        fixture('claude-code-2.1.316.jsonl'),
        '/home/dev/.claude/projects/-Users-dev-Projects-dexto/7f3c2a10.jsonl'
    );

    it('is titled by its ai-title line, not its first message', () => {
        expect(chat?.title).toBe('Import titles from ai-title lines');
    });

    it('leaves out the compact summary Claude Code writes as a user line', () => {
        const userTexts = chat?.messages.filter((m) => m.role === 'user').map((m) => m.text);
        expect(userTexts).toEqual(['Make the importer read ai-title lines.', 'Now run the tests.']);
    });

    it('keeps the turns, tool history and where it started, and drops bookkeeping lines', () => {
        expect(chat).toMatchObject({
            cwd: '/Users/dev/Projects/dexto',
            gitBranch: 'feat/import',
            id: '7f3c2a10-5b1e-4c8d-9a2f-0e6b1d4c8a11',
            recordedRemoteUrl: null,
            source: 'claude-code',
            startedAt: '2026-11-01T10:00:00.000Z',
            updatedAt: '2026-11-01T11:02:30.000Z',
        });
        expect(chat?.messages.map((m) => m.role)).toEqual([
            'user',
            'assistant',
            'user',
            'assistant',
        ]);
        const work = chat?.messages[1]?.text ?? '';
        expect(work).toContain('Reading the parser first.');
        expect(work).toContain('**Tool call: Bash**');
        expect(work).toContain('src/a.ts:12: summary');
        expect(work).not.toContain('Look at the parser.');
        expect(JSON.stringify(chat)).not.toContain('Subagent note.');
    });

    it('reads the pull request its pr-link lines name, once', () => {
        expect(chat?.pullRequests).toEqual([
            {
                number: 1050,
                repository: 'truffle-ai/dexto',
                url: 'https://github.com/truffle-ai/dexto/pull/1050',
            },
        ]);
    });
});

describe('Claude Code 2.0.14', () => {
    it('is titled by its summary line', () => {
        const chat = parseClaudeCodeTranscript(fixture('claude-code-2.0.14.jsonl'), '/x/s.jsonl');
        expect(chat).toMatchObject({
            pullRequests: [],
            title: 'Fix the flaky login test',
        });
        expect(chat?.messages).toHaveLength(2);
    });
});

describe('Codex 0.165.0', () => {
    const chat = parseCodexRollout(fixture('codex-0.165.0.jsonl'), '/x/rollout.jsonl', (id) =>
        id === '019a4f2e-7c3d-7e10-9b8a-2f6d4c1e0a77' ? 'Import commands' : null
    );

    it('is titled as Codex lists the thread, and records its git remote', () => {
        expect(chat).toMatchObject({
            cwd: '/Users/dev/Projects/dexto',
            gitBranch: 'main',
            recordedRemoteUrl: 'git@github.com:truffle-ai/dexto.git',
            title: 'Import commands',
        });
    });

    it('keeps custom tool calls and leaves out context, reasoning, events and compaction', () => {
        expect(chat?.messages.map((m) => [m.role, m.text.split('\n')[0]])).toEqual([
            ['user', 'List the import commands.'],
            ['assistant', '**Tool call: apply_patch**'],
        ]);
        const work = chat?.messages[1]?.text ?? '';
        expect(work).toContain('*** Begin Patch');
        expect(work).toContain('Done.');
        expect(work).toContain('There are two: chat local and chat import.');
        expect(work).not.toContain('Summary of the work so far.');
    });

    it('is titled by its first message when Codex keeps no title', () => {
        const untitled = parseCodexRollout(
            fixture('codex-0.165.0.jsonl'),
            '/x/r.jsonl',
            () => null
        );
        expect(untitled?.title).toBe('List the import commands.');
    });
});

describe('Codex 0.46.0', () => {
    it('reads function calls and their output', () => {
        const chat = parseCodexRollout(fixture('codex-0.46.0.jsonl'), '/x/r.jsonl', () => null);
        expect(chat).toMatchObject({
            recordedRemoteUrl: 'https://github.com/acme/api.git',
            title: 'Run the tests.',
        });
        const work = chat?.messages[1]?.text ?? '';
        expect(work).toContain('**Tool call: shell**');
        expect(work).toContain('"pnpm"');
        expect(work).toContain('They pass.');
    });
});
