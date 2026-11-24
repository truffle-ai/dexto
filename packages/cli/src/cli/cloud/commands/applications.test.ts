import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingScopeFailure, type CommandContext } from '../command.js';
import type { Column } from '../output.js';
import { applicationCommands } from './applications.js';

const query = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', () => ({ queryWorkspaceTool: query }));

const [list, get, release, logs, operations, history, insights, usage] = applicationCommands;
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
    it('registers list, get, release, logs, operations, history, insights and usage', () => {
        expect(applicationCommands.map((command) => command.path.join(' '))).toEqual([
            'applications list',
            'applications get',
            'applications release',
            'applications logs',
            'applications operations',
            'applications history',
            'applications insights',
            'applications usage',
        ]);
    });

    it('lists with the list tool and prints its whole response as JSON', async () => {
        const { context, output } = contextWith(['applications:read']);
        const value = { applications: [application], deployments: [deployment] };
        query.mockResolvedValueOnce(value);
        await list?.run(context, { positionals: [], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_applications_list', {});
        expect(output.record).toHaveBeenCalledWith(value);
        expect(output.list).not.toHaveBeenCalled();
    });

    it('shows people one table of Applications and one of releases', async () => {
        const { context, output } = contextWith(['applications:read'], false);
        query.mockResolvedValueOnce({ applications: [application], deployments: [deployment] });
        await list?.run(context, { positionals: [], values: {} });
        expect(output.list).toHaveBeenNthCalledWith(1, { data: [application] }, expect.any(Array));
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
        for (const command of [operations, insights, usage])
            await expect(command?.run(context, { positionals: [], values: {} })).rejects.toThrow(
                'application_id'
            );
        await expect(history?.run(context, { positionals: [], values: {} })).rejects.toThrow(
            'resource_id'
        );
        expect(query).not.toHaveBeenCalled();
    });

    it('lists lifecycle operations by Application id, whole as JSON and as a table for people', async () => {
        const value = {
            operations: [
                {
                    id: '9a7c1f20-3d4e-4b5f-8a6b-7c8d9e0f1a2b',
                    applicationId,
                    generation: 2,
                    action: 'suspend',
                    desiredState: 'suspended',
                    status: 'pending',
                    createdAt: '2026-11-24T10:00:00.000Z',
                    completedAt: null,
                },
            ],
        };
        const json = contextWith(['applications:read']);
        query.mockResolvedValueOnce(value);
        await operations?.run(json.context, { positionals: [applicationId], values: {} });
        expect(query).toHaveBeenCalledWith(json.context, 'dexto_application_operations_list', {
            applicationId,
        });
        expect(json.output.record).toHaveBeenCalledWith(value);

        const people = contextWith(['applications:read'], false);
        query.mockResolvedValueOnce(value);
        await operations?.run(people.context, { positionals: [applicationId], values: {} });
        expect(people.output.list).toHaveBeenCalledWith(
            { data: value.operations },
            expect.any(Array)
        );
    });

    it("reads an Application's history by default and a release's with --kind release", async () => {
        const value = {
            events: [
                { action: 'observed', status: 'ready', createdAt: '2026-11-24T09:00:00.000Z' },
            ],
        };
        const { context, output } = contextWith(['applications:read']);
        query.mockResolvedValueOnce(value);
        await history?.run(context, { positionals: [applicationId], values: {} });
        expect(query).toHaveBeenLastCalledWith(context, 'dexto_application_history', {
            resourceId: applicationId,
            resourceKind: 'project',
        });
        expect(output.record).toHaveBeenCalledWith(value);

        query.mockResolvedValueOnce({ events: [] });
        await history?.run(context, { positionals: [deploymentId], values: { kind: 'release' } });
        expect(query).toHaveBeenLastCalledWith(context, 'dexto_application_history', {
            resourceId: deploymentId,
            resourceKind: 'release',
        });
    });

    it('refuses an unknown history kind before calling', async () => {
        const { context } = contextWith(['applications:read']);
        await expect(
            history?.run(context, { positionals: [applicationId], values: { kind: 'deployment' } })
        ).rejects.toThrow('--kind must be one of: project, release.');
        expect(query).not.toHaveBeenCalled();
    });

    it('keeps an unavailable insight metric null, never zero', async () => {
        const value = {
            insights: {
                observedAt: '2026-11-24T12:00:00.000Z',
                compute: {
                    runningTasks: 0,
                    desiredTasks: 0,
                    cpuPercent: null,
                    memoryPercent: { value: 0, observedAt: '2026-11-24T11:55:00.000Z' },
                },
                storage: { standardStorageBytes: null, objectCount: null },
            },
        };
        const json = contextWith(['applications:read']);
        query.mockResolvedValueOnce(value);
        await insights?.run(json.context, { positionals: [applicationId], values: {} });
        expect(query).toHaveBeenCalledWith(json.context, 'dexto_application_insights', {
            applicationId,
        });
        expect(json.output.record).toHaveBeenCalledWith(value);

        const people = contextWith(['applications:read'], false);
        query.mockResolvedValueOnce(value);
        await insights?.run(people.context, { positionals: [applicationId], values: {} });
        expect(people.output.record).toHaveBeenCalledWith(value.insights);
    });

    it('keeps estimated costs apart from settled charges, and an unreported cost null', async () => {
        const reported = {
            start: '2026-11-23',
            end: '2026-11-24',
            estimated: true,
            providerCostUsd: 0.61,
            estimatedCustomerCostUsd: 0.793,
        };
        const unreported = {
            start: '2026-11-22',
            end: '2026-11-23',
            estimated: false,
            providerCostUsd: null,
            estimatedCustomerCostUsd: null,
        };
        const value = {
            billingMode: 'credits',
            pricingVersion: '2026-10',
            billingStart: '2026-11-01',
            reportedAt: '2026-11-24T06:00:00.000Z',
            totalChargeUsd: 0,
            periods: [reported, unreported],
        };
        const json = contextWith(['applications:read']);
        query.mockResolvedValueOnce(value);
        await usage?.run(json.context, { positionals: [applicationId], values: {} });
        expect(query).toHaveBeenCalledWith(json.context, 'dexto_application_usage', {
            applicationId,
        });
        expect(json.output.record).toHaveBeenCalledWith(value);

        const people = contextWith(['applications:read'], false);
        query.mockResolvedValueOnce(value);
        await usage?.run(people.context, { positionals: [applicationId], values: {} });
        expect(people.output.record).toHaveBeenCalledWith({
            billingMode: 'credits',
            pricingVersion: '2026-10',
            billingStart: '2026-11-01',
            reportedAt: '2026-11-24T06:00:00.000Z',
            settledChargeUsd: 0,
        });
        const [page, columns] = people.output.list.mock.calls[0] ?? [];
        expect(page).toEqual({ data: [reported, unreported] });
        const cells = (period: typeof reported | typeof unreported) =>
            Object.fromEntries(
                columns.map((column: Column<typeof period>) => [
                    column.header,
                    column.value(period),
                ])
            );
        expect(cells(reported)).toMatchObject({
            'estimated provider usd': 0.61,
            'estimated cost usd': 0.793,
        });
        expect(cells(unreported)).toMatchObject({
            'estimated provider usd': null,
            'estimated cost usd': null,
        });
    });

    it('asks for applications:read before any call', async () => {
        const { context } = contextWith([]);
        await expect(list?.run(context, { positionals: [], values: {} })).rejects.toBeInstanceOf(
            MissingScopeFailure
        );
        for (const command of [get, release, logs, operations, history, insights, usage])
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
        for (const command of [operations, history, insights, usage]) {
            query.mockRejectedValueOnce(failure);
            await expect(
                command?.run(context, { positionals: [applicationId], values: {} })
            ).rejects.toBe(failure);
        }
    });
});
