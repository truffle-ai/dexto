import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandFailure } from '../../failure.js';
import { MissingScopeFailure, UsageError, type CommandContext } from '../command.js';
import { marketplaceCommands } from './marketplace.js';

const query = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', () => ({ queryWorkspaceTool: query }));

const [search, get, install, uninstall, preview, publish, unpublish] = marketplaceCommands;
const LISTING_ID = '6f1f3c55-1e7a-4b8e-9d2b-3a1f5a6c7d80';
const RELEASE_ID = '0b0e6a52-2c55-4c1d-8a43-2f3f7a9e1c11';
const listing = {
    description: null,
    id: LISTING_ID,
    installsCount: 3,
    isOwnedByRequester: false,
    kind: 'dexto-app',
    latestRelease: { kind: 'dexto-app', releaseId: RELEASE_ID },
    summary: 'Tracks invoices',
    title: 'Invoices',
};

const ALL_SCOPES = [
    'marketplace:read',
    'marketplace:write',
    'apps:read',
    'apps:write',
    'skills:read',
    'skills:write',
];

function contextWith(scopes: readonly string[] = ALL_SCOPES) {
    const output = { list: vi.fn(), result: vi.fn() };
    const context = {
        connection: async () => ({ kind: 'oauth', login: { scopes } }),
        invocation: ['marketplace'],
        output,
        overrides: { profile: null },
        runtime: { environment: {}, prompt: null },
    } as unknown as CommandContext;
    return { context, output };
}

function run(
    command: (typeof marketplaceCommands)[number] | undefined,
    context: CommandContext,
    positionals: string[],
    values: Record<string, string | boolean | string[]> = {}
) {
    if (command === undefined) throw new Error('missing command');
    return command.run(context, { positionals, values });
}

beforeEach(() => query.mockReset());

