import { EventEmitter } from 'node:events';
import { promises as fs, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockConfirmOrExit,
    mockCreateDextoAgentFromConfig,
    mockGetEffectiveLLMConfig,
    mockIntro,
    mockLogInfo,
    mockLogWarn,
    mockMultiselectOrExit,
    mockNote,
    mockOutro,
    mockSelectOrExit,
    mockSpawn,
    mockSpinnerStart,
    mockSpinnerStop,
    mockTextOrExit,
} = vi.hoisted(() => ({
    mockConfirmOrExit: vi.fn(),
    mockCreateDextoAgentFromConfig: vi.fn(),
    mockGetEffectiveLLMConfig: vi.fn(),
    mockIntro: vi.fn(),
    mockLogInfo: vi.fn(),
    mockLogWarn: vi.fn(),
    mockMultiselectOrExit: vi.fn(),
    mockNote: vi.fn(),
    mockOutro: vi.fn(),
    mockSelectOrExit: vi.fn(),
    mockSpawn: vi.fn(),
    mockSpinnerStart: vi.fn(),
    mockSpinnerStop: vi.fn(),
    mockTextOrExit: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
    intro: mockIntro,
    note: mockNote,
    outro: mockOutro,
    spinner: () => ({
        start: mockSpinnerStart,
        stop: mockSpinnerStop,
    }),
    log: {
        info: mockLogInfo,
        warn: mockLogWarn,
    },
}));

vi.mock('node:child_process', async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    return {
        ...actual,
        spawn: mockSpawn,
    };
});

vi.mock('../utils/prompt-helpers.js', () => ({
    confirmOrExit: mockConfirmOrExit,
    multiselectOrExit: mockMultiselectOrExit,
    selectOrExit: mockSelectOrExit,
    textOrExit: mockTextOrExit,
}));

vi.mock('@dexto/agent-management', async () => {
    const actual =
        await vi.importActual<typeof import('@dexto/agent-management')>('@dexto/agent-management');
    return {
        ...actual,
        createDextoAgentFromConfig: mockCreateDextoAgentFromConfig,
    };
});

vi.mock('../../config/effective-llm.js', () => ({
    getEffectiveLLMConfig: mockGetEffectiveLLMConfig,
}));

import {
    createWorkspaceAgentScaffold,
    createWorkspaceScaffold,
    createWorkspaceSkillScaffold,
    handleInitAgentCommand,
    handleInitCommand,
    handleInitPrimaryCommand,
    handleInitSkillCommand,
    handleInitStatusCommand,
    inspectWorkspaceStatus,
    linkWorkspaceSubagentToPrimaryAgent,
    setWorkspacePrimaryAgent,
} from './init.js';
import { saveDeployConfig, createWorkspaceDeployConfig } from './deploy/config.js';

