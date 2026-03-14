import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDeployConfig, normalizeWorkspaceRelativePath, saveDeployConfig } from './config.js';
import { discoverEntryAgentCandidates } from './entry-agent.js';

function createTempDir(): string {
    return fs.mkdtempSync(path.join(tmpdir(), 'dexto-deploy-config-'));
}

function writeWorkspaceFiles(workspaceRoot: string, files: Record<string, string>): void {
    for (const [relativePath, content] of Object.entries(files)) {
        const absolutePath = path.join(workspaceRoot, relativePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, content, 'utf8');
    }
}

describe('deploy config', () => {
    let tempDir: string | null = null;

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            tempDir = null;
        }
    });

    it('normalizes and reloads entry-agent paths', async () => {
        tempDir = createTempDir();
        await saveDeployConfig(tempDir, {
            entryAgent: 'agents\\reviewer\\reviewer.yml',
            exclude: ['.git'],
        });

        const loaded = await loadDeployConfig(tempDir);
        expect(loaded).not.toBeNull();
        expect(loaded?.entryAgent).toBe('agents/reviewer/reviewer.yml');
        expect(loaded?.exclude).toEqual(['.git']);
    });

    it('discovers the opinionated entry-agent locations in order', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            'coding-agent.yml': 'agentCard:\n  name: Coding Agent\n',
            'agents/builder/builder.yml': 'agentCard:\n  name: Builder\n',
            'agents/reviewer/reviewer.yaml': 'agentCard:\n  name: Reviewer\n',
            'agents/notes.txt': 'skip me',
        });

        const candidates = await discoverEntryAgentCandidates(tempDir);
        expect(candidates).toEqual([
            'coding-agent.yml',
            'agents/builder/builder.yml',
            'agents/reviewer/reviewer.yaml',
        ]);
    });

    it('rejects paths that escape the workspace', () => {
        expect(() => normalizeWorkspaceRelativePath('../agents/reviewer.yml')).toThrow(
            'Path must stay inside the workspace'
        );
    });
});
