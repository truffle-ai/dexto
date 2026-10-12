import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalSkills, registerConfiguredSkillPrompts } from './local-skills.js';

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

    it('loads a configured legacy skill file without granting access to sibling files', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const agentRoot = path.join(tempDir, 'installed-agent');
        await fs.mkdir(agentRoot, { recursive: true });
        const file = path.join(agentRoot, 'code-review.md');
        await fs.writeFile(
            file,
            '---\ntitle: Code Review\ndescription: Review changes\n---\n# Code Review Skill'
        );
        await fs.writeFile(path.join(agentRoot, 'private.txt'), 'not a skill resource');
        const skills = createLocalSkills({ workspaceRoot });
        registerConfiguredSkillPrompts(skills, [{ type: 'file', file, showInStarters: false }]);
        expect(await skills.list()).toEqual([
            { name: 'code-review', description: 'Review changes' },
        ]);
        expect(await skills.load('code-review')).toMatchObject({
            name: 'code-review',
            instructions: expect.stringContaining('# Code Review Skill'),
            supportingFiles: [],
            filesLocation: 'hosted',
            baseDirectory: null,
        });
        await expect(skills.readFile('code-review', 'private.txt')).rejects.toThrow();
    });

    it('uses configured prompt id and namespace rather than name/title and reads edits each time', async () => {
        const file = path.join(tempDir, 'original.md');
        await fs.writeFile(
            file,
            '---\nid: registered-review\nname: not-the-prompt-id\ntitle: Display Title\n---\nInitial instructions'
        );
        const skills = createLocalSkills({ workspaceRoot: tempDir });
        registerConfiguredSkillPrompts(skills, [{ type: 'file', file, namespace: 'reviews' }]);
        expect((await skills.list()).map((skill) => skill.name)).toEqual([
            'reviews:registered-review',
        ]);
        expect((await skills.load('reviews:registered-review'))?.instructions).toContain(
            'Initial instructions'
        );
        await fs.writeFile(
            file,
            '\n---\nid: registered-review\ndisable-model-invocation: true\n---\nPrivate instructions'
        );
        expect(await skills.list()).toEqual([]);
        expect(await skills.load('reviews:registered-review')).toBeNull();
        await fs.writeFile(file, '---\nid: renamed-review\n---\nUpdated instructions');
        expect(await skills.load('reviews:registered-review')).toBeNull();
        expect((await skills.load('reviews:renamed-review'))?.instructions).toContain(
            'Updated instructions'
        );
    });

    it('preserves a discovered skill over configured files without breaking an unrelated configured skill', async () => {
        const root = path.join(tempDir, '.agents', 'skills', 'shared');
        await fs.mkdir(root, { recursive: true });
        await fs.writeFile(path.join(root, 'SKILL.md'), '# Workspace authority');
        const files = ['first.md', 'second.md', 'unrelated.md'].map((name) =>
            path.join(tempDir, name)
        );
        for (const file of files)
            await fs.writeFile(
                file,
                `---\nid: ${file.endsWith('unrelated.md') ? 'unrelated' : 'shared'}\n---\nConfigured instructions`
            );
        const skills = createLocalSkills({ workspaceRoot: tempDir });
        registerConfiguredSkillPrompts(
            skills,
            files.map((file) => ({ type: 'file', file }))
        );
        expect((await skills.list()).map((skill) => skill.name)).toEqual(['shared', 'unrelated']);
        expect((await skills.load('shared'))?.instructions).toContain('Workspace authority');
        expect((await skills.load('unrelated'))?.instructions).toContain('Configured instructions');
    });

    it('rejects ambiguous unshadowed configured identities and never reads outside-parent symlink targets', async () => {
        const parent = path.join(tempDir, 'configured');
        await fs.mkdir(parent);
        const first = path.join(parent, 'first.md');
        const second = path.join(parent, 'second.md');
        await fs.writeFile(first, '---\nid: duplicate\n---\nFirst');
        await fs.writeFile(second, '---\nid: duplicate\n---\nSecond');
        const skills = createLocalSkills({ workspaceRoot: tempDir });
        registerConfiguredSkillPrompts(
            skills,
            [first, second].map((file) => ({ type: 'file', file }))
        );
        await expect(skills.list()).rejects.toThrow('Ambiguous configured skill identity');
        await expect(skills.load('duplicate')).rejects.toThrow(
            'Ambiguous configured skill identity'
        );
        const outside = path.join(tempDir, 'outside.md');
        const link = path.join(parent, 'link.md');
        await fs.writeFile(outside, 'Outside instructions');
        await fs.symlink(outside, link);
        registerConfiguredSkillPrompts(skills, [{ type: 'file', file: link }]);
        expect(await skills.list()).toEqual([]);
        expect(await skills.load('link')).toBeNull();
        await fs.unlink(link);
        await fs.symlink(first, link);
        expect((await skills.load('duplicate'))?.instructions).toContain('First');
    });

    it('leaves custom Skills unchanged and replaces configured registrations for a new agent selection', async () => {
        const custom = {
            list: async () => [{ name: 'custom', description: 'Owned by the image' }],
            load: async () => null,
            readFile: async () => 'Image-owned resource',
        };
        registerConfiguredSkillPrompts(custom, [
            { type: 'file', file: path.join(tempDir, 'missing.md') },
        ]);
        expect(await custom.list()).toEqual([
            { name: 'custom', description: 'Owned by the image' },
        ]);
        expect(await custom.readFile()).toBe('Image-owned resource');
        const first = path.join(tempDir, 'first.md');
        const next = path.join(tempDir, 'next.md');
        await fs.writeFile(first, '# First selection');
        await fs.writeFile(next, '# Next selection');
        const skills = createLocalSkills({ workspaceRoot: tempDir });
        registerConfiguredSkillPrompts(skills, [{ type: 'file', file: first }]);
        expect(await skills.load('first')).not.toBeNull();
        registerConfiguredSkillPrompts(skills, [{ type: 'file', file: next }]);
        expect(await skills.load('first')).toBeNull();
        expect((await skills.load('next'))?.instructions).toContain('Next selection');
        registerConfiguredSkillPrompts(skills, undefined);
        expect(await skills.load('next')).toBeNull();
        expect(await skills.list()).toEqual([]);
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