describe('init command', () => {
    let tempDir: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-init-workspace-'));
        mockConfirmOrExit.mockReset();
        mockCreateDextoAgentFromConfig.mockReset();
        mockGetEffectiveLLMConfig.mockReset();
        mockLogInfo.mockReset();
        mockMultiselectOrExit.mockReset();
        mockSelectOrExit.mockReset();
        mockSpawn.mockReset();
        mockSpinnerStart.mockReset();
        mockSpinnerStop.mockReset();
        mockTextOrExit.mockReset();
        mockGetEffectiveLLMConfig.mockResolvedValue({
            provider: 'openai',
            model: 'gpt-5-mini',
            apiKey: '$OPENAI_API_KEY',
            source: 'preferences',
        });
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
        expect(agentsMd).toContain('skills/<skill-id>/');
        expect(agentsMd).toContain('`SKILL.md` plus optional `handlers/`');
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
            image: string;
            llm: { provider: string; model: string; apiKey: string };
            systemPrompt: {
                contributors: Array<{
                    id: string;
                    type: string;
                    source?: string;
                    content?: string;
                }>;
            };
            elicitation?: { enabled?: boolean };
        };
        expect(configContent.image).toBe('@dexto/image-local');
        expect(configContent.llm).toEqual({
            provider: 'openai',
            model: 'gpt-5.3-codex',
            apiKey: '$OPENAI_API_KEY',
        });
        expect(configContent.systemPrompt.contributors).toEqual([
            expect.objectContaining({
                id: 'primary',
                type: 'static',
            }),
            expect.objectContaining({
                id: 'date',
                type: 'dynamic',
                source: 'date',
            }),
            expect.objectContaining({
                id: 'env',
                type: 'dynamic',
                source: 'env',
            }),
        ]);
        expect(configContent.elicitation).toEqual({ enabled: true });
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

    it('does not inherit global preferences when scaffolding an agent config', async () => {
        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);

        const configContent = parseYaml(
            await fs.readFile(
                path.join(tempDir, 'agents', 'review-agent', 'review-agent.yml'),
                'utf8'
            )
        ) as {
            llm: { provider: string; model: string; apiKey: string; baseURL?: string };
        };
        expect(configContent.llm).toEqual({
            provider: 'openai',
            model: 'gpt-5.3-codex',
            apiKey: '$OPENAI_API_KEY',
        });
        expect(configContent.llm.baseURL).toBeUndefined();
    });

    it('writes interactive customizations into the scaffolded agent config', async () => {
        await createWorkspaceAgentScaffold(
            'product-strategist',
            {
                displayName: 'Product Strategist',
                description: 'Shapes product direction for this workspace.',
                systemPrompt:
                    'You are Product Strategist.\n\nDrive product decisions with clarity.',
                greeting: 'Ready to shape the roadmap.',
                tools: [
                    {
                        type: 'builtin-tools',
                        enabledTools: ['ask_user', 'invoke_skill'],
                    },
                    {
                        type: 'plan-tools',
                    },
                ],
            },
            tempDir
        );

        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            agents: Array<{ id: string; name: string; description: string }>;
        };
        expect(registryContent.agents[0]).toMatchObject({
            id: 'product-strategist',
            name: 'Product Strategist',
            description: 'Shapes product direction for this workspace.',
        });

        const configContent = parseYaml(
            await fs.readFile(
                path.join(tempDir, 'agents', 'product-strategist', 'product-strategist.yml'),
                'utf8'
            )
        ) as {
            systemPrompt: {
                contributors: Array<{ id: string; type: string; content?: string }>;
            };
            greeting: string;
            tools: Array<{ type: string; enabledTools?: string[] }>;
            elicitation?: { enabled?: boolean };
            agentCard?: unknown;
            agentId?: unknown;
        };

        expect(configContent.agentCard).toBeUndefined();
        expect(configContent.agentId).toBeUndefined();
        expect(configContent.systemPrompt.contributors).toContainEqual(
            expect.objectContaining({
                id: 'primary',
                type: 'static',
                content: 'You are Product Strategist.\n\nDrive product decisions with clarity.',
            })
        );
        expect(configContent.greeting).toBe('Ready to shape the roadmap.');
        expect(configContent.tools).toEqual([
            {
                type: 'builtin-tools',
                enabledTools: ['ask_user', 'invoke_skill'],
            },
            {
                type: 'plan-tools',
            },
        ]);
        expect(configContent.elicitation).toEqual({ enabled: true });
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
        expect(result.resourceDirectories).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    path: path.join(tempDir, 'skills', 'code-review', 'handlers'),
                    status: 'created',
                }),
                expect.objectContaining({
                    path: path.join(tempDir, 'skills', 'code-review', 'scripts'),
                    status: 'created',
                }),
                expect.objectContaining({
                    path: path.join(tempDir, 'skills', 'code-review', 'mcps'),
                    status: 'created',
                }),
                expect.objectContaining({
                    path: path.join(tempDir, 'skills', 'code-review', 'references'),
                    status: 'created',
                }),
            ])
        );

        const skillContent = await fs.readFile(
            path.join(tempDir, 'skills', 'code-review', 'SKILL.md'),
            'utf8'
        );
        expect(skillContent).toContain('name: "code-review"');
        expect(skillContent).toContain('# Code Review');
        expect(skillContent).toContain('## Purpose');
        expect(skillContent).toContain('## When To Use');
        expect(skillContent).toContain('## Workflow');
        expect(skillContent).toContain('## Bundled Resources');
        expect(skillContent).toContain('## Output Format');
    });

    it('seeds a starter create-skill bundle during workspace init', async () => {
        await handleInitCommand(tempDir);

        await expect(
            fs.readFile(path.join(tempDir, 'skills', 'create-skill', 'SKILL.md'), 'utf8')
        ).resolves.toContain('Read `references/skill-anatomy.md`');
        await expect(
            fs.readFile(
                path.join(tempDir, 'skills', 'create-skill', 'references', 'skill-anatomy.md'),
                'utf8'
            )
        ).resolves.toContain('## Canonical Layout');
        await expect(
            fs.readFile(
                path.join(tempDir, 'skills', 'create-skill', 'references', 'mcp-server-pattern.md'),
                'utf8'
            )
        ).resolves.toContain(
            "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';"
        );
        await expect(fs.access(path.join(tempDir, 'skills', 'echo-custom-mcp'))).rejects.toThrow();
    });

    it('reports when the workspace is already initialized', async () => {
        await createWorkspaceScaffold(tempDir);
        await createWorkspaceSkillScaffold('create-skill', tempDir);

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

    it('runs the interactive agent wizard when no id is provided', async () => {
        const mockGeneratorAgent = {
            start: vi.fn().mockResolvedValue(undefined),
            createSession: vi.fn().mockResolvedValue({ id: 'prompt-generation-session' }),
            generate: vi.fn().mockResolvedValue({
                content: JSON.stringify({
                    systemPrompt:
                        'You are Review Agent.\n\nReview changes carefully and surface concrete risks.',
                }),
                reasoning: undefined,
                usage: {
                    inputTokens: 10,
                    outputTokens: 10,
                    totalTokens: 20,
                },
                toolCalls: [],
                sessionId: 'prompt-generation-session',
            }),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        mockCreateDextoAgentFromConfig.mockResolvedValue(mockGeneratorAgent);
        mockTextOrExit
            .mockResolvedValueOnce('Review Agent')
            .mockResolvedValueOnce('Reviews code changes and highlights implementation risks.');
        mockSelectOrExit
            .mockResolvedValueOnce('primary')
            .mockResolvedValueOnce('generate')
            .mockResolvedValueOnce('continue');
        mockMultiselectOrExit.mockResolvedValue(['workspace', 'planning']);
        mockConfirmOrExit.mockResolvedValue(true);

        await handleInitAgentCommand(undefined, {}, tempDir);

        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            primaryAgent?: string;
            agents: Array<{ id: string }>;
        };
        expect(mockTextOrExit).toHaveBeenCalledTimes(2);
        expect(mockSelectOrExit).toHaveBeenCalledTimes(3);
        expect(mockMultiselectOrExit).toHaveBeenCalledTimes(1);
        expect(mockConfirmOrExit).toHaveBeenCalledTimes(1);
        expect(registryContent.primaryAgent).toBe('review-agent');
        expect(registryContent.agents[0]?.id).toBe('review-agent');

        const configContent = parseYaml(
            await fs.readFile(
                path.join(tempDir, 'agents', 'review-agent', 'review-agent.yml'),
                'utf8'
            )
        ) as {
            systemPrompt: {
                contributors: Array<{
                    id: string;
                    type: string;
                    content?: string;
                    source?: string;
                }>;
            };
            elicitation?: { enabled?: boolean };
            tools: Array<{ type: string; enabledTools?: string[] }>;
            agentCard?: unknown;
            agentId?: unknown;
        };

        expect(configContent.agentCard).toBeUndefined();
        expect(configContent.agentId).toBeUndefined();
        expect(configContent.systemPrompt.contributors).toEqual([
            {
                id: 'primary',
                type: 'static',
                priority: 0,
                content:
                    'You are Review Agent.\n\nReview changes carefully and surface concrete risks.',
            },
            {
                id: 'date',
                type: 'dynamic',
                priority: 10,
                source: 'date',
            },
            {
                id: 'env',
                type: 'dynamic',
                priority: 15,
                source: 'env',
            },
        ]);
        expect(configContent.elicitation).toEqual({ enabled: true });
        expect(configContent.tools).toEqual([
            {
                type: 'builtin-tools',
                enabledTools: ['ask_user', 'invoke_skill', 'sleep'],
            },
            {
                type: 'creator-tools',
            },
            {
                type: 'agent-spawner',
            },
            {
                type: 'filesystem-tools',
            },
            {
                type: 'process-tools',
            },
            {
                type: 'todo-tools',
            },
            {
                type: 'plan-tools',
            },
        ]);
        expect(mockCreateDextoAgentFromConfig).toHaveBeenCalledWith(
            expect.objectContaining({
                agentIdOverride: 'init-agent-prompt-generator',
                config: expect.objectContaining({
                    llm: {
                        provider: 'openai',
                        model: 'gpt-5-mini',
                        apiKey: '$OPENAI_API_KEY',
                    },
                    tools: [],
                }),
            })
        );
        expect(mockGeneratorAgent.start).toHaveBeenCalledTimes(1);
        expect(mockGeneratorAgent.generate).toHaveBeenCalledWith(
            expect.stringContaining(
                'Role description: Reviews code changes and highlights implementation risks.'
            ),
            'prompt-generation-session'
        );
        expect(mockGeneratorAgent.stop).toHaveBeenCalledTimes(1);
        expect(mockNote).not.toHaveBeenCalledWith(expect.any(String), 'System Prompt Preview');
        expect(mockNote).toHaveBeenCalledWith(
            expect.stringContaining('Filesystem & Terminal, Planning and tasks'),
            'Agent Summary'
        );
        expect(mockNote).toHaveBeenCalledWith(
            expect.stringContaining('enabled by default'),
            'Agent Summary'
        );
    });

    it('can create a subagent through the interactive agent wizard', async () => {
        const mockGeneratorAgent = {
            start: vi.fn().mockResolvedValue(undefined),
            createSession: vi.fn().mockResolvedValue({ id: 'prompt-generation-session' }),
            generate: vi.fn().mockResolvedValue({
                content: JSON.stringify({
                    systemPrompt:
                        'You are Explore Agent.\n\nWork as a delegated specialist and return crisp findings.',
                }),
                reasoning: undefined,
                usage: {
                    inputTokens: 12,
                    outputTokens: 12,
                    totalTokens: 24,
                },
                toolCalls: [],
                sessionId: 'prompt-generation-session',
            }),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        mockCreateDextoAgentFromConfig.mockResolvedValue(mockGeneratorAgent);

        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);

        mockTextOrExit
            .mockResolvedValueOnce('Explore Agent')
            .mockResolvedValueOnce(
                'Investigates code paths and reports findings back to the parent agent.'
            );
        mockSelectOrExit
            .mockResolvedValueOnce('subagent')
            .mockResolvedValueOnce('generate')
            .mockResolvedValueOnce('continue');
        mockMultiselectOrExit.mockResolvedValue(['workspace']);
        mockConfirmOrExit.mockResolvedValue(true);

        await handleInitAgentCommand(undefined, {}, tempDir);

        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            primaryAgent?: string;
            agents: Array<{ id: string; tags?: string[]; parentAgentId?: string }>;
        };

        expect(registryContent.primaryAgent).toBe('review-agent');
        expect(registryContent.agents.find((entry) => entry.id === 'explore-agent')).toMatchObject({
            tags: ['subagent'],
            parentAgentId: 'review-agent',
        });
        expect(mockGeneratorAgent.generate).toHaveBeenCalledWith(
            expect.stringContaining('Agent type: workspace subagent'),
            'prompt-generation-session'
        );
        expect(mockNote).toHaveBeenCalledWith(
            expect.stringContaining('Subagent (will link to review-agent)'),
            'Agent Summary'
        );
        expect(mockNote).toHaveBeenCalledWith(
            expect.stringContaining('enabled by default'),
            'Agent Summary'
        );
    });

    it('uses the external editor flow when editing a generated prompt', async () => {
        const mockGeneratorAgent = {
            start: vi.fn().mockResolvedValue(undefined),
            createSession: vi.fn().mockResolvedValue({ id: 'prompt-generation-session' }),
            generate: vi.fn().mockResolvedValue({
                content: JSON.stringify({
                    systemPrompt:
                        'You are Review Agent.\n\nReview changes carefully and surface concrete risks.',
                }),
                reasoning: undefined,
                usage: {
                    inputTokens: 10,
                    outputTokens: 10,
                    totalTokens: 20,
                },
                toolCalls: [],
                sessionId: 'prompt-generation-session',
            }),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        mockCreateDextoAgentFromConfig.mockResolvedValue(mockGeneratorAgent);
        mockSpawn.mockImplementation((_command: string, args?: readonly string[]) => {
            const promptPath = args?.[0];
            if (promptPath) {
                writeFileSync(
                    promptPath,
                    'You are Review Agent.\n\nEdited in a real editor view.',
                    'utf8'
                );
            }

            const child = new EventEmitter();
            process.nextTick(() => child.emit('exit', 0));
            return child as unknown as ReturnType<typeof mockSpawn>;
        });
        mockTextOrExit
            .mockResolvedValueOnce('Review Agent')
            .mockResolvedValueOnce('Reviews code changes and highlights implementation risks.');
        mockSelectOrExit
            .mockResolvedValueOnce('primary')
            .mockResolvedValueOnce('generate')
            .mockResolvedValueOnce('edit')
            .mockResolvedValueOnce('continue');
        mockMultiselectOrExit.mockResolvedValue(['workspace']);
        mockConfirmOrExit.mockResolvedValue(true);

        await handleInitAgentCommand(undefined, {}, tempDir);

        const configContent = parseYaml(
            await fs.readFile(
                path.join(tempDir, 'agents', 'review-agent', 'review-agent.yml'),
                'utf8'
            )
        ) as {
            systemPrompt: {
                contributors: Array<{ id: string; type: string; content?: string }>;
            };
        };

        expect(mockSpawn).toHaveBeenCalledTimes(1);
        expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('Opening'));
        expect(configContent.systemPrompt.contributors).toContainEqual(
            expect.objectContaining({
                id: 'primary',
                type: 'static',
                content: 'You are Review Agent.\n\nEdited in a real editor view.',
            })
        );
    });

    it('falls back to the custom prompt flow when no active llm is configured', async () => {
        mockGetEffectiveLLMConfig.mockResolvedValue(null);
        mockSpawn.mockImplementation(() => {
            const child = new EventEmitter();
            process.nextTick(() => child.emit('error', new Error('editor unavailable')));
            return child as unknown as ReturnType<typeof mockSpawn>;
        });
        mockTextOrExit
            .mockResolvedValueOnce('Review Agent')
            .mockResolvedValueOnce(
                'You are Review Agent.\\n\\nReview changes carefully and surface concrete risks.'
            );
        mockSelectOrExit.mockResolvedValueOnce('primary');
        mockMultiselectOrExit.mockResolvedValue(['workspace']);
        mockConfirmOrExit.mockResolvedValue(true);

        await handleInitAgentCommand(undefined, {}, tempDir);

        const configContent = parseYaml(
            await fs.readFile(
                path.join(tempDir, 'agents', 'review-agent', 'review-agent.yml'),
                'utf8'
            )
        ) as {
            systemPrompt: {
                contributors: Array<{ id: string; type: string; content?: string }>;
            };
        };

        expect(mockSelectOrExit).toHaveBeenCalledTimes(1);
        expect(mockCreateDextoAgentFromConfig).not.toHaveBeenCalled();
        expect(mockLogInfo).toHaveBeenCalledWith(
            expect.stringContaining('No active LLM configuration found')
        );
        expect(mockLogWarn).toHaveBeenCalledWith(
            expect.stringContaining('Could not open an editor cleanly')
        );
        expect(configContent.systemPrompt.contributors).toContainEqual(
            expect.objectContaining({
                id: 'primary',
                type: 'static',
                content:
                    'You are Review Agent.\n\nReview changes carefully and surface concrete risks.',
            })
        );
    });

    it('re-prompts for a new agent name before generating a prompt when the id already exists', async () => {
        const mockGeneratorAgent = {
            start: vi.fn().mockResolvedValue(undefined),
            createSession: vi.fn().mockResolvedValue({ id: 'prompt-generation-session' }),
            generate: vi.fn().mockResolvedValue({
                content: JSON.stringify({
                    systemPrompt:
                        'You are Review Agent Two.\n\nReview changes carefully and surface concrete risks.',
                }),
                reasoning: undefined,
                usage: {
                    inputTokens: 10,
                    outputTokens: 10,
                    totalTokens: 20,
                },
                toolCalls: [],
                sessionId: 'prompt-generation-session',
            }),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        mockCreateDextoAgentFromConfig.mockResolvedValue(mockGeneratorAgent);
        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);

        mockTextOrExit
            .mockResolvedValueOnce('Review Agent')
            .mockResolvedValueOnce('Review Agent Two')
            .mockResolvedValueOnce('Reviews code changes after checking for duplicate ids.');
        mockSelectOrExit
            .mockResolvedValueOnce('agent')
            .mockResolvedValueOnce('generate')
            .mockResolvedValueOnce('continue');
        mockMultiselectOrExit.mockResolvedValue(['workspace']);
        mockConfirmOrExit.mockResolvedValue(true);

        await handleInitAgentCommand(undefined, {}, tempDir);

        const registryContent = JSON.parse(
            await fs.readFile(path.join(tempDir, 'agents', 'registry.json'), 'utf8')
        ) as {
            agents: Array<{ id: string }>;
        };

        expect(mockTextOrExit).toHaveBeenCalledTimes(3);
        expect(mockLogWarn).toHaveBeenCalledWith(
            expect.stringContaining("Agent 'review-agent' already exists")
        );
        expect(mockGeneratorAgent.generate).toHaveBeenCalledWith(
            expect.stringContaining('Agent name: Review Agent Two'),
            'prompt-generation-session'
        );
        expect(registryContent.agents.map((entry) => entry.id)).toEqual([
            'review-agent',
            'review-agent-two',
        ]);
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

    it('inspects the current workspace status with registry, skills, and deploy preview', async () => {
        await createWorkspaceAgentScaffold('review-agent', {}, tempDir);
        await createWorkspaceAgentScaffold('explore-agent', { subagent: true }, tempDir);
        await linkWorkspaceSubagentToPrimaryAgent('explore-agent', tempDir);
        await createWorkspaceSkillScaffold('code-review', tempDir);
        await saveDeployConfig(
            tempDir,
            createWorkspaceDeployConfig('agents/review-agent/review-agent.yml')
        );

        const result = await inspectWorkspaceStatus(tempDir);

        expect(result.workspaceRoot).toBe(tempDir);
        expect(result.agentsFilePresent).toBe(true);
        expect(result.agentsDirectoryPresent).toBe(true);
        expect(result.skillsDirectoryPresent).toBe(true);
        expect(result.registryPath).toBe(path.join(tempDir, 'agents', 'registry.json'));
        expect(result.primaryAgentId).toBe('review-agent');
        expect(result.allowGlobalAgents).toBe(false);
        expect(result.agents).toEqual([
            {
                id: 'explore-agent',
                isPrimary: false,
                isSubagent: true,
                parentAgentId: 'review-agent',
            },
            {
                id: 'review-agent',
                isPrimary: true,
                isSubagent: false,
                parentAgentId: null,
            },
        ]);
        expect(result.skills).toEqual(['code-review']);
        expect(result.deployConfigPath).toBe(path.join(tempDir, '.dexto', 'deploy.json'));
        expect(result.effectiveDeploySummary).toContain(
            'workspace agent (agents/review-agent/review-agent.yml)'
        );
    });

    it('prints the current workspace status', async () => {
        await createWorkspaceScaffold(tempDir);
        await createWorkspaceSkillScaffold('code-review', tempDir);

        await handleInitStatusCommand(tempDir);

        expect(mockIntro).toHaveBeenCalledWith(expect.stringContaining('Dexto Init Status'));
        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining('default cloud agent if you run `dexto deploy`')
        );
        expect(mockOutro).toHaveBeenCalledWith(expect.stringContaining('Skills:\n- code-review'));
    });
});
