import { describe, expect, it, vi } from 'vitest';
import { JsonRpcServer } from './server.js';
import { JsonRpcErrorCode, JsonRpcInvalidParamsError } from './types.js';

function createServer(handler: () => Promise<unknown>, onError = vi.fn()) {
    return { server: new JsonRpcServer({ methods: { run: handler }, onError }), onError };
}

const request = { jsonrpc: '2.0', method: 'run', params: {}, id: 1 } as const;

describe('JsonRpcServer errors', () => {
    it('does not return the message or name of an unexpected error', async () => {
        const failure = new Error("ENOENT: no such file '/home/user/.dexto/secret-config.json'");
        failure.name = 'InternalFileError';
        const { server, onError } = createServer(async () => {
            throw failure;
        });

        const response = await server.handle(request);

        expect(response).toEqual({
            jsonrpc: '2.0',
            error: { code: JsonRpcErrorCode.INTERNAL_ERROR, message: 'Internal error' },
            id: 1,
        });
        expect(JSON.stringify(response)).not.toContain('secret-config');
        expect(onError).toHaveBeenCalledWith(failure, request);
    });

    it('returns the message of an error that marks the request as invalid', async () => {
        const { server } = createServer(async () => {
            throw new JsonRpcInvalidParamsError('Task not found: abc');
        });

        await expect(server.handle(request)).resolves.toEqual({
            jsonrpc: '2.0',
            error: { code: JsonRpcErrorCode.INVALID_PARAMS, message: 'Task not found: abc' },
            id: 1,
        });
    });
});
