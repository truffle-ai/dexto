import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalSkillSources } from './local-skill-sources.js';

describe('createLocalSkillSources', () => {
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

    it('discovers user-global and plugin skills through SkillSource', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const userSkillDir = path.join(tempDir, 'home', '.dexto', 'skills', 'global-review');
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
            '# Audit\n\nAudit through plugin skill.',
            'utf8'
        );

        const sources = createLocalSkillSources({ workspaceRoot });
        const skills = await sources[0]!.list();

        expect(skills.map((skill) => skill.id).sort()).toEqual(['global-review', 'review:audit']);
        await expect(sources[0]!.get?.('review:audit')).resolves.toMatchObject({
            id: 'review:audit',
            instructions: expect.stringContaining('Audit through plugin skill.'),
        });
    });
});