describe('dexto marketplace', () => {
    it('registers search, get, install, uninstall, preview, publish and unpublish', () => {
        expect(marketplaceCommands.map((command) => command.path.join(' '))).toEqual([
            'marketplace search',
            'marketplace get',
            'marketplace install',
            'marketplace uninstall',
            'marketplace preview',
            'marketplace publish',
            'marketplace unpublish',
        ]);
    });

    it('searches by text and kind and lists the listings', async () => {
        const { context, output } = contextWith(['marketplace:read']);
        query.mockResolvedValueOnce({ action: 'search', listings: [listing] });
        await run(search, context, ['invoices'], { kind: 'dexto-app' });
        expect(query).toHaveBeenCalledWith(context, 'dexto_marketplace_search', {
            kind: 'dexto-app',
            query: 'invoices',
        });
        expect(output.list).toHaveBeenCalledWith({ data: [listing] }, expect.any(Array));
    });

    it('searches everything with no filters and refuses an unknown kind before calling', async () => {
        const { context } = contextWith(['marketplace:read']);
        query.mockResolvedValueOnce({ action: 'search', listings: [] });
        await run(search, context, []);
        expect(query).toHaveBeenCalledWith(context, 'dexto_marketplace_search', {});
        await expect(run(search, context, [], { kind: 'action' })).rejects.toBeInstanceOf(
            UsageError
        );
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('reads one listing by kind and id, returning the whole result', async () => {
        const { context, output } = contextWith(['marketplace:read']);
        const value = { action: 'get', listing };
        query.mockResolvedValueOnce(value);
        await run(get, context, [LISTING_ID], { kind: 'dexto-app' });
        expect(query).toHaveBeenCalledWith(context, 'dexto_marketplace_get', {
            kind: 'dexto-app',
            listingId: LISTING_ID,
        });
        expect(output.result).toHaveBeenCalledWith(value, expect.stringContaining(RELEASE_ID));
        await expect(run(get, context, [LISTING_ID])).rejects.toThrow('--kind is required');
    });

    it('installs a Dexto App only at the release given, with confirm once agreed', async () => {
        const { context, output } = contextWith();
        query.mockResolvedValueOnce({ action: 'install' });
        await run(install, context, [LISTING_ID], {
            kind: 'dexto-app',
            release: RELEASE_ID,
            yes: true,
        });
        expect(query).toHaveBeenCalledWith(context, 'dexto_marketplace_install', {
            confirm: true,
            expectedReleaseId: RELEASE_ID,
            kind: 'dexto-app',
            listingId: LISTING_ID,
        });
        expect(output.result).toHaveBeenCalledWith(
            { action: 'install' },
            `Installed dexto-app listing ${LISTING_ID}.`
        );
    });

    it('refuses a Dexto App install without its release, and a release for another kind', async () => {
        const { context } = contextWith();
        await expect(
            run(install, context, [LISTING_ID], { kind: 'dexto-app', yes: true })
        ).rejects.toThrow('--release');
        await expect(
            run(install, context, [LISTING_ID], { kind: 'skill', release: RELEASE_ID, yes: true })
        ).rejects.toThrow('only for a dexto-app');
        expect(query).not.toHaveBeenCalled();
    });

    it('does not write without --yes when no one can be asked', async () => {
        const { context } = contextWith();
        const writes: [typeof install, string[], Record<string, string | string[]>][] = [
            [install, [LISTING_ID], { kind: 'skill' }],
            [uninstall, ['app-1'], {}],
            [publish, [], { app: 'app-1', title: 'Invoices', summary: 'Tracks invoices' }],
            [unpublish, [], { slug: 'my-skill' }],
        ];
        for (const [command, positionals, values] of writes) {
            const failure = await run(command, context, positionals, values).catch(
                (error: unknown) => error
            );
            expect(failure).toBeInstanceOf(CommandFailure);
            expect(failure).toMatchObject({ kind: 'needs_confirmation' });
        }
        expect(query).not.toHaveBeenCalled();
    });

    it('shows a write with --dry-run without asking or calling', async () => {
        const { context, output } = contextWith([]);
        await run(install, context, [LISTING_ID], { kind: 'skill', 'dry-run': true });
        expect(query).not.toHaveBeenCalled();
        expect(output.result).toHaveBeenCalledWith(
            {
                dryRun: true,
                tool: 'dexto_marketplace_install',
                arguments: { kind: 'skill', listingId: LISTING_ID },
            },
            expect.any(String)
        );
    });

    it('uninstalls a Dexto App by app id', async () => {
        const { context } = contextWith();
        query.mockResolvedValueOnce({ action: 'uninstall', kind: 'dexto-app', uninstalled: true });
        await run(uninstall, context, ['app-1'], { yes: true });
        expect(query).toHaveBeenCalledWith(context, 'dexto_marketplace_uninstall', {
            appId: 'app-1',
            confirm: true,
            kind: 'dexto-app',
        });
    });

    it('previews a Skill by exactly one of --skill-id or --slug', async () => {
        const { context, output } = contextWith(['marketplace:read', 'skills:read']);
        const value = {
            action: 'preview',
            publish: {
                fileCount: 2,
                listingId: null,
                release: { digest: 'sha', id: RELEASE_ID, version: 1 },
                skillId: 'skill-1',
            },
        };
        query.mockResolvedValueOnce(value);
        await run(preview, context, [], { slug: 'my-skill' });
        expect(query).toHaveBeenCalledWith(context, 'dexto_marketplace_preview', {
            kind: 'skill',
            slug: 'my-skill',
        });
        expect(output.result).toHaveBeenCalledWith(
            value,
            `Release ${RELEASE_ID}, 2 files, not listed yet.`
        );
        await expect(run(preview, context, [])).rejects.toThrow('--skill-id or --slug');
        await expect(
            run(preview, context, [], { slug: 'my-skill', 'skill-id': 'skill-1' })
        ).rejects.toThrow('not both');
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('publishes a Skill at a release with the listing details given', async () => {
        const { context } = contextWith();
        query.mockResolvedValueOnce({ action: 'publish', listing });
        await run(publish, context, [], {
            'skill-id': 'skill-1',
            release: RELEASE_ID,
            title: 'My Skill',
            summary: 'Does one thing',
            category: 'data',
            keyword: ['csv', 'reports'],
            license: 'MIT',
            yes: true,
        });
        expect(query).toHaveBeenCalledWith(context, 'dexto_marketplace_publish', {
            category: 'data',
            confirm: true,
            keywords: ['csv', 'reports'],
            kind: 'skill',
            license: 'MIT',
            releaseId: RELEASE_ID,
            skillId: 'skill-1',
            summary: 'Does one thing',
            title: 'My Skill',
        });
    });

    it('publishes a Dexto App with only a title, summary and description', async () => {
        const { context } = contextWith();
        query.mockResolvedValueOnce({ action: 'publish', listing });
        await run(publish, context, [], {
            app: 'app-1',
            title: 'Invoices',
            summary: 'Tracks invoices',
            description: 'Longer words',
            yes: true,
        });
        expect(query).toHaveBeenCalledWith(context, 'dexto_marketplace_publish', {
            appId: 'app-1',
            confirm: true,
            description: 'Longer words',
            kind: 'dexto-app',
            summary: 'Tracks invoices',
            title: 'Invoices',
        });
        await expect(
            run(publish, context, [], {
                app: 'app-1',
                title: 'Invoices',
                summary: 'Tracks invoices',
                release: RELEASE_ID,
                yes: true,
            })
        ).rejects.toThrow("only describe a Skill's listing");
        await expect(
            run(publish, context, [], { slug: 'my-skill', title: 'T', summary: 'S', yes: true })
        ).rejects.toThrow('--release');
        await expect(
            run(publish, context, [], { app: 'app-1', slug: 'my-skill', title: 'T', summary: 'S' })
        ).rejects.toThrow('not both');
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('unpublishes a Skill by slug', async () => {
        const { context } = contextWith();
        query.mockResolvedValueOnce({ action: 'unpublish', kind: 'skill', unpublished: true });
        await run(unpublish, context, [], { slug: 'my-skill', yes: true });
        expect(query).toHaveBeenCalledWith(context, 'dexto_marketplace_unpublish', {
            confirm: true,
            kind: 'skill',
            slug: 'my-skill',
        });
    });

    it("asks for each operation's own scopes before calling", async () => {
        const read = contextWith(['marketplace:read']).context;
        await expect(
            run(install, read, [LISTING_ID], { kind: 'skill', yes: true })
        ).rejects.toMatchObject({ scopes: ['marketplace:write'] });
        await expect(
            run(install, contextWith(['marketplace:write']).context, [LISTING_ID], {
                kind: 'dexto-app',
                release: RELEASE_ID,
                yes: true,
            })
        ).rejects.toMatchObject({ scopes: ['apps:read'] });
        await expect(run(preview, read, [], { slug: 'my-skill' })).rejects.toMatchObject({
            scopes: ['skills:read'],
        });
        const write = contextWith(['marketplace:write', 'apps:write']).context;
        await expect(
            run(publish, write, [], {
                slug: 'my-skill',
                release: RELEASE_ID,
                title: 'T',
                summary: 'S',
                yes: true,
            })
        ).rejects.toMatchObject({ scopes: ['skills:write'] });
        await expect(
            run(unpublish, contextWith(['marketplace:write']).context, [], {
                app: 'app-1',
                yes: true,
            })
        ).rejects.toMatchObject({ scopes: ['apps:write'] });
        await expect(run(search, contextWith([]).context, [])).rejects.toBeInstanceOf(
            MissingScopeFailure
        );
        expect(query).not.toHaveBeenCalled();
    });
});
