import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingScopeFailure, type CommandContext } from '../command.js';
import { backendLogCommands } from './backend-logs.js';

const query = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', () => ({ queryWorkspaceTool: query }));

const [siteLogs, functionLogs] = backendLogCommands;
const siteId = '6f1f3c55-1e7a-4b8e-9d2b-3a1f5a6c7d80';
const projectId = '0b0e6a52-2c55-4c1d-8a43-2f3f7a9e1c11';
const response = {
    deploymentId: 'dep-2',
    durationMs: 12,
    method: 'GET',
    outcome: 'response',
    path: '/api/orders',
    status: 200,
    time: '2026-11-24T10:01:00.000Z',
};
const failure = {
    deploymentId: 'dep-2',
    durationMs: 30,
    errorMessage: 'token [redacted] rejected',
    errorType: 'TypeError',
    method: 'POST',
    outcome: 'error',
    path: '/api/orders',
    time: '2026-11-24T10:00:00.000Z',
};
const ok = {
    entries: [response, failure],
    from: '2026-11-24T09:05:00.000Z',
    limitation:
        "Requests and errors Dexto saw only; console output from the backend's own code is not captured.",
    status: 'ok',
    to: '2026-11-24T10:05:00.000Z',
};

function contextWith(scopes: readonly string[], json = true) {
    const output = { json, list: vi.fn(), note: vi.fn(), record: vi.fn(), result: vi.fn() };
    const context = {
        connection: async () => ({ kind: 'oauth', login: { scopes } }),
        output,
        overrides: { profile: null },
        runtime: { environment: {}, prompt: null },
    } as unknown as CommandContext;
    return { context, output };
}

beforeEach(() => query.mockReset());

describe('dexto cloud sites logs and cloud functions logs', () => {
    it('registers both under their groups', () => {
        expect(backendLogCommands.map((command) => command.path.join(' '))).toEqual([
            'cloud sites logs',
            'cloud functions logs',
        ]);
    });

    it("reads a Site's logs with the Site tool and prints its whole response as JSON", async () => {
        const { context, output } = contextWith(['sites:read']);
        query.mockResolvedValueOnce(ok);
        await siteLogs?.run(context, { positionals: [siteId], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_site_logs', { siteId });
        expect(output.record).toHaveBeenCalledWith(ok);
        expect(output.list).not.toHaveBeenCalled();
    });

    it("reads a Function's logs with the Function tool by its project id", async () => {
        const { context, output } = contextWith(['functions:read']);
        query.mockResolvedValueOnce(ok);
        await functionLogs?.run(context, { positionals: [projectId], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_function_logs', { projectId });
        expect(output.record).toHaveBeenCalledWith(ok);
    });

    it('prints requests as a table at a terminal, errors in the result column', async () => {
        const { context, output } = contextWith(['sites:read'], false);
        query.mockResolvedValueOnce(ok);
        await siteLogs?.run(context, { positionals: [siteId], values: {} });
        const [page, columns] = output.list.mock.calls[0] ?? [];
        expect(page).toEqual({ data: [response, failure] });
        const result = columns.find((column: { header: string }) => column.header === 'result');
        expect([response, failure].map((entry) => result.value(entry))).toEqual([
            200,
            'TypeError: token [redacted] rejected',
        ]);
        expect(output.note).toHaveBeenCalledWith(
            `Requests from ${ok.from} to ${ok.to}. ${ok.limitation}`
        );
    });

    it('says when logs are not configured instead of printing an empty table', async () => {
        const { context, output } = contextWith(['functions:read'], false);
        const value = {
            message: 'Backend logs are not configured here.',
            status: 'not-configured',
        };
        query.mockResolvedValueOnce(value);
        await functionLogs?.run(context, { positionals: [projectId], values: {} });
        expect(output.result).toHaveBeenCalledWith(value, value.message);
        expect(output.list).not.toHaveBeenCalled();
    });

    it('needs an id before calling', async () => {
        const { context } = contextWith(['sites:read', 'functions:read']);
        await expect(siteLogs?.run(context, { positionals: [], values: {} })).rejects.toThrow(
            'site_id'
        );
        await expect(functionLogs?.run(context, { positionals: [], values: {} })).rejects.toThrow(
            'function_id'
        );
        expect(query).not.toHaveBeenCalled();
    });

    it('asks for the read scope before calling', async () => {
        const { context } = contextWith([]);
        await expect(siteLogs?.run(context, { positionals: [siteId], values: {} })).rejects.toThrow(
            MissingScopeFailure
        );
        await expect(
            functionLogs?.run(context, { positionals: [projectId], values: {} })
        ).rejects.toThrow(MissingScopeFailure);
        expect(query).not.toHaveBeenCalled();
    });

    it('passes a server refusal through unchanged', async () => {
        const { context } = contextWith(['sites:read']);
        query.mockRejectedValueOnce(new Error('This Site has no backend to read logs of.'));
        await expect(siteLogs?.run(context, { positionals: [siteId], values: {} })).rejects.toThrow(
            'This Site has no backend to read logs of.'
        );
    });
});
