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
});
