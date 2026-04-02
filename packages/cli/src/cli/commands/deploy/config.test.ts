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

    it('discovers the registry primary workspace agent', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            'agents/registry.json': JSON.stringify({
                primaryAgent: 'review-agent',
                agents: [
                    {
                        id: 'review-agent',
                        name: 'Review Agent',
                        description: 'Primary workspace agent',
                        configPath: './review-agent/review-agent.yml',
                    },
                ],
            }),
            'agents/review-agent/review-agent.yml': 'agentCard:\n  name: Review Agent\n',
        });

        const candidate = await discoverPrimaryWorkspaceAgent(tempDir);
        expect(candidate).toBe('agents/review-agent/review-agent.yml');
    });

    it('infers the only registry agent when no primaryAgent is set', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            'agents/registry.json': JSON.stringify({
                agents: [
                    {
                        id: 'review-agent',
                        name: 'Review Agent',
                        description: 'Primary workspace agent',
                        configPath: './review-agent/review-agent.yml',
                    },
                ],
            }),
            'agents/review-agent/review-agent.yml': 'agentCard:\n  name: Review Agent\n',
        });

        const candidate = await discoverPrimaryWorkspaceAgent(tempDir);
        expect(candidate).toBe('agents/review-agent/review-agent.yml');
    });

    it('returns null when no registry default or compatibility agent exists', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            'agents/registry.json': JSON.stringify({
                agents: [
                    {
                        id: 'review-agent',
                        name: 'Review Agent',
                        description: 'Reviews changes',
                        configPath: './review-agent/review-agent.yml',
                    },
                    {
                        id: 'explore-agent',
                        name: 'Explore Agent',
                        description: 'Explores the workspace',
                        configPath: './explore-agent/explore-agent.yml',
                    },
                ],
            }),
            'agents/review-agent/review-agent.yml': 'agentCard:\n  name: Review Agent\n',
            'agents/explore-agent/explore-agent.yml': 'agentCard:\n  name: Explore Agent\n',
        });

        const candidate = await discoverPrimaryWorkspaceAgent(tempDir);
        expect(candidate).toBeNull();
    });

    it('throws when registry primaryAgent points to a missing workspace agent', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            'agents/registry.json': JSON.stringify({
                primaryAgent: 'review-agent',
                agents: [
                    {
                        id: 'review-agent',
                        name: 'Review Agent',
                        description: 'Primary workspace agent',
                        configPath: './review-agent/review-agent.yml',
                    },
                ],
            }),
        });

        await expect(discoverPrimaryWorkspaceAgent(tempDir)).rejects.toThrow(
            `Agent 'review-agent' in ${path.join(tempDir, 'agents', 'registry.json')} has invalid configPath './review-agent/review-agent.yml': file does not exist.`
        );
    });

    it('rejects registry configPath values that point to directories', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            'agents/registry.json': JSON.stringify({
                primaryAgent: 'review-agent',
                agents: [
                    {
                        id: 'review-agent',
                        name: 'Review Agent',
                        description: 'Primary workspace agent',
                        configPath: './review-agent',
                    },
                ],
            }),
            'agents/review-agent/.gitkeep': '',
        });

        await expect(discoverPrimaryWorkspaceAgent(tempDir)).rejects.toThrow(
            `Agent 'review-agent' in ${path.join(tempDir, 'agents', 'registry.json')} has invalid configPath './review-agent': path must point to a file.`
        );
    });

    it('wraps malformed deploy json errors with the config path', async () => {
        tempDir = createTempDir();
        writeWorkspaceFiles(tempDir, {
            '.dexto/deploy.json': '{"version":1,"agent":',
        });

        await expect(loadDeployConfig(tempDir)).rejects.toThrow(
            `Failed to parse deploy config at ${path.join(tempDir, '.dexto', 'deploy.json')}`
        );
    });

    it('rejects paths that escape the workspace', () => {
        expect(() => normalizeWorkspaceRelativePath('../agents/reviewer.yml')).toThrow(
            'Path must stay inside the workspace'
        );
    });
});
