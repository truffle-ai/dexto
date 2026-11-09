import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPluginFromPath } from './install-plugin.js';

describe.skipIf(process.platform === 'win32')('installPluginFromPath with links', () => {
    let tempDir: string;
    let previousHome: string | undefined;
    let previousUserProfile: string | undefined;

    beforeEach(async () => {
        tempDir = await fs.realpath(
            await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-plugin-links-'))
        );
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

    async function createPlugin(): Promise<string> {
        const pluginDir = path.join(tempDir, 'source', 'linky');
        await fs.mkdir(path.join(pluginDir, '.claude-plugin'), { recursive: true });
        await fs.mkdir(path.join(pluginDir, 'commands'));
        await fs.writeFile(
            path.join(pluginDir, '.claude-plugin', 'plugin.json'),
            JSON.stringify({ name: 'linky', description: 'Plugin with links', version: '1.0.0' })
        );
        await fs.writeFile(path.join(pluginDir, 'commands', 'hello.md'), '# Hello\n');
        return pluginDir;
    }

    it('installs without copying a file link that points outside the plugin', async () => {
        const pluginDir = await createPlugin();
        const outsideFile = path.join(tempDir, 'outside-secret.txt');
        await fs.writeFile(outsideFile, 'private contents');
        await fs.symlink(outsideFile, path.join(pluginDir, 'stolen.txt'));

        const result = await installPluginFromPath(pluginDir, {
            scope: 'project',
            projectPath: path.join(tempDir, 'project'),
        });

        const installed = result.installPath;
        await expect(
            fs.readFile(path.join(installed, 'commands', 'hello.md'), 'utf8')
        ).resolves.toBe('# Hello\n');
        await expect(fs.lstat(path.join(installed, 'stolen.txt'))).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });

    it('installs when the plugin contains a link to a directory', async () => {
        const pluginDir = await createPlugin();
        const outsideDir = path.join(tempDir, 'outside-dir');
        await fs.mkdir(outsideDir);
        await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'private contents');
        await fs.symlink(outsideDir, path.join(pluginDir, 'linked-outside'));
        await fs.symlink(path.join(pluginDir, 'commands'), path.join(pluginDir, 'linked-inside'));

        const result = await installPluginFromPath(pluginDir, {
            scope: 'project',
            projectPath: path.join(tempDir, 'project'),
        });

        const installed = await fs.readdir(result.installPath);
        expect(installed).toContain('commands');
        expect(installed).not.toContain('linked-outside');
        expect(installed).not.toContain('linked-inside');
    });
});
