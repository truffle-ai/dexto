import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDeployConfig, normalizeWorkspaceRelativePath, saveDeployConfig } from './config.js';
import { discoverPrimaryWorkspaceAgent } from './entry-agent.js';

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

    it('normalizes and reloads workspace agent paths', async () => {
        tempDir = createTempDir();
        await saveDeployConfig(tempDir, {
            agent: {
                type: 'workspace',
                path: 'agents\\reviewer\\reviewer.yml',
            },
            exclude: ['.git'],
        });

        const loaded = await loadDeployConfig(tempDir);
        expect(loaded).not.toBeNull();
        expect(loaded?.agent).toEqual({
            type: 'workspace',
            path: 'agents/reviewer/reviewer.yml',
        });
        expect(loaded?.exclude).toEqual(['.git']);
    });

    it('normalizes legacy persisted entryAgent configs on load', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            '.dexto/deploy.json': JSON.stringify(
                {
                    version: 1,
                    entryAgent: 'agents\\reviewer\\reviewer.yml',
                    exclude: ['.git'],
                },
                null,
                2
            ),
        });

        const loaded = await loadDeployConfig(tempDir);
        expect(loaded).not.toBeNull();
        expect(loaded?.agent).toEqual({
            type: 'workspace',
            path: 'agents/reviewer/reviewer.yml',
        });
        expect(loaded?.exclude).toEqual(['.git']);
    });

    it('discovers the primary workspace agent from agents only', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            'coding-agent.yml': 'agentCard:\n  name: Root Agent\n',
            'agents/coding-agent.yml': 'agentCard:\n  name: Agent\n',
            'src/dexto/agents/coding-agent.yml': 'agentCard:\n  name: Src Agent\n',
        });

        const candidate = await discoverPrimaryWorkspaceAgent(tempDir);
        expect(candidate).toBe('agents/coding-agent.yml');
    });

    it('returns null when no primary workspace agent exists under agents', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            'coding-agent.yml': 'agentCard:\n  name: Root Agent\n',
            'agents/reviewer/reviewer.yml': 'agentCard:\n  name: Reviewer\n',
            'src/dexto/agents/coding-agent.yml': 'agentCard:\n  name: Src Agent\n',
        });

        const candidate = await discoverPrimaryWorkspaceAgent(tempDir);
        expect(candidate).toBeNull();
    });

    it('rejects paths that escape the workspace', () => {
        expect(() => normalizeWorkspaceRelativePath('../agents/reviewer.yml')).toThrow(
            'Path must stay inside the workspace'
        );
    });
});
