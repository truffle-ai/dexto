import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockGlobalPreferencesExist,
    mockIntro,
    mockLoadGlobalPreferences,
    mockNote,
    mockOutro,
    mockSelectOrExit,
    mockTextOrExit,
} = vi.hoisted(() => ({
    mockGlobalPreferencesExist: vi.fn(),
    mockIntro: vi.fn(),
    mockLoadGlobalPreferences: vi.fn(),
    mockNote: vi.fn(),
    mockOutro: vi.fn(),
    mockSelectOrExit: vi.fn(),
    mockTextOrExit: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
    intro: mockIntro,
    note: mockNote,
    outro: mockOutro,
}));

vi.mock('../utils/prompt-helpers.js', () => ({
    selectOrExit: mockSelectOrExit,
    textOrExit: mockTextOrExit,
}));

vi.mock('@dexto/agent-management', async () => {
    const actual =
        await vi.importActual<typeof import('@dexto/agent-management')>('@dexto/agent-management');
    return {
        ...actual,
        globalPreferencesExist: mockGlobalPreferencesExist,
        loadGlobalPreferences: mockLoadGlobalPreferences,
    };
});

import {
    createWorkspaceAgentScaffold,
    createWorkspaceScaffold,
    createWorkspaceSkillScaffold,
    handleInitAgentCommand,
    handleInitCommand,
    handleInitPrimaryCommand,
    handleInitSkillCommand,
    linkWorkspaceSubagentToPrimaryAgent,
    setWorkspacePrimaryAgent,
} from './init.js';

