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
        createFileOnlyChild: vi.fn(() => logger),
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'debug' as const),
        getLogFilePath: vi.fn(() => null),
        destroy: vi.fn(async () => undefined),
    };
    return logger;
}

const publicHost = async () => ['93.184.216.34'];

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

        const tool = createDelegateToUrlTool({ resolveHost: publicHost });
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

        const tool = createDelegateToUrlTool({ resolveHost: publicHost });
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

describe('delegate_to_url URL checks', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([
        'ftp://example.com',
        'http://user:pass@example.com',
        'http://127.0.0.1:2375/containers/create?',
        'http://example.com/#fragment',
        'http://169.254.169.254',
        'http://[::ffff:169.254.169.254]',
        'http://[::ffff:a9fe:a9fe]',
        'http://169.254.169.254.',
        'http://metadata.google.internal.',
        'http://[fe80::1]',
        'http://[fd00:ec2::254]',
        'http://100.100.100.200',
        'http://2852039166',
    ])('rejects %s without sending a request', async (url) => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const tool = createDelegateToUrlTool({ resolveHost: publicHost });
        const input = tool.inputSchema.parse({ url, message: 'hi' });

        await expect(
            tool.execute(input, createToolContext(createMockLogger()))
        ).rejects.toMatchObject({
            code: 'DELEGATION_INVALID_URL',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a name that resolves to a metadata address without sending a request', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const tool = createDelegateToUrlTool({
            resolveHost: async () => ['93.184.216.34', '::ffff:a9fe:a9fe'],
        });
        const input = tool.inputSchema.parse({ url: 'http://agent.example.com', message: 'hi' });

        await expect(
            tool.execute(input, createToolContext(createMockLogger()))
        ).rejects.toMatchObject({ code: 'DELEGATION_INVALID_URL' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still delegates to a local agent and refuses redirects', async () => {
        const fetchMock = vi.fn(
            async (_url: string, _init?: RequestInit) =>
                new Response(JSON.stringify({ result: 'ok' }), {
                    headers: { 'content-type': 'application/json' },
                })
        );
        vi.stubGlobal('fetch', fetchMock);
        const tool = createDelegateToUrlTool({ resolveHost: publicHost });
        const input = tool.inputSchema.parse({ url: 'http://localhost:3001', message: 'hi' });

        await tool.execute(input, createToolContext(createMockLogger()));

        expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3001/v1/jsonrpc');
        expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('error');
    });
});
