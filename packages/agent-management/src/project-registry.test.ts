import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    loadProjectRegistry,
    readProjectRegistry,
    resolveDefaultProjectRegistryAgentPath,
    resolveProjectRegistryAgentPath,
} from './project-registry.js';

describe('project registry', () => {
    let tempDir: string | null = null;

    afterEach(async () => {
        if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true });
            tempDir = null;
        }
    });

    async function createWorkspace(files: Record<string, string>): Promise<string> {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-project-registry-'));

        for (const [relativePath, content] of Object.entries(files)) {
            const absolutePath = path.join(tempDir, relativePath);
            await fs.mkdir(path.dirname(absolutePath), { recursive: true });
            await fs.writeFile(absolutePath, content, 'utf8');
        }

        return tempDir;
    }

    it('rejects duplicate agent ids', async () => {
        const workspaceRoot = await createWorkspace({
            'agents/registry.json': JSON.stringify({
                agents: [
                    {
                        id: 'review-agent',
                        name: 'Review Agent',
                        description: 'Primary workspace agent',
                        configPath: './review-agent/review-agent.yml',
                    },
                    {
                        id: 'review-agent',
                        name: 'Review Agent Copy',
                        description: 'Duplicate id',
                        configPath: './copy/review-agent.yml',
                    },
                ],
            }),
        });

        await expect(
            readProjectRegistry(path.join(workspaceRoot, 'agents', 'registry.json'))
        ).rejects.toMatchObject({
            name: 'ProjectRegistryError',
            code: 'PROJECT_REGISTRY_INVALID',
        });
    });

    it('rejects primaryAgent values missing from the registry agents list', async () => {
        const workspaceRoot = await createWorkspace({
            'agents/registry.json': JSON.stringify({
                primaryAgent: 'review-agent',
                agents: [],
            }),
        });

        await expect(
            readProjectRegistry(path.join(workspaceRoot, 'agents', 'registry.json'))
        ).rejects.toMatchObject({
            name: 'ProjectRegistryError',
            code: 'PROJECT_REGISTRY_INVALID_PRIMARY',
            agentId: 'review-agent',
        });
    });

    it('rejects configPath values that escape the workspace root', async () => {
        const workspaceRoot = await createWorkspace({
            'agents/registry.json': JSON.stringify({
                primaryAgent: 'review-agent',
                agents: [
                    {
                        id: 'review-agent',
                        name: 'Review Agent',
                        description: 'Primary workspace agent',
                        configPath: '../../outside.yml',
                    },
                ],
            }),
        });

        await expect(resolveDefaultProjectRegistryAgentPath(workspaceRoot)).rejects.toMatchObject({
            name: 'ProjectRegistryError',
            code: 'PROJECT_REGISTRY_INVALID_CONFIG_PATH',
            agentId: 'review-agent',
        });
    });

    it('rejects configPath values that point to directories', async () => {
        const workspaceRoot = await createWorkspace({
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

        await expect(
            resolveProjectRegistryAgentPath(workspaceRoot, 'review-agent')
        ).rejects.toMatchObject({
            name: 'ProjectRegistryError',
            code: 'PROJECT_REGISTRY_INVALID_CONFIG_PATH',
            agentId: 'review-agent',
        });
    });

    it('ignores bundled agent-registry.json files when searching for a project registry', async () => {
        const workspaceRoot = await createWorkspace({
            'agents/agent-registry.json': JSON.stringify({
                version: '1.0.0',
                agents: {
                    'coding-agent': {
                        id: 'coding-agent',
                        name: 'Coding Agent',
                        description: 'Bundled registry entry',
                        author: 'Truffle AI',
                        tags: ['coding'],
                        source: 'coding-agent/',
                        main: 'coding-agent.yml',
                    },
                },
            }),
        });

        await expect(loadProjectRegistry(workspaceRoot)).resolves.toBeNull();
        await expect(resolveDefaultProjectRegistryAgentPath(workspaceRoot)).resolves.toBeNull();
    });

    it('still supports legacy project agent-registry.json fallback with array entries', async () => {
        const workspaceRoot = await createWorkspace({
            'agents/agent-registry.json': JSON.stringify({
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
            'agents/review-agent/review-agent.yml': 'llm:\n  provider: openai\n  model: gpt-5',
        });

        await expect(loadProjectRegistry(workspaceRoot)).resolves.toMatchObject({
            registry: {
                primaryAgent: 'review-agent',
                allowGlobalAgents: false,
                agents: [
                    expect.objectContaining({
                        id: 'review-agent',
                        configPath: './review-agent/review-agent.yml',
                    }),
                ],
            },
        });
    });
});
