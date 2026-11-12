/** Verifies which local Claude Code and Codex sessions the finder reads, and what it adds from disk. */
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findLocalChats } from './local-chats.js';
import { claudeSession, codexRollout, writeCodexState } from './test-utils.js';

describe('findLocalChats', () => {
    it('applies Codex state titles and reports missing rollouts with query filters', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'local-codex-state-'));
        const codex = path.join(home, '.codex');
        const sessions = path.join(codex, 'sessions');
        await mkdir(sessions, { recursive: true });
        const file = path.join(sessions, 'rollout-test.jsonl');
        await writeFile(file, codexRollout('kept'));
        await writeCodexState(codex, [
            {
                id: 'kept',
                cwd: '/work/web',
                rolloutPath: file,
                title: 'State title',
                updatedAt: '2026-10-02T00:00:00Z',
            },
            {
                id: 'gone',
                cwd: '/work/web',
                rolloutPath: null,
                title: 'Gone',
                updatedAt: '2026-10-03T00:00:00Z',
            },
            {
                id: 'other',
                cwd: '/work/other',
                rolloutPath: null,
                title: 'Other',
                updatedAt: '2026-10-03T00:00:00Z',
            },
        ]);
        const scan = await findLocalChats(
            { environment: {}, homeDirectory: home },
            { source: 'codex', dir: null, folder: '/work/web', since: '2026-10-01' }
        );
        expect(scan.chats[0]?.title).toBe('State title');
        expect(scan.notices).toMatchObject([{ code: 'codex_history_migrated', count: 1 }]);
    });
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
        expect(claude.chats.map((chat) => chat.id)).toEqual(['sess-1']);

        const codex = await findLocalChats(
            { environment: {}, homeDirectory: home },
            {
                dir: null,
                folder: null,
                since: null,
                source: 'codex',
            }
        );
        expect(codex.chats.map((chat) => chat.id)).toEqual(['t1', 't0']);

        const recent = await findLocalChats(
            { environment: { CODEX_HOME: path.join(home, '.codex') }, homeDirectory: '/nowhere' },
            { dir: null, folder: '/work/web', since: '2026-10-01', source: 'codex' }
        );
        expect(recent.chats.map((chat) => chat.id)).toEqual(['t1']);

        const elsewhere = await findLocalChats(
            { environment: {}, homeDirectory: home },
            {
                dir: null,
                folder: '/work/other',
                since: null,
                source: 'codex',
            }
        );
        expect(elsewhere).toEqual({ chats: [], notices: [] });
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
        expect(found.chats.map((chat) => chat.id)).toEqual(['t1']);
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
