import { describe, expect, it, vi } from 'vitest';
import { creatorToolsFactory } from './factory.js';
import type { Logger, ToolExecutionContext } from '@dexto/core';

vi.mock('@dexto/registry', () => ({
    serverRegistry: {
        getEntries: vi.fn(async () => [
            {
                id: 'github',
                name: 'GitHub MCP',
                description: 'GitHub tools',
                category: 'development',
                tags: ['git', 'repo'],
                isOfficial: true,
                isInstalled: false,
                config: {
                    type: 'stdio',
                    command: 'npx',
                    args: ['-y', '@modelcontextprotocol/server-github'],
                },
            },
        ]),
    },
}));

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

function getMcpRegistryCatalogTool() {
    const tools = creatorToolsFactory.create({
        type: 'creator-tools',
        enabledTools: ['mcp_registry_catalog'],
    });
    const tool = tools.find((candidate) => candidate.id === 'mcp_registry_catalog');
    if (!tool) {
        throw new Error('mcp_registry_catalog tool not found');
    }
    return tool;
}

describe('mcp_registry_catalog tool', () => {
    it('lists MCP registry entries', async () => {
        const logger = createMockLogger();
        const context = { logger } as unknown as ToolExecutionContext;

        const tool = getMcpRegistryCatalogTool();
        const input = tool.inputSchema.parse({});
        const result = (await tool.execute(input, context)) as {
            count: number;
            total: number;
            servers: Array<{ id: string; name: string; config?: unknown }>;
        };

        expect(result.count).toBe(1);
        expect(result.total).toBe(1);
        expect(result.servers[0]).toMatchObject({
            id: 'github',
            name: 'GitHub MCP',
        });
        expect(result.servers[0]?.config).toBeUndefined();
    });

    it('includes config when requested', async () => {
        const logger = createMockLogger();
        const context = { logger } as unknown as ToolExecutionContext;

        const tool = getMcpRegistryCatalogTool();
        const input = tool.inputSchema.parse({ includeConfig: true });
        const result = (await tool.execute(input, context)) as {
            servers: Array<{ config?: unknown }>;
        };

        expect(result.servers[0]?.config).toBeDefined();
    });
});
