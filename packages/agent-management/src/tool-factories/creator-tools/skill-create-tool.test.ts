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

function createMockAgent(existingPrompts: Array<{ type: 'file'; file: string }> = []) {
    let prompts = [...existingPrompts];

    return {
        getEffectiveConfig: vi.fn(() => ({ prompts })),
        refreshPrompts: vi.fn(async (nextPrompts) => {
            prompts = Array.isArray(nextPrompts)
                ? (nextPrompts as Array<{ type: 'file'; file: string }>)
                : prompts;
        }),
    };
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
            bundledMcpServers: string[];
        };

        expect(result.scope).toBe('workspace');
        expect(result.path).toBe(path.join(tempDir, 'skills', 'release-check', 'SKILL.md'));
        expect(result.resourceDirectories).toEqual([
            path.join(tempDir, 'skills', 'release-check', 'handlers'),
            path.join(tempDir, 'skills', 'release-check', 'scripts'),
            path.join(tempDir, 'skills', 'release-check', 'mcps'),
            path.join(tempDir, 'skills', 'release-check', 'references'),
        ]);
        expect(result.bundledMcpServers).toEqual([]);
        expect(result.notes).toContain(
            'Creating or editing files under mcps/ only defines bundled MCP config. It does not implement or verify the target MCP server.'
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
                'Roll weighted dice through a bundled MCP tool.',
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

    it('refreshes one skill bundle so later mcps/ edits are visible in the current session', async () => {
        const logger = createMockLogger();
        const skillFile = path.join(tempDir, 'skills', 'release-check', 'SKILL.md');
        const mockAgent = createMockAgent([{ type: 'file', file: skillFile }]);

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
            agent: mockAgent,
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
            promptsRefreshed: boolean;
            bundledMcpServers: string[];
            notes: string[];
        };

        expect(result.refreshed).toBe(true);
        expect(result.promptsRefreshed).toBe(true);
        expect(result.bundledMcpServers).toEqual(['release_echo']);
        expect(result.notes).toContain(
            'Bundled MCP config is present. Only describe the skill as shipping a real MCP when the config points at a bundled runnable server or a verified external command/package.'
        );
        expect(mockAgent.refreshPrompts).toHaveBeenCalledTimes(1);
    });
});
