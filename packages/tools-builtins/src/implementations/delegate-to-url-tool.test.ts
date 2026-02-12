import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDelegateToUrlTool } from './delegate-to-url-tool.js';
import { DextoRuntimeError, ErrorScope, ErrorType } from '@dexto/core';

describe('delegate_to_url tool', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('throws DELEGATION_FAILED when it cannot reach the remote agent', async () => {
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

        await expect(tool.execute(input)).rejects.toMatchObject({
            name: 'DextoRuntimeError',
            code: 'DELEGATION_FAILED',
            scope: ErrorScope.TOOLS,
            type: ErrorType.THIRD_PARTY,
        });
    });

    it('throws DELEGATION_TIMEOUT when the request times out', async () => {
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
            await tool.execute(input);
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
