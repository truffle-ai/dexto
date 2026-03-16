import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { list as listTar } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceSnapshot } from './snapshot.js';

function createTempDir(): string {
    return fs.mkdtempSync(path.join(tmpdir(), 'dexto-deploy-snapshot-'));
}

function writeWorkspaceFiles(workspaceRoot: string, files: Record<string, string>): void {
    for (const [relativePath, content] of Object.entries(files)) {
        const absolutePath = path.join(workspaceRoot, relativePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, content, 'utf8');
    }
}

async function listArchiveEntries(archivePath: string): Promise<string[]> {
    const entries: string[] = [];
    await listTar({
        file: archivePath,
        onentry: (entry) => {
            entries.push(entry.path.replace(/\\/g, '/'));
        },
    });
    return entries;
}

describe('workspace snapshot packaging', () => {
    let tempDir: string | null = null;

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            tempDir = null;
        }
    });

    it('excludes ignored files but keeps the entry agent', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            'coding-agent.yml': 'agentCard:\n  name: Coding Agent\n',
            '.git/config': '[core]\n',
            '.env.local': 'SECRET=1\n',
            'src/index.ts': 'console.log("hello");\n',
        });

        const snapshot = await createWorkspaceSnapshot({
            workspaceRoot: tempDir,
            workspaceAgentPath: 'coding-agent.yml',
            exclude: ['.git', '.env*'],
        });

        try {
            const entries = await listArchiveEntries(snapshot.archivePath);
            expect(entries).toContain('workspace/coding-agent.yml');
            expect(entries).toContain('workspace/src/index.ts');
            expect(entries).not.toContain('workspace/.git/config');
            expect(entries).not.toContain('workspace/.env.local');
        } finally {
            await snapshot.cleanup();
        }
    });

    it('fails when the selected entry agent is excluded', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            'coding-agent.yml': 'agentCard:\n  name: Coding Agent\n',
        });

        await expect(
            createWorkspaceSnapshot({
                workspaceRoot: tempDir,
                workspaceAgentPath: 'coding-agent.yml',
                exclude: ['coding-agent.yml'],
            })
        ).rejects.toThrow('Deploy config excludes the selected workspace agent');
    });

    it('allows cloud-default deploys without a workspace agent file', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            'README.md': '# Hello\n',
            'src/index.ts': 'console.log("hello");\n',
        });

        const snapshot = await createWorkspaceSnapshot({
            workspaceRoot: tempDir,
            exclude: ['.git'],
        });

        try {
            const entries = await listArchiveEntries(snapshot.archivePath);
            expect(entries).toContain('workspace/README.md');
            expect(entries).toContain('workspace/src/index.ts');
        } finally {
            await snapshot.cleanup();
        }
    });
});
