/** Verifies how a Codex rollout and its state database read into a chat. */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseCodexRollout, readCodexThreads } from './codex.js';
import { codexRollout, writeCodexState } from './test-utils.js';

describe('parseCodexRollout', () => {
    it('reads the session meta, leaves out developer and injected context, and renders tools', () => {
        const chat = parseCodexRollout(codexRollout('thread-1'), '/x/rollout.jsonl', () => null);

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

describe('readCodexThreads', () => {
    it('reads titles, which threads lost their rollout, and leaves out archived ones', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'codex-state-'));
        const kept = path.join(home, 'rollout-a.jsonl');
        await writeFile(kept, '');
        await writeCodexState(home, [
            {
                cwd: '/w',
                id: 'a',
                name: 'Renamed',
                rolloutPath: kept,
                title: 'Auto',
                updatedAt: '2026-11-01T00:00:00Z',
            },
            {
                cwd: '/w',
                id: 'b',
                rolloutPath: path.join(home, 'gone.jsonl'),
                title: 'Auto b',
                updatedAt: '2026-11-02T00:00:00Z',
            },
            {
                cwd: '/w',
                id: 'c',
                rolloutPath: kept,
                title: '  ',
                updatedAt: '2026-11-03T00:00:00Z',
            },
            {
                archived: true,
                cwd: '/w',
                id: 'd',
                rolloutPath: kept,
                title: 'Old',
                updatedAt: '2026-11-04T00:00:00Z',
            },
        ]);

        expect(await readCodexThreads(home)).toEqual([
            {
                cwd: '/w',
                hasRollout: true,
                id: 'a',
                title: 'Renamed',
                updatedAt: '2026-11-01T00:00:00.000Z',
            },
            {
                cwd: '/w',
                hasRollout: false,
                id: 'b',
                title: 'Auto b',
                updatedAt: '2026-11-02T00:00:00.000Z',
            },
            {
                cwd: '/w',
                hasRollout: true,
                id: 'c',
                title: null,
                updatedAt: '2026-11-03T00:00:00.000Z',
            },
        ]);
    });

    it('is null without a state database, or with one of another shape', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'codex-state-'));
        expect(await readCodexThreads(home)).toBeNull();
        await writeFile(path.join(home, 'state_5.sqlite'), 'not a database');
        expect(await readCodexThreads(home)).toBeNull();
    });
});
