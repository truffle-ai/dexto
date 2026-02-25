import { describe, expect, it, vi } from 'vitest';
import { creatorToolsFactory } from './factory.js';
import type { Logger, PromptInfo, ToolExecutionContext } from '@dexto/core';

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

function getSkillSearchTool() {
    const tools = creatorToolsFactory.create({
        type: 'creator-tools',
        enabledTools: ['skill_search'],
    });
    const tool = tools.find((candidate) => candidate.id === 'skill_search');
    if (!tool) {
        throw new Error('skill_search tool not found');
    }
    return tool;
}

describe('skill_search tool', () => {
    it('matches hyphenated skills with space queries', async () => {
        const logger = createMockLogger();
        const promptSet: Record<string, PromptInfo> = {
            'config:create-automation': {
                name: 'config:create-automation',
                displayName: 'create-automation',
                description: 'Create automations',
                source: 'config',
            },
        };

        const context: ToolExecutionContext = {
            logger,
            services: {
                prompts: {
                    list: async () => promptSet,
                },
            },
        } as ToolExecutionContext;

        const tool = getSkillSearchTool();
        const input = tool.inputSchema.parse({ query: 'create automation' });
        const result = (await tool.execute(input, context)) as {
            count: number;
            total: number;
            skills: Array<{ name?: string }>;
        };

        expect(result).toMatchObject({ count: 1, total: 1 });
        expect(result.skills[0]?.name).toBe('create-automation');
    });

    it('returns all loaded skills when no query is provided', async () => {
        const logger = createMockLogger();
        const promptSet: Record<string, PromptInfo> = {
            'config:create-automation': {
                name: 'config:create-automation',
                displayName: 'create-automation',
                description: 'Create automations',
                source: 'config',
            },
            'config:archived-skill': {
                name: 'config:archived-skill',
                displayName: 'archived-skill',
                description: 'Hidden but loaded',
                source: 'config',
                disableModelInvocation: true,
            },
        };

        const context: ToolExecutionContext = {
            logger,
            services: {
                prompts: {
                    list: async () => promptSet,
                },
            },
        } as ToolExecutionContext;

        const tool = getSkillSearchTool();
        const input = tool.inputSchema.parse({});
        const result = (await tool.execute(input, context)) as {
            count: number;
            total: number;
            skills: Array<{ name?: string }>;
        };

        expect(result).toMatchObject({ count: 2, total: 2 });
    });
});
