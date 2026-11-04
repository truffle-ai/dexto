import { describe, it, expect, vi } from 'vitest';
import { createMemoryListTool } from './memory-tools.js';
import type { ToolExecutionContext } from '@dexto/core';

function createTestContext(list: ReturnType<typeof vi.fn>): ToolExecutionContext {
    const logger = {
        debug: () => {},
        silly: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        trackException: () => {},
        createChild: () => logger,
        createFileOnlyChild: () => logger,
        setLevel: () => {},
        getLevel: () => 'info' as const,
        getLogFilePath: () => null,
        destroy: async () => {},
    };

    return {
        sessionId: 'test-session',
        logger,
        services: undefined,
        toolState: undefined,
        agent: { memoryManager: { list } } as unknown as ToolExecutionContext['agent'],
    };
}

describe('memory_list tool', () => {
    it('passes the keyword query through to the memory manager', async () => {
        const list = vi.fn().mockResolvedValue([]);
        const tool = createMemoryListTool();

        await tool.execute(
            tool.inputSchema.parse({ query: 'staging deploy', pinned: true }),
            createTestContext(list)
        );

        expect(list).toHaveBeenCalledWith({
            limit: 50,
            offset: 0,
            pinned: true,
            query: 'staging deploy',
        });
    });

    it('omits query when it is not provided', async () => {
        const list = vi.fn().mockResolvedValue([]);
        const tool = createMemoryListTool();

        await tool.execute(tool.inputSchema.parse({}), createTestContext(list));

        expect(list).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    });

    it('trims the query and rejects whitespace-only input', () => {
        const tool = createMemoryListTool();

        expect(tool.inputSchema.parse({ query: '  postgres  ' }).query).toBe('postgres');
        expect(tool.inputSchema.safeParse({ query: '   ' }).success).toBe(false);
    });
});
