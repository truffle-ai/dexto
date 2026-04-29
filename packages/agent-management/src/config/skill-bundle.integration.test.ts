import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    createLogger,
    DextoAgent,
    InMemoryDextoStores,
    LoggerConfigSchema,
    type DextoAgentOptions,
    type DextoStores,
    type Logger,
    type Tool,
    type WorkspaceHandleProvider,
} from '@dexto/core';
import { builtinToolsFactory } from '@dexto/tools-builtins';
import { enrichAgentConfig } from './config-enrichment.js';
import { creatorToolsFactory } from '../tool-factories/creator-tools/factory.js';
import { createLocalSkillSources } from '../plugins/local-skill-sources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_SKILL_DIR = path.resolve(__dirname, '../../../../examples/skills/echo-custom-mcp');

function createInMemoryStores(_logger: Logger): DextoStores {
    return new InMemoryDextoStores();
}

function createWorkspaceHandleProvider(workspaceRoot: string): WorkspaceHandleProvider {
    return {
        async open({ context }) {
            return {
                context,
                capabilities: ['files'],
                files: {
                    readFile: (relativePath) =>
                        fs.readFile(path.join(workspaceRoot, relativePath), 'utf8'),
                    readText: (relativePath) =>
                        fs.readFile(path.join(workspaceRoot, relativePath), 'utf8'),
                    writeFile: (relativePath, content) =>
                        fs.writeFile(path.join(workspaceRoot, relativePath), content, 'utf8'),
                    listFiles: async (relativePath = '.') =>
                        fs.readdir(path.join(workspaceRoot, relativePath)),
                    glob: async (pattern) => {
                        const [baseDir, marker] = pattern.split('/*/');
                        if (!baseDir || marker !== 'SKILL.md') return [];
                        const absoluteBase = path.join(workspaceRoot, baseDir);
                        const entries = await fs
                            .readdir(absoluteBase, { withFileTypes: true })
                            .catch(() => []);
                        return entries
                            .filter((entry) => entry.isDirectory())
                            .map((entry) => `${baseDir}/${entry.name}/SKILL.md`);
                    },
                },
            };
        },
    };
}

function createRuntimeAgentOptions(
    enriched: ReturnType<typeof enrichAgentConfig>,
    tools: Tool[],
    workspaceRoot: string
): DextoAgentOptions {
    if (!enriched.agentId) {
        throw new Error('enrichAgentConfig() must produce an agentId for integration tests');
    }

    const logger = createLogger({
        config: LoggerConfigSchema.parse({
            level: 'error',
            transports: [{ type: 'silent' }],
        }),
        agentId: enriched.agentId,
    });

    return {
        agentId: enriched.agentId,
        systemPrompt: enriched.systemPrompt,
        llm: enriched.llm,
        agentCard: enriched.agentCard,
        greeting: enriched.greeting,
        telemetry: enriched.telemetry,
        memories: enriched.memories,
        mcpServers: enriched.mcpServers,
        sessions: enriched.sessions,
        permissions: enriched.permissions,
        elicitation: enriched.elicitation,
        resources: enriched.resources,
        prompts: enriched.prompts,
        logger,
        stores: createInMemoryStores(logger),
        tools,
        skillSources: createLocalSkillSources({ workspaceRoot }),
        hooks: [],
        overrides: {
            workspaceHandleProvider: createWorkspaceHandleProvider(workspaceRoot),
        },
    };
}

