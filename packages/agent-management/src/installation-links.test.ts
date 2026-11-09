import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installCustomAgent } from './installation.js';

describe.skipIf(process.platform === 'win32')('installCustomAgent with links', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-agent-links-'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('does not copy links out of the agent directory and still installs', async () => {
        const sourceDir = path.join(tempDir, 'my-agent');
        const outsideDir = path.join(tempDir, 'outside');
        const agentsDir = path.join(tempDir, 'agents');
        await fs.mkdir(sourceDir);
        await fs.mkdir(outsideDir);
        await fs.writeFile(path.join(sourceDir, 'agent.yml'), 'systemPrompt: hi\n');
        await fs.writeFile(path.join(outsideDir, 'id_rsa'), 'private contents');
        await fs.symlink(path.join(outsideDir, 'id_rsa'), path.join(sourceDir, 'stolen.txt'));
        await fs.symlink(outsideDir, path.join(sourceDir, 'linked-dir'));

        const installedPath = await installCustomAgent(
            'linked-agent',
            sourceDir,
            { name: 'Linked', description: 'Agent with links', author: 'test', tags: [] },
            { agentsDir }
        );

        const entries = await fs.readdir(path.dirname(installedPath));
        expect(entries).toContain('agent.yml');
        expect(entries).not.toContain('stolen.txt');
        expect(entries).not.toContain('linked-dir');
    });
});
