import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creatorToolsFactory } from './factory.js';
import type { Logger, ToolExecutionContext } from '@dexto/core';

function createMockLogger(): Logger {
    const logger: Logger = {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(() => logger),
        createFileOnlyChild: vi.fn(() => logger),
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'debug' as const),
        getLogFilePath: vi.fn(() => null),
        destroy: vi.fn(async () => undefined),
    };
    return logger;
}

function getCreatorTool(id: 'skill_create' | 'skill_refresh') {
    const tools = creatorToolsFactory.create({
        type: 'creator-tools',
        enabledTools: [id],
    });
    const tool = tools.find((candidate) => candidate.id === id);
    if (!tool) {
        throw new Error(`${id} tool not found`);
    }
    return tool;
}

describe('skill_create tool', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-skill-create-'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('creates workspace skills under skills/ and scaffolds bundled resource directories', async () => {
        const logger = createMockLogger();
        const context = {
            logger,
            workspace: {
                path: tempDir,
            },
        } as ToolExecutionContext;

        const tool = getCreatorTool('skill_create');
        const input = tool.inputSchema.parse({
            id: 'release-check',
            description: 'Validate release readiness.',
            content: '## Purpose\nCheck the release plan and report blockers.',
        });

        const result = (await tool.execute(input, context)) as {
            path: string;
            scope: string;
            resourceDirectories: string[];
            notes: string[];
        };

        expect(result.scope).toBe('workspace');
        expect(result.path).toBe(path.join(tempDir, 'skills', 'release-check', 'SKILL.md'));
        expect(result.resourceDirectories).toEqual([
            path.join(tempDir, 'skills', 'release-check', 'handlers'),
            path.join(tempDir, 'skills', 'release-check', 'scripts'),
            path.join(tempDir, 'skills', 'release-check', 'mcps'),
            path.join(tempDir, 'skills', 'release-check', 'references'),
        ]);
        expect(result.notes).toContain(
            'Files under mcps/ are inert bundled files. Configure MCP servers through normal MCP configuration paths.'
        );

        await expect(
            fs.readFile(path.join(tempDir, 'skills', 'release-check', 'SKILL.md'), 'utf8')
        ).resolves.toContain('name: "release-check"');

        await expect(
            fs.stat(path.join(tempDir, 'skills', 'release-check', 'handlers'))
        ).resolves.toMatchObject({ isDirectory: expect.any(Function) });
        await expect(
            fs.stat(path.join(tempDir, 'skills', 'release-check', 'scripts'))
        ).resolves.toMatchObject({ isDirectory: expect.any(Function) });
        await expect(
            fs.stat(path.join(tempDir, 'skills', 'release-check', 'mcps'))
        ).resolves.toMatchObject({ isDirectory: expect.any(Function) });
        await expect(
            fs.stat(path.join(tempDir, 'skills', 'release-check', 'references'))
        ).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    });

    it('strips a user-supplied top-level heading from skill content to avoid double titles', async () => {
        const logger = createMockLogger();
        const context = {
            logger,
            workspace: {
                path: tempDir,
            },
        } as ToolExecutionContext;

        const tool = getCreatorTool('skill_create');
        const input = tool.inputSchema.parse({
            id: 'roll-dice-mcp',
            description: 'Roll dice through MCP.',
            content: [
                '# Roll Dice via MCP',
                '',
                '## Purpose',
                'Roll weighted dice through a bundled helper.',
            ].join('\n'),
        });

        await tool.execute(input, context);

        const skillMarkdown = await fs.readFile(
            path.join(tempDir, 'skills', 'roll-dice-mcp', 'SKILL.md'),
            'utf8'
        );

        expect(skillMarkdown).toContain('# Roll Dice Mcp');
        expect(skillMarkdown).toContain('## Purpose');
        expect(skillMarkdown).not.toContain('# Roll Dice via MCP');
    });

    it('rejects dead allowed-tools and toolkits skill metadata', async () => {
        const tool = getCreatorTool('skill_create');

        expect(() =>
            tool.inputSchema.parse({
                id: 'legacy-metadata',
                description: 'Legacy metadata should not be accepted.',
                content: 'Body.',
                allowedTools: ['read_file'],
            })
        ).toThrow();
        expect(() =>
            tool.inputSchema.parse({
                id: 'legacy-metadata',
                description: 'Legacy metadata should not be accepted.',
                content: 'Body.',
                toolkits: ['creator-tools'],
            })
        ).toThrow();
    });

    it('does not preserve dead metadata when updating a skill', async () => {
        const logger = createMockLogger();
        const skillFile = path.join(tempDir, 'skills', 'legacy-metadata', 'SKILL.md');
        await fs.mkdir(path.dirname(skillFile), { recursive: true });
        await fs.writeFile(
            skillFile,
            [
                '---',
                'name: "legacy-metadata"',
                'description: "Legacy metadata should be removed."',
                'allowed-tools: ["read_file"]',
                'toolkits: ["creator-tools"]',
                '---',
                '',
                '# Legacy Metadata',
                '',
                'Old body.',
            ].join('\n'),
            'utf8'
        );

        const tool = creatorToolsFactory
            .create({ type: 'creator-tools', enabledTools: ['skill_update'] })
            .find((candidate) => candidate.id === 'skill_update');
        expect(tool).toBeDefined();

        await tool!.execute(
            tool!.inputSchema.parse({
                id: 'legacy-metadata',
                content: 'New body.',
            }),
            {
                logger,
                workspace: { path: tempDir },
                services: { skills: { refresh: vi.fn(async () => undefined) } },
            } as unknown as ToolExecutionContext
        );

        const skillMarkdown = await fs.readFile(skillFile, 'utf8');
        expect(skillMarkdown).not.toContain('allowed-tools');
        expect(skillMarkdown).not.toContain('toolkits');
    });

    it('refreshes one skill bundle so later bundled file edits are visible in the current session', async () => {
        const logger = createMockLogger();
        const skillFile = path.join(tempDir, 'skills', 'release-check', 'SKILL.md');
        const skillManager = {
            refresh: vi.fn(async () => undefined),
        };

        await fs.mkdir(path.join(tempDir, 'skills', 'release-check', 'mcps'), { recursive: true });
        await fs.writeFile(
            skillFile,
            [
                '---',
                'name: "release-check"',
                'description: "Validate release readiness."',
                '---',
                '',
                '# Release Check',
                '',
                '## Purpose',
                'Validate release readiness.',
            ].join('\n'),
            'utf8'
        );
        await fs.writeFile(
            path.join(tempDir, 'skills', 'release-check', 'mcps', 'release.json'),
            JSON.stringify(
                {
                    mcpServers: {
                        release_echo: {
                            command: 'node',
                            args: ['scripts/release-echo.mjs'],
                        },
                    },
                },
                null,
                2
            ),
            'utf8'
        );

        const context = {
            logger,
            services: {
                skills: skillManager,
            },
            workspace: {
                path: tempDir,
            },
        } as unknown as ToolExecutionContext;

        const tool = getCreatorTool('skill_refresh');
        const input = tool.inputSchema.parse({
            id: 'release-check',
        });

        const result = (await tool.execute(input, context)) as {
            refreshed: boolean;
            skillsRefreshed: boolean;
            notes: string[];
        };

        expect(result.refreshed).toBe(true);
        expect(result.skillsRefreshed).toBe(true);
        expect(result.notes).toContain(
            'After editing SKILL.md or bundled files with non-creator tools, run skill_refresh so the current session sees the latest skill content.'
        );
        expect(skillManager.refresh).toHaveBeenCalledTimes(1);
    });
});