describe('skill bundle integration', () => {
    let tempDir: string;
    let previousHome: string | undefined;
    let previousUserProfile: string | undefined;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-skill-bundle-'));
        previousHome = process.env.HOME;
        previousUserProfile = process.env.USERPROFILE;

        const isolatedHome = path.join(tempDir, 'home');
        await fs.mkdir(isolatedHome, { recursive: true });
        process.env.HOME = isolatedHome;
        process.env.USERPROFILE = isolatedHome;
    });

    afterEach(async () => {
        if (previousHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = previousHome;
        }

        if (previousUserProfile === undefined) {
            delete process.env.USERPROFILE;
        } else {
            process.env.USERPROFILE = previousUserProfile;
        }

        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('discovers standalone, user-global, and plugin skills and reads bundled files as plain files', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const skillDir = path.join(workspaceRoot, 'skills', 'echo-custom-mcp');
        const globalSkillDir = path.join(tempDir, 'home', '.dexto', 'skills', 'global-review');
        const pluginSkillDir = path.join(
            workspaceRoot,
            '.dexto',
            'plugins',
            'review',
            'skills',
            'audit'
        );
        await fs.mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
        await fs.cp(SAMPLE_SKILL_DIR, skillDir, { recursive: true });

        await fs.mkdir(globalSkillDir, { recursive: true });
        await fs.writeFile(
            path.join(globalSkillDir, 'SKILL.md'),
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
            '# Audit\n\nPlugin audit skill.',
            'utf8'
        );

        const enriched = enrichAgentConfig(
            {
                llm: {
                    provider: 'openai',
                    model: 'gpt-5-mini',
                    apiKey: 'test-key',
                },
                systemPrompt: 'You are a helpful assistant.',
                permissions: {
                    mode: 'auto-approve',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: false,
                    timeout: 120000,
                },
            },
            path.join(workspaceRoot, 'agents', 'skill-agent.yml'),
            {
                workspaceRoot,
            }
        );

        expect(enriched.prompts).toBeUndefined();
        expect(enriched.mcpServers).toBeUndefined();

        const agent = new DextoAgent(
            createRuntimeAgentOptions(
                enriched,
                builtinToolsFactory.create({
                    type: 'builtin-tools',
                    enabledTools: ['invoke_skill', 'read_skill'],
                }),
                workspaceRoot
            )
        );

        await agent.start();
        await agent.workspaceManager.setWorkspace({ path: workspaceRoot });

        try {
            const toolsBefore = await agent.toolManager.getAllTools();
            expect(agent.getMcpServerStatus('skill_echo_demo')).toBeUndefined();
            expect(
                Object.keys(toolsBefore).some((toolName) => toolName.includes('echo_message'))
            ).toBe(false);

            const discoveredSkills = await agent.skillManager.list();
            expect(discoveredSkills.map((skill) => skill.id).sort()).toEqual([
                'echo-custom-mcp',
                'global-review',
                'review:audit',
            ]);

            const session = await agent.createSession('skill-bundle-session');
            const invokeResult = await agent.toolManager.executeTool(
                'invoke_skill',
                { skill: 'echo-custom-mcp' },
                'call-1',
                { sessionId: session.id }
            );

            expect(invokeResult.result).toMatchObject({
                skill: 'echo-custom-mcp',
            });
            expect(
                (invokeResult.result as { content: string }).content.includes('bundled files')
            ).toBe(true);

            const referenceResult = await agent.toolManager.executeTool(
                'read_skill',
                { skill: 'echo-custom-mcp', path: 'references/usage.md' },
                'call-2',
                { sessionId: session.id }
            );
            expect(referenceResult.result).toMatchObject({
                success: true,
                skill: 'echo-custom-mcp',
                path: 'references/usage.md',
            });
            expect((referenceResult.result as { content: string }).content).toContain(
                'Echo Skill Usage'
            );

            const scriptResult = await agent.toolManager.executeTool(
                'read_skill',
                { skill: 'echo-custom-mcp', path: 'scripts/echo-mcp-server.mjs' },
                'call-3',
                { sessionId: session.id }
            );
            expect((scriptResult.result as { content: string }).content).toContain(
                'Echo from bundled sample MCP'
            );

            const mcpFileResult = await agent.toolManager.executeTool(
                'read_skill',
                { skill: 'echo-custom-mcp', path: 'mcps/echo.json' },
                'call-4',
                { sessionId: session.id }
            );
            expect((mcpFileResult.result as { content: string }).content).toContain(
                'skill_echo_demo'
            );
            expect(agent.getMcpServerStatus('skill_echo_demo')).toBeUndefined();
            const toolsAfter = await agent.toolManager.getAllTools();
            expect(
                Object.keys(toolsAfter).some((toolName) => toolName.includes('echo_message'))
            ).toBe(false);
        } finally {
            await agent.stop();
        }
    }, 20000);

    it('refreshes a skill bundle so later SKILL.md and resource edits are visible without restarting the session', async () => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const skillDir = path.join(workspaceRoot, 'skills', 'echo-custom-mcp');
        await fs.mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
        await fs.cp(SAMPLE_SKILL_DIR, skillDir, { recursive: true });
        await fs.writeFile(
            path.join(skillDir, 'SKILL.md'),
            [
                '---',
                'name: "echo-custom-mcp"',
                'description: "Use bundled files for quick skill checks."',
                '---',
                '',
                '# Echo Custom MCP',
                '',
                '## Purpose',
                'This copy was loaded before resource edits.',
            ].join('\n'),
            'utf8'
        );
        await fs.writeFile(
            path.join(skillDir, 'references', 'usage.md'),
            '# Echo Skill Usage\n\nOld reference content.',
            'utf8'
        );

        const enriched = enrichAgentConfig(
            {
                llm: {
                    provider: 'openai',
                    model: 'gpt-5-mini',
                    apiKey: 'test-key',
                },
                systemPrompt: 'You are a helpful assistant.',
                permissions: {
                    mode: 'auto-approve',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: false,
                    timeout: 120000,
                },
            },
            path.join(workspaceRoot, 'agents', 'skill-agent.yml'),
            {
                workspaceRoot,
            }
        );

        const agent = new DextoAgent(
            createRuntimeAgentOptions(
                enriched,
                [
                    ...builtinToolsFactory.create({
                        type: 'builtin-tools',
                        enabledTools: ['invoke_skill', 'read_skill'],
                    }),
                    ...creatorToolsFactory.create({
                        type: 'creator-tools',
                        enabledTools: ['skill_refresh'],
                    }),
                ],
                workspaceRoot
            )
        );

        await agent.start();
        await agent.workspaceManager.setWorkspace({ path: workspaceRoot });

        try {
            const session = await agent.createSession('skill-refresh-session');

            const staleInvoke = await agent.toolManager.executeTool(
                'invoke_skill',
                { skill: 'echo-custom-mcp' },
                'call-stale',
                { sessionId: session.id }
            );

            expect(staleInvoke.result).toMatchObject({
                skill: 'echo-custom-mcp',
            });
            expect(
                (staleInvoke.result as { content: string }).content.includes(
                    'loaded before resource edits'
                )
            ).toBe(true);
            expect(agent.getMcpServerStatus('skill_echo_demo')).toBeUndefined();

            await fs.writeFile(
                path.join(skillDir, 'SKILL.md'),
                [
                    '---',
                    'name: "echo-custom-mcp"',
                    'description: "Use bundled files for quick skill checks."',
                    '---',
                    '',
                    '# Echo Updated',
                    '',
                    '## Purpose',
                    'Verify that skill_refresh refreshes SkillManager entries and instructions.',
                ].join('\n'),
                'utf8'
            );
            await fs.writeFile(
                path.join(skillDir, 'references', 'usage.md'),
                '# Echo Skill Usage\n\nUpdated reference content.',
                'utf8'
            );

            const refreshResult = await agent.toolManager.executeTool(
                'skill_refresh',
                { id: 'echo-custom-mcp' },
                'call-refresh',
                { sessionId: session.id }
            );

            expect(refreshResult.result).toMatchObject({
                refreshed: true,
                id: 'echo-custom-mcp',
            });
            expect(refreshResult.result).not.toHaveProperty('bundledMcpServers');

            const refreshedSkills = await agent.skillManager.list();
            expect(refreshedSkills).toContainEqual(
                expect.objectContaining({
                    id: 'echo-custom-mcp',
                    displayName: 'Echo Updated',
                })
            );

            const freshInvoke = await agent.toolManager.executeTool(
                'invoke_skill',
                { skill: 'echo-custom-mcp' },
                'call-fresh',
                { sessionId: session.id }
            );

            expect(
                (freshInvoke.result as { content: string }).content.includes(
                    'refreshes SkillManager entries and instructions'
                )
            ).toBe(true);

            const referenceResult = await agent.toolManager.executeTool(
                'read_skill',
                { skill: 'echo-custom-mcp', path: 'references/usage.md' },
                'call-reference',
                { sessionId: session.id }
            );
            expect((referenceResult.result as { content: string }).content).toContain(
                'Updated reference content'
            );
            expect(agent.getMcpServerStatus('skill_echo_demo')).toBeUndefined();
        } finally {
            await agent.stop();
        }
    }, 20000);
});
