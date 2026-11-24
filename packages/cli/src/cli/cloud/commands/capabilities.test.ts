import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandFailure } from '../../failure.js';
import { MissingScopeFailure, UsageError, type CommandContext } from '../command.js';
import { capabilityCommands } from './capabilities.js';

const query = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', () => ({ queryWorkspaceTool: query }));

const [search] = capabilityCommands;
const hit = {
    aliases: ['dexto.platform.dexto_site_deploy'],
    description: 'Deploy a Site.',
    execution: { mode: 'hosted', owner: 'cloud' },
    id: { sourceId: 'dexto.platform', toolId: 'dexto_site_deploy' },
    invocable: { mode: 'available' },
    name: 'dexto_site_deploy',
    sourceId: 'dexto.platform',
    tags: ['sites'],
};
const page = { hasMore: true, items: [hit], nextOffset: 11, total: 40 };

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

function run(context: CommandContext, positionals: string[], values: Record<string, string> = {}) {
    if (search === undefined) throw new Error('capabilities search is not registered');
    return search.run(context, { positionals, values });
}

beforeEach(() => query.mockReset());

describe('dexto capabilities search', () => {
    it('registers capabilities search', () => {
        expect(capabilityCommands.map((command) => command.path.join(' '))).toEqual([
            'capabilities search',
        ]);
    });

    it('sends the query alone, and prints the whole page as JSON', async () => {
        const { context, output } = contextWith(['capabilities:read']);
        query.mockResolvedValueOnce(page);
        await run(context, ['deploy', 'a', 'site']);
        expect(query).toHaveBeenCalledWith(context, 'dexto_capabilities_search', {
            query: 'deploy a site',
        });
        expect(output.record).toHaveBeenCalledWith(page);
        expect(output.list).not.toHaveBeenCalled();
    });

    it('forwards --limit and --offset as numbers', async () => {
        const { context } = contextWith(['capabilities:read']);
        query.mockResolvedValueOnce(page);
        await run(context, ['github'], { limit: '10', offset: '0' });
        expect(query).toHaveBeenCalledWith(context, 'dexto_capabilities_search', {
            limit: 10,
            offset: 0,
            query: 'github',
        });
    });

    it('shows people a table and where the next page starts', async () => {
        const { context, output } = contextWith(['capabilities:read'], false);
        query.mockResolvedValueOnce(page);
        await run(context, ['site'], { offset: '10' });
        expect(output.list).toHaveBeenCalledWith({ data: [hit] }, expect.any(Array));
        expect(output.note).toHaveBeenCalledWith('1 of 40. More results: add --offset 11');
    });

    it('returns an empty page as it is, with no next page', async () => {
        const empty = { hasMore: false, items: [], nextOffset: null, total: 0 };
        const json = contextWith(['capabilities:read']);
        query.mockResolvedValueOnce(empty);
        await run(json.context, ['nothing-matches']);
        expect(json.output.record).toHaveBeenCalledWith(empty);
        const table = contextWith(['capabilities:read'], false);
        query.mockResolvedValueOnce(empty);
        await run(table.context, ['nothing-matches']);
        expect(table.output.list).toHaveBeenCalledWith({ data: [] }, expect.any(Array));
        expect(table.output.note).not.toHaveBeenCalled();
    });

    it('refuses a missing query or an out-of-range page before any call', async () => {
        const { context } = contextWith(['capabilities:read']);
        await expect(run(context, [' '])).rejects.toBeInstanceOf(UsageError);
        await expect(run(context, ['x'], { limit: '0' })).rejects.toThrow('--limit');
        await expect(run(context, ['x'], { limit: '101' })).rejects.toThrow('--limit');
        await expect(run(context, ['x'], { offset: '-1' })).rejects.toThrow('--offset');
        await expect(run(context, ['x'], { offset: '1.5' })).rejects.toThrow('--offset');
        expect(query).not.toHaveBeenCalled();
    });

    it('asks for capabilities:read before any call', async () => {
        const { context } = contextWith(['cloud:read']);
        await expect(run(context, ['github'])).rejects.toBeInstanceOf(MissingScopeFailure);
        await expect(run(context, ['github'])).rejects.toMatchObject({
            scopes: ['capabilities:read'],
        });
        expect(query).not.toHaveBeenCalled();
    });

    it('passes a tool error through unchanged', async () => {
        const { context } = contextWith(['capabilities:read']);
        const failure = new CommandFailure('failed', 'Invalid Dexto capability input.', null);
        query.mockRejectedValueOnce(failure);
        await expect(run(context, ['github'])).rejects.toBe(failure);
    });
});
