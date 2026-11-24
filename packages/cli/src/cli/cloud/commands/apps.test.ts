import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingScopeFailure, type CommandContext } from '../command.js';
import { appCommands } from './apps.js';

const query = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', () => ({ queryWorkspaceTool: query }));

const [list, get, uninstalled] = appCommands;
const app = {
    actionsAvailable: ['notes.create'],
    delivery: 'hosted-static',
    description: 'Write notes.',
    id: 'notes',
    title: 'Notes',
};
const action = {
    available: true,
    execution: 'headless',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    kind: 'domain',
    level: 'act',
    requiredScopes: ['apps:execute'],
    title: 'Create a note',
    toolName: 'notes.create',
};
const detail = {
    actionCatalogVersion: 1,
    actions: [action],
    app: {
        delivery: 'hosted-static',
        description: 'Write notes.',
        id: 'notes',
        launchUrl: 'https://dexto.example/_dexto/apps/notes/',
        title: 'Notes',
    },
    ok: true,
    status: 'available',
};
const retained = { appId: 'notes', dataDeletedOn: '2026-12-23T00:00:00.000Z', title: 'Notes' };

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

describe('dexto apps', () => {
    it('registers list, get and uninstalled', () => {
        expect(appCommands.map((command) => command.path.join(' '))).toEqual([
            'apps list',
            'apps get',
            'apps uninstalled',
        ]);
    });

    it('lists with the list tool and prints activeAppId beside the list as JSON', async () => {
        const { context, output } = contextWith(['apps:read']);
        const value = { activeAppId: null, apps: [app] };
        query.mockResolvedValueOnce(value);
        await list?.run(context, { positionals: [], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_apps_list', {});
        expect(output.list).toHaveBeenCalledWith(
            { activeAppId: null, data: [app] },
            expect.any(Array)
        );
        expect(output.record).not.toHaveBeenCalled();
    });

    it('shows people a table of Apps, empty or not', async () => {
        const { context, output } = contextWith(['apps:read'], false);
        query.mockResolvedValueOnce({ activeAppId: null, apps: [app] });
        await list?.run(context, { positionals: [], values: {} });
        expect(output.list).toHaveBeenLastCalledWith(
            { activeAppId: null, data: [app] },
            expect.any(Array)
        );
        query.mockResolvedValueOnce({ activeAppId: null, apps: [] });
        await list?.run(context, { positionals: [], values: {} });
        expect(output.list).toHaveBeenLastCalledWith(
            { activeAppId: null, data: [] },
            expect.any(Array)
        );
    });

    it('gets one App by its id, keeping action input schemas and launch URL in JSON', async () => {
        const { context, output } = contextWith(['apps:read']);
        query.mockResolvedValueOnce(detail);
        await get?.run(context, { positionals: ['notes'], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_app_get', { appId: 'notes' });
        expect(output.record).toHaveBeenCalledWith(detail);
    });

    it('shows people the App and a table of its actions', async () => {
        const { context, output } = contextWith(['apps:read'], false);
        query.mockResolvedValueOnce(detail);
        await get?.run(context, { positionals: ['notes'], values: {} });
        expect(output.record).toHaveBeenCalledWith(detail.app);
        expect(output.list).toHaveBeenCalledWith({ data: [action] }, expect.any(Array));
        query.mockResolvedValueOnce({ ...detail, actions: [] });
        await get?.run(context, { positionals: ['notes'], values: {} });
        expect(output.list).toHaveBeenCalledTimes(1);
    });

    it('lists uninstalled Apps with retained data, as JSON and as a table', async () => {
        const { context, output } = contextWith(['apps:read']);
        const value = { apps: [retained] };
        query.mockResolvedValueOnce(value);
        await uninstalled?.run(context, { positionals: [], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_apps_uninstalled_list', {});
        expect(output.list).toHaveBeenCalledWith({ data: [retained] }, expect.any(Array));

        const people = contextWith(['apps:read'], false);
        query.mockResolvedValueOnce({ apps: [] });
        await uninstalled?.run(people.context, { positionals: [], values: {} });
        expect(people.output.list).toHaveBeenCalledWith({ data: [] }, expect.any(Array));
    });

    it('needs an App id before calling', async () => {
        const { context } = contextWith(['apps:read']);
        await expect(get?.run(context, { positionals: [], values: {} })).rejects.toThrow('app_id');
        expect(query).not.toHaveBeenCalled();
    });

    it('asks for apps:read before any call', async () => {
        const { context } = contextWith([]);
        await expect(list?.run(context, { positionals: [], values: {} })).rejects.toBeInstanceOf(
            MissingScopeFailure
        );
        for (const command of [get, uninstalled])
            await expect(
                command?.run(context, { positionals: ['notes'], values: {} })
            ).rejects.toMatchObject({ scopes: ['apps:read'] });
        expect(query).not.toHaveBeenCalled();
    });

    it('passes an App the sign-in cannot reach through as the server error', async () => {
        const { context } = contextWith(['apps:read']);
        const failure = new Error('Dexto App private is not available.');
        query.mockRejectedValueOnce(failure);
        await expect(get?.run(context, { positionals: ['private'], values: {} })).rejects.toBe(
            failure
        );
    });
});
