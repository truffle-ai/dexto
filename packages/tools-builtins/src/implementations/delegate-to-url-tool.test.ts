import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDelegateToUrlTool } from './delegate-to-url-tool.js';
import { DextoRuntimeError, ErrorScope, ErrorType } from '@dexto/core';
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

describe('delegate_to_url tool', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('throws DELEGATION_FAILED when it cannot reach the remote agent', async () => {
        const logger = createMockLogger();
        const context = createToolContext(logger);
        const fetchMock = vi.fn(async () => {
            throw new Error('boom');
        });

        vi.stubGlobal('fetch', fetchMock);

        const tool = createDelegateToUrlTool();
        const input = tool.inputSchema.parse({
            url: 'http://example.com',
            message: 'hi',
            timeout: 1,
        });

        await expect(tool.execute(input, context)).rejects.toMatchObject({
            name: 'DextoRuntimeError',
            code: 'DELEGATION_FAILED',
            scope: ErrorScope.TOOLS,
            type: ErrorType.THIRD_PARTY,
        });
    });

    it('throws DELEGATION_TIMEOUT when the request times out', async () => {
        const logger = createMockLogger();
        const context = createToolContext(logger);
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';

        const fetchMock = vi.fn(async () => {
            throw abortError;
        });

        vi.stubGlobal('fetch', fetchMock);

        const tool = createDelegateToUrlTool();
        const input = tool.inputSchema.parse({
            url: 'http://example.com',
            message: 'hi',
            timeout: 1,
        });

        try {
            await tool.execute(input, context);
            expect.fail('Expected tool.execute() to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error).toMatchObject({
                code: 'DELEGATION_TIMEOUT',
                scope: ErrorScope.TOOLS,
                type: ErrorType.TIMEOUT,
            });
        }
    });
});