describe('init command', () => {
    let tempDir: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-init-workspace-'));
        mockGlobalPreferencesExist.mockReturnValue(false);
        mockLoadGlobalPreferences.mockRejectedValue(new Error('preferences unavailable'));
        mockSelectOrExit.mockReset();
        mockTextOrExit.mockReset();
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('creates AGENTS.md plus authored agents and skills directories', async () => {
        const result = await createWorkspaceScaffold(tempDir);

        expect(result.root).toBe(tempDir);
        expect(result.agentsFile.status).toBe('created');
        expect(result.directories).toEqual([
            { path: path.join(tempDir, 'agents'), status: 'created' },
            { path: path.join(tempDir, 'skills'), status: 'created' },
        ]);

        const agentsMd = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf8');
        expect(agentsMd).toContain('# Dexto Workspace');
        expect(agentsMd).toContain('agents/');
        expect(agentsMd).toContain('skills/<skill-id>/SKILL.md');
        expect(agentsMd).toContain('.dexto/');

        expect((await fs.stat(path.join(tempDir, 'agents'))).isDirectory()).toBe(true);
        expect((await fs.stat(path.join(tempDir, 'skills'))).isDirectory()).toBe(true);
    });

    it('does not overwrite an existing AGENTS.md file', async () => {
        const customAgentsMd = '# Custom Workspace\n';
        await fs.writeFile(path.join(tempDir, 'AGENTS.md'), customAgentsMd, 'utf8');

        const result = await createWorkspaceScaffold(tempDir);

        expect(result.agentsFile.status).toBe('existing');
        expect(result.directories).toEqual([
            { path: path.join(tempDir, 'agents'), status: 'created' },
            { path: path.join(tempDir, 'skills'), status: 'created' },
        ]);
        await expect(fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf8')).resolves.toBe(
            customAgentsMd
        );
    });

    it('fails without partial writes when a scaffold path conflicts with a file', async () => {
        await fs.writeFile(path.join(tempDir, 'agents'), 'not a directory', 'utf8');

        await expect(createWorkspaceScaffold(tempDir)).rejects.toThrow(
            `${path.join(tempDir, 'agents')} exists and is not a directory`
        );

        await expect(fs.access(path.join(tempDir, 'AGENTS.md'))).rejects.toThrow();
        await expect(fs.access(path.join(tempDir, 'skills'))).rejects.toThrow();
    });

    it('creates a workspace agent and project registry when missing', async () => {
        const result = await createWorkspaceAgentScaffold('coding-agent', {}, tempDir);

        expect(result.workspace.agentsFile.status).toBe('created');
        expect(result.registry.status).toBe('created');
        expect(result.agentConfig.status).toBe('created');

        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            primaryAgent?: string;
            allowGlobalAgents?: boolean;
            agents: Array<{ id: string; configPath: string }>;
        };
        expect(registryContent).toEqual({
            primaryAgent: 'coding-agent',
            allowGlobalAgents: false,
            agents: [
                {
                    id: 'coding-agent',
                    name: 'Coding Agent',
                    description: 'Primary workspace agent for this project.',
                    configPath: './coding-agent/coding-agent.yml',
                },
            ],
        });
        expect(result.primaryAgent).toEqual({ id: 'coding-agent', status: 'set' });

        const configContent = parseYaml(
            await fs.readFile(
                path.join(tempDir, 'agents', 'coding-agent', 'coding-agent.yml'),
                'utf8'
            )
        ) as {
            agentId: string;
            image: string;
            llm: { provider: string; model: string; apiKey: string };
        };
        expect(configContent.agentId).toBe('coding-agent');
        expect(configContent.image).toBe('@dexto/image-local');
        expect(configContent.llm).toEqual({
            provider: 'openai',
            model: 'gpt-5-mini',
            apiKey: '$OPENAI_API_KEY',
        });
    });

    it('writes allowGlobalAgents as false in new workspace registries', async () => {
        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);

        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            allowGlobalAgents?: boolean;
        };

        expect(registryContent.allowGlobalAgents).toBe(false);
    });

    it('uses global preferences when scaffolding an agent config', async () => {
        mockGlobalPreferencesExist.mockReturnValue(true);
        mockLoadGlobalPreferences.mockResolvedValue({
            llm: {
                provider: 'anthropic',
                model: 'claude-sonnet-4-5-20250929',
                apiKey: '$ANTHROPIC_API_KEY',
                baseURLPending: false,
            },
            defaults: {
                defaultAgent: 'coding-agent',
                defaultMode: 'web',
            },
            setup: {
                completed: true,
                baseURLPending: false,
            },
            sounds: {
                enabled: false,
                onStartup: false,
                onApprovalRequired: false,
                onTaskComplete: false,
            },
        });

        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);

        const configContent = parseYaml(
            await fs.readFile(
                path.join(tempDir, 'agents', 'review-agent', 'review-agent.yml'),
                'utf8'
            )
        ) as {
            llm: { provider: string; model: string; apiKey: string };
        };
        expect(configContent.llm).toEqual({
            provider: 'anthropic',
            model: 'claude-sonnet-4-5-20250929',
            apiKey: '$ANTHROPIC_API_KEY',
        });
    });

    it('sets the first non-subagent as the workspace primary agent', async () => {
        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);

        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            primaryAgent?: string;
        };
        expect(registryContent.primaryAgent).toBe('review-agent');
    });

    it('does not infer a subagent as the workspace primary agent', async () => {
        await createWorkspaceAgentScaffold('explore-agent', { subagent: true }, tempDir);
        const result = await createWorkspaceAgentScaffold('review-agent', {}, tempDir);

        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            primaryAgent?: string;
        };

        expect(registryContent.primaryAgent).toBe('review-agent');
        expect(result.primaryAgent).toEqual({ id: 'review-agent', status: 'set' });
    });

    it('does not replace an existing primary agent unless requested', async () => {
        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);

        const result = await createWorkspaceAgentScaffold('helper-agent', {}, tempDir);
        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            primaryAgent?: string;
        };

        expect(registryContent.primaryAgent).toBe('review-agent');
        expect(result.primaryAgent).toEqual({ id: 'review-agent', status: 'unchanged' });
    });

    it('can promote a workspace agent to primary', async () => {
        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);
        await createWorkspaceAgentScaffold('helper-agent', {}, tempDir);

        const result = await setWorkspacePrimaryAgent('helper-agent', tempDir);
        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            primaryAgent?: string;
        };

        expect(registryContent.primaryAgent).toBe('helper-agent');
        expect(result.primaryAgent).toEqual({ id: 'helper-agent', status: 'set' });
    });

    it('rejects invalid existing registries before adding new agents', async () => {
        await createWorkspaceScaffold(tempDir);
        await fs.writeFile(
            path.join(tempDir, 'agents', 'registry.json'),
            JSON.stringify({
                primaryAgent: 'missing-agent',
                agents: [],
            }),
            'utf8'
        );

        await expect(createWorkspaceAgentScaffold('helper-agent', {}, tempDir)).rejects.toThrow(
            "Primary agent 'missing-agent' not found"
        );
    });

    it('fails before creating files when the registry already maps an agent id to another path', async () => {
        await createWorkspaceScaffold(tempDir);
        await fs.writeFile(
            path.join(tempDir, 'agents', 'registry.json'),
            JSON.stringify(
                {
                    agents: [
                        {
                            id: 'helper-agent',
                            name: 'Helper Agent',
                            description: 'Existing helper agent',
                            configPath: './somewhere-else/helper-agent.yml',
                        },
                    ],
                },
                null,
                2
            ),
            'utf8'
        );

        await expect(createWorkspaceAgentScaffold('helper-agent', {}, tempDir)).rejects.toThrow(
            "Agent 'helper-agent' already exists"
        );

        await expect(
            fs.access(path.join(tempDir, 'agents', 'helper-agent', 'helper-agent.yml'))
        ).rejects.toThrow();
    });

    it('creates a sub-agent scaffold and marks it in the registry', async () => {
        const result = await createWorkspaceAgentScaffold(
            'explore-agent',
            { subagent: true },
            tempDir
        );

        expect(result.registry.status).toBe('created');

        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            primaryAgent?: string;
            agents: Array<{ id: string; tags?: string[]; parentAgentId?: string }>;
        };
        expect(registryContent.agents[0]).toMatchObject({
            id: 'explore-agent',
            tags: ['subagent'],
        });
        expect(registryContent.primaryAgent).toBeUndefined();
        expect(registryContent.agents[0]?.parentAgentId).toBeUndefined();

        const configContent = await fs.readFile(
            path.join(tempDir, 'agents', 'explore-agent', 'explore-agent.yml'),
            'utf8'
        );
        expect(configContent).toContain('specialized sub-agent');
    });

    it('links a subagent to the current primary agent', async () => {
        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);
        await createWorkspaceAgentScaffold('explore-agent', { subagent: true }, tempDir);

        const result = await linkWorkspaceSubagentToPrimaryAgent('explore-agent', tempDir);
        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            primaryAgent?: string;
            agents: Array<{ id: string; parentAgentId?: string }>;
        };

        expect(result).toMatchObject({
            subagentId: 'explore-agent',
            parentAgentId: 'review-agent',
            status: 'set',
        });
        expect(
            registryContent.agents.find((entry) => entry.id === 'explore-agent')?.parentAgentId
        ).toBe('review-agent');
    });

    it('converts an existing non-primary agent into a subagent when requested', async () => {
        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);
        await createWorkspaceAgentScaffold('explore-agent', {}, tempDir);
        const result = await createWorkspaceAgentScaffold(
            'explore-agent',
            { subagent: true },
            tempDir
        );

        expect(result.registry.status).toBe('updated');

        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            agents: Array<{ id: string; tags?: string[] }>;
        };

        expect(registryContent.agents.find((entry) => entry.id === 'explore-agent')).toMatchObject({
            tags: ['subagent'],
        });
    });

    it('rejects promoting a subagent to primary', async () => {
        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);
        await createWorkspaceAgentScaffold('explore-agent', { subagent: true }, tempDir);

        await expect(setWorkspacePrimaryAgent('explore-agent', tempDir)).rejects.toThrow(
            "Agent 'explore-agent' is marked as a subagent"
        );
    });

    it('creates a skill scaffold under skills/<id>/SKILL.md', async () => {
        const result = await createWorkspaceSkillScaffold('code-review', tempDir);

        expect(result.workspace.agentsFile.status).toBe('created');
        expect(result.skillFile.status).toBe('created');

        const skillContent = await fs.readFile(
            path.join(tempDir, 'skills', 'code-review', 'SKILL.md'),
            'utf8'
        );
        expect(skillContent).toContain('name: "code-review"');
        expect(skillContent).toContain('# Code Review');
        expect(skillContent).toContain('## Purpose');
        expect(skillContent).toContain('## Output Format');
    });

    it('reports when the workspace is already initialized', async () => {
        await createWorkspaceScaffold(tempDir);

        await handleInitCommand(tempDir);

        expect(mockIntro).toHaveBeenCalledTimes(1);
        expect(mockNote).not.toHaveBeenCalled();
        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining('Workspace already initialized.')
        );
    });

    it('reports when an agent scaffold already exists', async () => {
        await createWorkspaceAgentScaffold('coding-agent', {}, tempDir);

        await handleInitAgentCommand('coding-agent', {}, tempDir);

        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining("Agent 'coding-agent' already initialized.")
        );
    });

    it('prompts for agent kind and id when no id is provided', async () => {
        mockSelectOrExit.mockResolvedValue('primary');
        mockTextOrExit.mockResolvedValue('review-agent');

        await handleInitAgentCommand(undefined, {}, tempDir);

        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            primaryAgent?: string;
            agents: Array<{ id: string }>;
        };
        expect(mockSelectOrExit).toHaveBeenCalledTimes(1);
        expect(mockTextOrExit).toHaveBeenCalledTimes(1);
        expect(registryContent.primaryAgent).toBe('review-agent');
        expect(registryContent.agents[0]?.id).toBe('review-agent');
    });

    it('auto-links a new subagent to the workspace primary agent', async () => {
        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);

        await handleInitAgentCommand('explore-agent', { subagent: true }, tempDir);

        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            primaryAgent?: string;
            agents: Array<{ id: string; parentAgentId?: string }>;
        };
        expect(
            registryContent.agents.find((entry) => entry.id === 'explore-agent')?.parentAgentId
        ).toBe('review-agent');
        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining('Linked to primary agent: review-agent')
        );
    });

    it('reports when the requested primary agent is already set', async () => {
        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);

        await handleInitPrimaryCommand('review-agent', tempDir);

        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining("'review-agent' is already the workspace primary agent.")
        );
    });

    it('reports when a skill scaffold already exists', async () => {
        await createWorkspaceSkillScaffold('code-review', tempDir);

        await handleInitSkillCommand('code-review', tempDir);

        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining("Skill 'code-review' already initialized.")
        );
    });
});
