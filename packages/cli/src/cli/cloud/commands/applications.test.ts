import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingScopeFailure, type CommandContext } from '../command.js';
import { applicationCommands } from './applications.js';

const query = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', () => ({ queryWorkspaceTool: query }));

const [list, get, release, logs] = applicationCommands;
const applicationId = '6f1f3c55-1e7a-4b8e-9d2b-3a1f5a6c7d80';
const deploymentId = '0b0e6a52-2c55-4c1d-8a43-2f3f7a9e1c11';
const application = {
    id: applicationId,
    slug: 'orders',
    title: 'Orders',
    status: 'ready',
    connectionId: `app-${applicationId}`,
    backend: { provider: 'aws', runtimeVariables: ['DATABASE_URL'] },
};
const deployment = {
    id: deploymentId,
    slug: 'orders',
    status: 'ready',
    endpointUrl: 'https://orders.example.dexto.app',
    createdAt: '2026-11-18T10:00:00.000Z',
    progress: { step: 'ready' },
};

function contextWith(scopes: readonly string[], json = true) {
    const output = { json, list: vi.fn(), record: vi.fn(), result: vi.fn() };
    const context = {
        connection: async () => ({ kind: 'oauth', login: { scopes } }),
        output,
        overrides: { profile: null },
        runtime: { environment: {}, prompt: null },
    } as unknown as CommandContext;
    return { context, output };
}

beforeEach(() => query.mockReset());

describe('dexto applications', () => {
    it('registers list, get, release and logs', () => {
        expect(applicationCommands.map((command) => command.path.join(' '))).toEqual([
            'applications list',
            'applications get',
            'applications release',
            'applications logs',
        ]);
    });

    it('lists with the list tool and prints the releases beside the list as JSON', async () => {
        const { context, output } = contextWith(['applications:read']);
        const value = { applications: [application], deployments: [deployment] };
        query.mockResolvedValueOnce(value);
        await list?.run(context, { positionals: [], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_applications_list', {});
        expect(output.list).toHaveBeenCalledTimes(1);
        expect(output.list).toHaveBeenCalledWith(
            { data: [application], deployments: [deployment] },
            expect.any(Array)
        );
        expect(output.record).not.toHaveBeenCalled();
    });

    it('shows people one table of Applications and one of releases', async () => {
        const { context, output } = contextWith(['applications:read'], false);
        query.mockResolvedValueOnce({ applications: [application], deployments: [deployment] });
        await list?.run(context, { positionals: [], values: {} });
        expect(output.list).toHaveBeenNthCalledWith(
            1,
            { data: [application], deployments: [deployment] },
            expect.any(Array)
        );
        expect(output.list).toHaveBeenNthCalledWith(2, { data: [deployment] }, expect.any(Array));
        query.mockResolvedValueOnce({ applications: [], deployments: [] });
        await list?.run(context, { positionals: [], values: {} });
        expect(output.list).toHaveBeenCalledTimes(3);
    });

    it('gets one Application by its id', async () => {
        const { context, output } = contextWith(['applications:read']);
        query.mockResolvedValueOnce(application);
        await get?.run(context, { positionals: [applicationId], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_application_get', { applicationId });
        expect(output.record).toHaveBeenCalledWith(application);
    });

    it('inspects one release by its deploymentId', async () => {
        const { context, output } = contextWith(['applications:read']);
        query.mockResolvedValueOnce(deployment);
        await release?.run(context, { positionals: [deploymentId], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_application_release_get', {
            deploymentId,
        });
        expect(output.record).toHaveBeenCalledWith(deployment);
    });

    it('prints the release logs the server returns, and its whole response as JSON', async () => {
        const { context, output } = contextWith(['applications:read']);
        const value = {
            logs: 'Reservation unresolved; inspect this release.',
            status: 'uncertain',
        };
        query.mockResolvedValueOnce(value);
        await logs?.run(context, { positionals: [deploymentId], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_application_logs', { deploymentId });
        expect(output.result).toHaveBeenCalledWith(value, value.logs);
    });

    it('needs an id before calling', async () => {
        const { context } = contextWith(['applications:read']);
        await expect(get?.run(context, { positionals: [], values: {} })).rejects.toThrow(
            'application_id'
        );
        await expect(release?.run(context, { positionals: [], values: {} })).rejects.toThrow(
            'deployment_id'
        );
        await expect(logs?.run(context, { positionals: [], values: {} })).rejects.toThrow(
            'deployment_id'
        );
        expect(query).not.toHaveBeenCalled();
    });

    it('asks for applications:read before any call', async () => {
        const { context } = contextWith([]);
        await expect(list?.run(context, { positionals: [], values: {} })).rejects.toBeInstanceOf(
            MissingScopeFailure
        );
        for (const command of [get, release, logs])
            await expect(
                command?.run(context, { positionals: [deploymentId], values: {} })
            ).rejects.toMatchObject({ scopes: ['applications:read'] });
        expect(query).not.toHaveBeenCalled();
    });

    it('passes a server error through unchanged', async () => {
        const { context } = contextWith(['applications:read']);
        const failure = new Error('Application not found.');
        query.mockRejectedValueOnce(failure);
        await expect(get?.run(context, { positionals: [applicationId], values: {} })).rejects.toBe(
            failure
        );
    });
});
