import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalSkills } from './local-skills.js';

describe('createLocalSkills', () => {
    let tempDir: string;
    let previousHome: string | undefined;
    let previousUserProfile: string | undefined;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-local-skills-'));
        previousHome = process.env.HOME;
        previousUserProfile = process.env.USERPROFILE;
        const home = path.join(tempDir, 'home');
        await fs.mkdir(home, { recursive: true });
        process.env.HOME = home;
        process.env.USERPROFILE = home;
    });

    afterEach(async () => {
        if (previousHome === undefined) delete process.env.HOME;
        else process.env.HOME = previousHome;

        if (previousUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = previousUserProfile;

        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('discovers user-global and plugin skills through the Skills contract', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const userSkillDir = path.join(tempDir, 'home', '.agents', 'skills', 'global-review');
        const pluginSkillDir = path.join(
            workspaceRoot,
            '.dexto',
            'plugins',
            'review',
            'skills',
            'audit'
        );

        await fs.mkdir(userSkillDir, { recursive: true });
        await fs.writeFile(
            path.join(userSkillDir, 'SKILL.md'),
            '# Global Review\n\nReview from user home.',
            'utf8'
        );

        await fs.mkdir(path.join(workspaceRoot, '.dexto', 'plugins', 'review', '.claude-plugin'), {
            recursive: true,
        });
        await fs.writeFile(
            path.join(
                workspaceRoot,
                '.dexto',
                'plugins',
                'review',
                '.claude-plugin',
                'plugin.json'
            ),
            JSON.stringify({ name: 'review' }),
            'utf8'
        );
        await fs.mkdir(pluginSkillDir, { recursive: true });
        await fs.writeFile(
            path.join(pluginSkillDir, 'SKILL.md'),
            [
                '---',
                'name: audit',
                'description: Audit through plugin skill.',
                '---',
                '',
                '# Audit',
            ].join('\n'),
            'utf8'
        );
        await fs.mkdir(path.join(pluginSkillDir, 'references'), { recursive: true });
        await fs.writeFile(
            path.join(pluginSkillDir, 'references', 'usage.md'),
            'Plugin usage reference.',
            'utf8'
        );

        const skills = createLocalSkills({ workspaceRoot });
        const summaries = await skills.list();

        expect(summaries.map((skill) => skill.name).sort()).toEqual([
            'global-review',
            'review:audit',
        ]);
        await expect(skills.load('review:audit')).resolves.toMatchObject({
            name: 'review:audit',
            instructions: expect.stringContaining('Audit through plugin skill.'),
            supportingFiles: ['references/usage.md'],
            filesLocation: 'workspace',
            baseDirectory: pluginSkillDir,
        });
        await expect(skills.load('Audit')).resolves.toBeNull();
        await expect(skills.readFile('review:audit', 'references/usage.md')).resolves.toBe(
            'Plugin usage reference.'
        );
        await expect(skills.readFile('review:audit', '../SKILL.md')).rejects.toThrow(
            'Skill file not found: review:audit/../SKILL.md'
        );
        await expect(skills.readFile('review:audit', String.raw`C:\tmp\file.md`)).rejects.toThrow(
            'Skill file not found: review:audit/C:\\tmp\\file.md'
        );
    });

    it('discovers skills from the active workspace after rebinding', async () => {
        const initialWorkspaceRoot = path.join(tempDir, 'initial-workspace');
        const activeWorkspaceRoot = path.join(tempDir, 'active-workspace');
        const initialSkillDir = path.join(initialWorkspaceRoot, '.agents', 'skills', 'initial');
        const activeSkillDir = path.join(activeWorkspaceRoot, '.agents', 'skills', 'active');

        await fs.mkdir(initialSkillDir, { recursive: true });
        await fs.mkdir(activeSkillDir, { recursive: true });
        await fs.writeFile(
            path.join(initialSkillDir, 'SKILL.md'),
            '# Initial\n\nInitial instructions.',
            'utf8'
        );
        await fs.writeFile(
            path.join(activeSkillDir, 'SKILL.md'),
            '# Active\n\nActive instructions.',
            'utf8'
        );

        const skills = createLocalSkills({ workspaceRoot: initialWorkspaceRoot });

        await expect(skills.list()).resolves.toEqual([
            { name: 'initial', description: 'Initial instructions.' },
        ]);

        skills.setWorkspaceRoot(activeWorkspaceRoot);

        await expect(skills.list()).resolves.toEqual([
            { name: 'active', description: 'Active instructions.' },
        ]);
        await expect(skills.load('initial')).resolves.toBeNull();
        await expect(skills.load('active')).resolves.toMatchObject({ name: 'active' });

        skills.setWorkspaceRoot(undefined);

        await expect(skills.list()).resolves.toEqual([
            { name: 'initial', description: 'Initial instructions.' },
        ]);
    });

    it('ignores a Skill whose frontmatter name disagrees with its canonical root name', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const skillDir = path.join(workspaceRoot, '.agents', 'skills', 'canonical');
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(
            path.join(skillDir, 'SKILL.md'),
            ['---', 'name: alias', 'description: Wrong name.', '---', '', '# Canonical'].join('\n'),
            'utf8'
        );

        const skills = createLocalSkills({ workspaceRoot });

        await expect(skills.list()).resolves.toEqual([]);
        await expect(skills.load('canonical')).resolves.toBeNull();
    });

    it('derives descriptions after empty YAML frontmatter', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const skillDir = path.join(workspaceRoot, '.agents', 'skills', 'empty-frontmatter');
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(
            path.join(skillDir, 'SKILL.md'),
            ['---', '---', '', '# Empty Frontmatter', '', 'Description after metadata.'].join('\n'),
            'utf8'
        );

        const skills = createLocalSkills({ workspaceRoot });

        await expect(skills.list()).resolves.toEqual([
            { name: 'empty-frontmatter', description: 'Description after metadata.' },
        ]);
    });

    it.skipIf(process.platform === 'win32')(
        'rejects supporting files whose symlink target escapes the skill directory',
        async () => {
            const workspaceRoot = path.join(tempDir, 'workspace');
            const skillDir = path.join(workspaceRoot, '.agents', 'skills', 'safe');
            const outsideFile = path.join(tempDir, 'outside.md');
            const linkedFile = path.join(skillDir, 'references', 'outside.md');
            await fs.mkdir(path.dirname(linkedFile), { recursive: true });
            await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Safe\n', 'utf8');
            await fs.writeFile(outsideFile, 'secret', 'utf8');
            await fs.symlink(outsideFile, linkedFile);

            const skills = createLocalSkills({ workspaceRoot });

            await expect(skills.readFile('safe', 'references/outside.md')).rejects.toThrow(
                'Skill file not found: safe/references/outside.md'
            );
        }
    );
});
