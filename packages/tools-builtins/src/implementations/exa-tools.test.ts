import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Logger, ToolExecutionContext } from '@dexto/core';
import { DextoMcpClient } from '@dexto/core';
import { createWebSearchTool } from './exa-web-search-tool.js';
import { createCodeSearchTool } from './exa-code-search-tool.js';

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

function createToolContext(logger: Logger): ToolExecutionContext {
    return { logger };
}

describe('Exa built-in tools', () => {
    const connectSpy = vi.spyOn(DextoMcpClient.prototype, 'connect');
    const disconnectSpy = vi.spyOn(DextoMcpClient.prototype, 'disconnect');
    const getConnectedClientSpy = vi.spyOn(DextoMcpClient.prototype, 'getConnectedClient');

    beforeEach(() => {
        connectSpy.mockResolvedValue({} as never);
        disconnectSpy.mockResolvedValue();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it('web_search calls web_search_exa and returns the first text content', async () => {
        const callTool = vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'hello from exa' }],
        });
        getConnectedClientSpy.mockResolvedValue({ callTool } as never);

        const tool = createWebSearchTool();
        const logger = createMockLogger();
        const context = createToolContext(logger);
        const input = tool.inputSchema.parse({ query: 'what is dexto' });

        const result = await tool.execute(input, context);

        expect(result).toBe('hello from exa');
        expect(callTool).toHaveBeenCalledWith(
            {
                name: 'web_search_exa',
                arguments: expect.objectContaining({ query: 'what is dexto' }),
            },
            undefined,
            expect.objectContaining({ timeout: 25000, resetTimeoutOnProgress: true })
        );
    });

    it('code_search calls get_code_context_exa and returns the first text content', async () => {
        const callTool = vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'code context' }],
        });
        getConnectedClientSpy.mockResolvedValue({ callTool } as never);

        const tool = createCodeSearchTool();
        const logger = createMockLogger();
        const context = createToolContext(logger);
        const input = tool.inputSchema.parse({ query: 'react useState', tokensNum: 2000 });

        const result = await tool.execute(input, context);

        expect(result).toBe('code context');
        expect(callTool).toHaveBeenCalledWith(
            {
                name: 'get_code_context_exa',
                arguments: expect.objectContaining({ query: 'react useState', tokensNum: 2000 }),
            },
            undefined,
            expect.objectContaining({ timeout: 30000, resetTimeoutOnProgress: true })
        );
    });

    it('throws ToolError.executionFailed when Exa returns an MCP error result', async () => {
        const callTool = vi.fn().mockResolvedValue({
            isError: true,
            content: [{ type: 'text', text: 'bad input' }],
        });
        getConnectedClientSpy.mockResolvedValue({ callTool } as never);

        const tool = createWebSearchTool();
        const logger = createMockLogger();
        const context = createToolContext(logger);
        const input = tool.inputSchema.parse({ query: 'x' });

        await expect(tool.execute(input, context)).rejects.toMatchObject({
            name: 'DextoRuntimeError',
            code: 'tools_execution_failed',
        });
    });
});
