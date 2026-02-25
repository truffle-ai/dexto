import { describe, expect, it, vi } from 'vitest';
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

function getToolCatalogTool() {
    const tools = creatorToolsFactory.create({
        type: 'creator-tools',
        enabledTools: ['tool_catalog'],
    });
    const tool = tools.find((candidate) => candidate.id === 'tool_catalog');
    if (!tool) {
        throw new Error('tool_catalog tool not found');
    }
    return tool;
}

describe('tool_catalog tool', () => {
    it('lists tools and configured toolkits', async () => {
        const logger = createMockLogger();
        const context = {
            logger,
            agent: {
                getAllTools: async () => ({
                    edit_file: {
                        name: 'edit_file',
                        description: 'Edit file',
                        parameters: {},
                    },
                    'mcp--fs--read_file': {
                        name: 'mcp--fs--read_file',
                        description: 'Read file',
                        parameters: {},
                    },
                }),
                getAvailableToolkitTypes: () => ['builtin-tools', 'scheduler-tools'],
            },
        } as unknown as ToolExecutionContext;

        const tool = getToolCatalogTool();
        const input = tool.inputSchema.parse({});
        const result = (await tool.execute(input, context)) as {
            tools: Array<{ id: string; source: string }>;
            toolkitsAvailable: string[];
        };
        expect(result.tools).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'edit_file', source: 'local' }),
                expect.objectContaining({ id: 'mcp--fs--read_file', source: 'mcp' }),
            ])
        );
        expect(result.toolkitsAvailable).toEqual(['builtin-tools', 'scheduler-tools']);
    });

    it('filters by query and limit', async () => {
        const logger = createMockLogger();
        const context = {
            logger,
            agent: {
                getAllTools: async () => ({
                    edit_file: {
                        name: 'edit_file',
                        description: 'Edit file',
                        parameters: {},
                    },
                    read_file: {
                        name: 'read_file',
                        description: 'Read file',
                        parameters: {},
                    },
                }),
                getAvailableToolkitTypes: () => ['filesystem-tools', 'scheduler-tools'],
            },
        } as unknown as ToolExecutionContext;

        const tool = getToolCatalogTool();
        const input = tool.inputSchema.parse({ query: 'read', limit: 1 });
        const result = (await tool.execute(input, context)) as {
            count: number;
            total: number;
            tools: Array<{ id: string }>;
        };

        expect(result.total).toBe(1);
        expect(result.count).toBe(1);
        expect(result.tools[0]?.id).toBe('read_file');
        expect((result as { toolkitsAvailable?: string[] }).toolkitsAvailable).toEqual([
            'filesystem-tools',
            'scheduler-tools',
        ]);
    });
});
