import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { projectFolder, readClaudeCodeProject } from './claude-code-knowledge.js';

describe('readClaudeCodeProject', () => {
    let root: string;
    let config: string;
    let repo: string;
    let sessions: string;

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), 'dexto-claude-knowledge-'));
        config = path.join(root, '.claude');
        repo = path.join(root, 'work', 'shop');
        sessions = path.join(config, 'projects', '-work-shop');
        await mkdir(path.join(sessions, 'memory'), { recursive: true });
        await mkdir(repo, { recursive: true });
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    const chat = (file: string, updatedAt: string, cwd: string | null = repo) => ({
        cwd,
        path: path.join(sessions, file),
        updatedAt,
    });

    it("reads the folder's memory notes and the instructions its repository doesn't carry, redacted", async () => {
        await writeFile(path.join(sessions, 'memory', 'MEMORY.md'), '- [Taste](taste.md)\n');
        await writeFile(
            path.join(sessions, 'memory', 'taste.md'),
            'Prefer small PRs. Key ghp_abcdefghijklmnopqrstuvwxyz0123456789AB\n'
        );
        await writeFile(path.join(sessions, 'memory', 'empty.md'), '  \n');
        await writeFile(path.join(config, 'CLAUDE.md'), 'Answer briefly.\n');
        await writeFile(path.join(repo, 'CLAUDE.local.md'), 'Use the staging database.\n');
        await writeFile(path.join(repo, 'CLAUDE.md'), 'Committed; arrives with the repository.\n');

        const project = await readClaudeCodeProject(
            repo,
            [chat('a.jsonl', '2026-11-01T00:00:00.000Z')],
            config
        );

        expect(project).toEqual({
            instructions: `## Imported from Claude Code\n\n### Your CLAUDE.md\n\nAnswer briefly.\n\n### CLAUDE.local.md in ${repo}\n\nUse the staging database.`,
            memories: [{ name: 'taste.md', text: 'Prefer small PRs. Key [redacted:github_token]' }],
            name: 'shop',
            sourceAgent: 'claude_code',
            sourceKey: expect.stringMatching(/^claude-code:folder:[0-9a-f]{64}$/u),
            sourcePath: repo,
        });
    });

    it('lets a later chat’s note win, and keys the Project by its folder alone', async () => {
        const other = path.join(config, 'projects', '-work-shop-wt');
        await mkdir(path.join(other, 'memory'), { recursive: true });
        await writeFile(path.join(sessions, 'memory', 'deploy.md'), 'Deploy on Fridays.');
        await writeFile(path.join(other, 'memory', 'deploy.md'), 'Never deploy on Fridays.');

        const newer = {
            cwd: null,
            path: path.join(other, 'b.jsonl'),
            updatedAt: '2026-11-03T00:00:00.000Z',
        };
        const project = await readClaudeCodeProject(
            repo,
            [newer, chat('a.jsonl', '2026-11-01T00:00:00.000Z')],
            config
        );
        const again = await readClaudeCodeProject(repo, [], config);

        expect(project.memories).toEqual([{ name: 'deploy.md', text: 'Never deploy on Fridays.' }]);
        expect(project).not.toHaveProperty('instructions');
        expect(again.sourceKey).toBe(project.sourceKey);
        expect(again).not.toHaveProperty('memories');
    });

    it('cuts a long note to the server’s bound', async () => {
        await writeFile(path.join(sessions, 'memory', 'long.md'), 'é'.repeat(20_000));

        const project = await readClaudeCodeProject(
            repo,
            [chat('a.jsonl', '2026-11-01T00:00:00.000Z')],
            config
        );

        const text = project.memories?.[0]?.text ?? '';
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(16 * 1024);
        expect(text.endsWith('[the rest was left out]')).toBe(true);
    });
});

describe('projectFolder', () => {
    it("is the repository's main checkout, else where the chat ran", () => {
        expect(
            projectFolder({ cwd: '/w/shop-wt', repository: { root: '/w/shop', remoteUrl: null } })
        ).toBe('/w/shop');
        expect(projectFolder({ cwd: '/w/notes', repository: null })).toBe('/w/notes');
        expect(projectFolder({ cwd: null, repository: null })).toBeNull();
    });
});
