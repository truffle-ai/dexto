import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPersonalSkills } from './personal-skills.js';

describe('personal skill discovery', () => {
    it('lists user-level skills without following symlinks or scanning project folders', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'personal-skills-'));
        const root = path.join(home, '.claude', 'skills');
        await mkdir(path.join(root, 'personal'), { recursive: true });
        await writeFile(
            path.join(root, 'personal', 'SKILL.md'),
            '---\nname: personal\ndescription: Test\n---\n'
        );
        await mkdir(path.join(home, 'repo', '.claude', 'skills', 'project'), { recursive: true });
        await writeFile(
            path.join(home, 'repo', '.claude', 'skills', 'project', 'SKILL.md'),
            'project'
        );
        await symlink(
            path.join(home, 'repo', '.claude', 'skills', 'project'),
            path.join(root, 'linked')
        );
        const skills = await findPersonalSkills(home);
        expect(skills.map((skill) => [skill.source, skill.name])).toEqual([
            ['claude-code', 'personal'],
        ]);
    });

    it('does not follow a symlinked source directory into a project', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'personal-skills-link-'));
        const project = path.join(home, 'project-config');
        await mkdir(path.join(project, 'skills', 'not-personal'), { recursive: true });
        await writeFile(path.join(project, 'skills', 'not-personal', 'SKILL.md'), 'project');
        await symlink(project, path.join(home, '.claude'));
        expect(await findPersonalSkills(home)).toEqual([]);
    });

    it('finds user-level Codex skills and ignores hidden and malformed entries', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'personal-skills-codex-'));
        const root = path.join(home, '.codex', 'skills');
        await mkdir(path.join(root, 'useful'), { recursive: true });
        await mkdir(path.join(root, '.system', 'hidden'), { recursive: true });
        await mkdir(path.join(root, 'no-manifest'), { recursive: true });
        await writeFile(path.join(root, 'useful', 'SKILL.md'), 'valid');
        await writeFile(path.join(root, '.system', 'hidden', 'SKILL.md'), 'hidden');
        expect((await findPersonalSkills(home)).map((skill) => [skill.source, skill.name])).toEqual(
            [['codex', 'useful']]
        );
    });

    it('honours a user-level config override but excludes one inside a repository', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'personal-skills-config-'));
        const custom = path.join(home, 'custom');
        const project = path.join(home, 'project');
        await mkdir(path.join(custom, 'skills', 'mine'), { recursive: true });
        await writeFile(path.join(custom, 'skills', 'mine', 'SKILL.md'), 'mine');
        await mkdir(path.join(project, '.git'), { recursive: true });
        await mkdir(path.join(project, '.claude', 'skills', 'repo'), { recursive: true });
        await writeFile(path.join(project, '.claude', 'skills', 'repo', 'SKILL.md'), 'repo');
        const skills = await findPersonalSkills(home, {
            CODEX_HOME: custom,
            CLAUDE_CONFIG_DIR: path.join(project, '.claude'),
        });
        expect(skills.map((skill) => [skill.source, skill.name])).toEqual([['codex', 'mine']]);
    });

    it('excludes a project reached through a symlinked ancestor', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'personal-skills-ancestor-'));
        const project = path.join(home, 'project');
        await mkdir(path.join(project, '.git'), { recursive: true });
        await mkdir(path.join(project, 'nested', 'config', 'skills', 'repo'), { recursive: true });
        await writeFile(
            path.join(project, 'nested', 'config', 'skills', 'repo', 'SKILL.md'),
            'repo'
        );
        await symlink(path.join(project, 'nested'), path.join(home, 'alias'));
        expect(
            await findPersonalSkills(home, { CODEX_HOME: path.join(home, 'alias', 'config') })
        ).toEqual([]);
    });
});
