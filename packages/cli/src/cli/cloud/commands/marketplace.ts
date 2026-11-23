// `marketplace`: find, install and publish Dexto Marketplace listings, as you, over the Dexto MCP.

import type { dextoSignIn } from '@dexto/agent-management';
import { z } from 'zod';

import {
    argument,
    choiceOption,
    flag,
    listOption,
    requiredOption,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
    type OptionSpec,
} from '../command.js';
import { requireConsent } from '../../interaction.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const KINDS = ['autobot-template', 'dexto-app', 'skill'] as const;
const CATEGORIES = [
    'design',
    'writing',
    'research',
    'engineering',
    'data',
    'marketing',
    'media',
    'sales',
    'operations',
    'finance',
    'productivity',
    'education',
    'fun',
] as const;

const ListingSchema = z
    .object({
        id: z.string(),
        installsCount: z.number(),
        kind: z.string(),
        latestRelease: z.object({ releaseId: z.string() }).passthrough(),
        summary: z.string(),
        title: z.string(),
    })
    .passthrough();
const SearchSchema = z.object({ listings: z.array(ListingSchema) }).passthrough();
const GetSchema = z.object({ listing: ListingSchema }).passthrough();
const PreviewSchema = z
    .object({
        publish: z
            .object({
                fileCount: z.number(),
                listingId: z.string().nullable(),
                release: z.object({ id: z.string() }).passthrough(),
            })
            .passthrough(),
    })
    .passthrough();

const KIND_OPTION = {
    kind: { description: `What it lists: ${KINDS.join(', ')}.`, type: 'string' },
} as const satisfies Record<string, OptionSpec>;

/** One of your own Dexto Apps or Skills, named by exactly one of these. */
const TARGET_OPTIONS = {
    app: { description: 'Your Dexto App, by app id.', type: 'string', valueName: 'APP_ID' },
    'skill-id': { description: 'Your Skill, by skill id.', type: 'string', valueName: 'ID' },
    slug: { description: 'Your Skill, by its slug.', type: 'string', valueName: 'SLUG' },
} as const satisfies Record<string, OptionSpec>;

const SKILL_OPTIONS = {
    'skill-id': TARGET_OPTIONS['skill-id'],
    slug: TARGET_OPTIONS.slug,
} as const satisfies Record<string, OptionSpec>;

const WRITE_OPTIONS = {
    'dry-run': {
        description: 'Check the input and show the call, without making it.',
        type: 'boolean',
    },
    ...YES_OPTION,
} as const satisfies Record<string, OptionSpec>;

const search: Command = {
    arguments: '[query]',
    options: KIND_OPTION,
    path: ['marketplace', 'search'],
    summary:
        'Search the Marketplace listings you can see: AutoBot templates, Dexto Apps and Skills.',
    examples: [
        'dexto marketplace search invoices --json',
        'dexto marketplace search --kind skill --json',
    ],
    async run(context, input) {
        const kind = choiceOption(input, 'kind', KINDS);
        const query = input.positionals[0]?.trim();
        await requireLoginScopes(context, ['marketplace:read']);
        const { listings } = SearchSchema.parse(
            await queryWorkspaceTool(context, 'dexto_marketplace_search', {
                ...(kind === undefined ? {} : { kind }),
                ...(query === undefined || query === '' ? {} : { query }),
            })
        );
        context.output.list({ data: listings }, [
            { header: 'id', value: (listing) => listing.id },
            { header: 'kind', value: (listing) => listing.kind },
            { header: 'title', value: (listing) => listing.title },
            { header: 'installs', value: (listing) => String(listing.installsCount) },
        ]);
    },
};

const get: Command = {
    arguments: '<listing_id>',
    options: KIND_OPTION,
    path: ['marketplace', 'get'],
    summary: 'Show one Marketplace listing, with the release an install would get.',
    examples: ['dexto marketplace get "$LISTING_ID" --kind dexto-app --json'],
    async run(context, input) {
        const listingId = argument(input, 0, 'listing_id');
        const kind = requiredKind(input);
        await requireLoginScopes(context, ['marketplace:read']);
        const value = await queryWorkspaceTool(context, 'dexto_marketplace_get', {
            kind,
            listingId,
        });
        const { listing } = GetSchema.parse(value);
        context.output.result(
            value,
            `${listing.title} (${listing.kind})\n${listing.summary}\nRelease ${listing.latestRelease.releaseId}, ${listing.installsCount} installs`
        );
    },
};

const install: Command = {
    arguments: '<listing_id>',
    options: {
        ...KIND_OPTION,
        release: {
            description:
                "For a dexto-app, required: the listing's latest release id, as get or search showed it. A newer release installs nothing.",
            type: 'string',
            valueName: 'RELEASE_ID',
        },
        ...WRITE_OPTIONS,
    },
    path: ['marketplace', 'install'],
    summary:
        'Install a Marketplace listing: a Skill into your library, a Dexto App into your workspace, or an AutoBot template as a new AutoBot.',
    examples: [
        'dexto marketplace install "$LISTING_ID" --kind skill --yes --json',
        'dexto marketplace install "$LISTING_ID" --kind dexto-app --release "$RELEASE_ID" --yes',
    ],
    async run(context, input) {
        const listingId = argument(input, 0, 'listing_id');
        const kind = requiredKind(input);
        const release = stringOption(input, 'release');
        if (kind === 'dexto-app' && release === undefined)
            throw new UsageError(
                'A dexto-app installs only at the release you were shown: pass --release with its latestRelease.releaseId.'
            );
        if (kind !== 'dexto-app' && release !== undefined)
            throw new UsageError('--release is only for a dexto-app.');
        const value = await write(context, input, {
            call: {
                kind,
                listingId,
                ...(release === undefined ? {} : { expectedReleaseId: release }),
            },
            scopes:
                kind === 'dexto-app' ? ['marketplace:write', 'apps:read'] : ['marketplace:write'],
            tool: 'dexto_marketplace_install',
            what: `Install ${kind} listing ${listingId}.`,
        });
        if (value === null) return;
        context.output.result(value, `Installed ${kind} listing ${listingId}.`);
    },
};

const uninstall: Command = {
    arguments: '<app_id>',
    options: WRITE_OPTIONS,
    path: ['marketplace', 'uninstall'],
    summary:
        'Uninstall a Dexto App you installed from the Marketplace. An app you published is unpublished instead.',
    examples: ['dexto marketplace uninstall "$APP_ID" --yes --json'],
    async run(context, input) {
        const appId = argument(input, 0, 'app_id');
        const value = await write(context, input, {
            call: { appId, kind: 'dexto-app' },
            scopes: ['marketplace:write', 'apps:read'],
            tool: 'dexto_marketplace_uninstall',
            what: `Uninstall Dexto App ${appId}.`,
        });
        if (value === null) return;
        context.output.result(value, `Uninstalled Dexto App ${appId}.`);
    },
};

const preview: Command = {
    options: SKILL_OPTIONS,
    path: ['marketplace', 'preview'],
    summary:
        'Show which release of your Skill a publish would list, and its current listing; pass that release id to publish.',
    examples: ['dexto marketplace preview --slug my-skill --json'],
    async run(context, input) {
        const target = skillTarget(input);
        await requireLoginScopes(context, ['marketplace:read', 'skills:read']);
        const value = await queryWorkspaceTool(context, 'dexto_marketplace_preview', {
            kind: 'skill',
            ...target,
        });
        const { publish } = PreviewSchema.parse(value);
        context.output.result(
            value,
            `Release ${publish.release.id}, ${publish.fileCount} files${publish.listingId === null ? ', not listed yet' : `, listing ${publish.listingId}`}.`
        );
    },
};

const publish: Command = {
    options: {
        ...TARGET_OPTIONS,
        title: { description: "The listing's name as people read it.", type: 'string' },
        summary: { description: 'One line saying what it does.', type: 'string' },
        description: { description: 'A longer description, in markdown.', type: 'string' },
        release: {
            description: 'For a Skill, required: the release id marketplace preview showed.',
            type: 'string',
            valueName: 'RELEASE_ID',
        },
        category: {
            description: `For a Skill: ${CATEGORIES.join(', ')}.`,
            type: 'string',
        },
        keyword: {
            description: 'For a Skill: a lowercase search word; repeat for up to eight.',
            multiple: true,
            type: 'string',
        },
        license: {
            description: 'For a Skill: an SPDX license id, such as MIT, or proprietary.',
            type: 'string',
        },
        homepage: { description: 'For a Skill: an https link to its site.', type: 'string' },
        repository: {
            description: 'For a Skill: an https link to its source repository.',
            type: 'string',
        },
        ...WRITE_OPTIONS,
    },
    path: ['marketplace', 'publish'],
    summary:
        'Publish your own Dexto App or Skill to the Marketplace for other people to find and install. Publishing again updates the listing.',
    examples: [
        'dexto marketplace publish --slug my-skill --release "$RELEASE_ID" --title "My Skill" --summary "Does one thing well" --yes --json',
        'dexto marketplace publish --app "$APP_ID" --title "My App" --summary "Tracks invoices" --yes',
    ],
    async run(context, input) {
        const target = listingTarget(input);
        const title = requiredOption(input, 'title');
        const summary = requiredOption(input, 'summary');
        const description = stringOption(input, 'description');
        const listing = {
            title,
            summary,
            ...(description === undefined ? {} : { description }),
        };
        if (target.kind === 'dexto-app') rejectSkillDetails(input);
        const call = {
            ...target,
            ...listing,
            ...(target.kind === 'skill' ? skillListingDetails(input) : {}),
        };
        const name = listingName(target);
        const value = await write(context, input, {
            call,
            scopes: ['marketplace:write', target.kind === 'skill' ? 'skills:write' : 'apps:write'],
            tool: 'dexto_marketplace_publish',
            what: `Publish ${name} to the Marketplace as "${title}" for other people to find and install.`,
        });
        if (value === null) return;
        context.output.result(value, `Published "${title}" to the Marketplace.`);
    },
};

const unpublish: Command = {
    options: { ...TARGET_OPTIONS, ...WRITE_OPTIONS },
    path: ['marketplace', 'unpublish'],
    summary: 'Take your own Dexto App or Skill off the Marketplace. Your own copy stays.',
    examples: ['dexto marketplace unpublish --slug my-skill --yes --json'],
    async run(context, input) {
        const target = listingTarget(input);
        const name = listingName(target);
        const value = await write(context, input, {
            call: target,
            scopes: ['marketplace:write', target.kind === 'skill' ? 'skills:write' : 'apps:write'],
            tool: 'dexto_marketplace_unpublish',
            what: `Take ${name} off the Marketplace.`,
        });
        if (value === null) return;
        context.output.result(value, `Took ${name} off the Marketplace.`);
    },
};

function requiredKind(input: CommandInput) {
    const kind = choiceOption(input, 'kind', KINDS);
    if (kind === undefined) throw new UsageError(`--kind is required: ${KINDS.join(', ')}.`);
    return kind;
}

/** One of your Skills, by exactly one of --skill-id or --slug. */
function skillTarget(input: CommandInput): { skillId: string } | { slug: string } {
    const skillId = stringOption(input, 'skill-id');
    const slug = stringOption(input, 'slug');
    if (skillId !== undefined && slug !== undefined)
        throw new UsageError('Pass --skill-id or --slug, not both.');
    if (skillId !== undefined) return { skillId };
    if (slug !== undefined) return { slug };
    throw new UsageError('Name your Skill with --skill-id or --slug.');
}

/** One of your Dexto Apps (--app) or Skills (--skill-id or --slug). */
type ListingTarget =
    | { appId: string; kind: 'dexto-app' }
    | ({ kind: 'skill' } & ({ skillId: string } | { slug: string }));

function listingTarget(input: CommandInput): ListingTarget {
    const appId = stringOption(input, 'app');
    if (appId === undefined) return { kind: 'skill', ...skillTarget(input) };
    if (stringOption(input, 'skill-id') !== undefined || stringOption(input, 'slug') !== undefined)
        throw new UsageError('Pass --app, or --skill-id or --slug, not both.');
    return { appId, kind: 'dexto-app' };
}

const SKILL_ONLY = ['release', 'category', 'keyword', 'license', 'homepage', 'repository'] as const;

function listingName(target: ListingTarget): string {
    if (target.kind === 'dexto-app') return `Dexto App ${target.appId}`;
    return 'skillId' in target ? `Skill ${target.skillId}` : `Skill ${target.slug}`;
}

/** A Dexto App's listing has only a title, summary and description. */
function rejectSkillDetails(input: CommandInput): void {
    const given = SKILL_ONLY.filter((name) => input.values[name] !== undefined);
    if (given.length > 0)
        throw new UsageError(
            `${given.map((name) => `--${name}`).join(', ')} only describe a Skill's listing.`
        );
}

/** A Skill listing's release and the details given; ones left out keep their current value. */
function skillListingDetails(input: CommandInput) {
    const releaseId = stringOption(input, 'release');
    if (releaseId === undefined)
        throw new UsageError(
            'Pass --release with the release id dexto marketplace preview showed for this Skill.'
        );
    const category = choiceOption(input, 'category', CATEGORIES);
    const keywords = listOption(input, 'keyword');
    const license = stringOption(input, 'license');
    const homepageUrl = stringOption(input, 'homepage');
    const repositoryUrl = stringOption(input, 'repository');
    return {
        releaseId,
        ...(category === undefined ? {} : { category }),
        ...(keywords.length === 0 ? {} : { keywords }),
        ...(license === undefined ? {} : { license }),
        ...(homepageUrl === undefined ? {} : { homepageUrl }),
        ...(repositoryUrl === undefined ? {} : { repositoryUrl }),
    };
}

/**
 * A Marketplace write: with --dry-run only shows the call; otherwise asks for its permissions, then
 * for the person's agreement (--yes, or at a terminal), and sends `confirm: true` as the server's
 * sign that they agreed. Null when it only showed the call.
 */
async function write(
    context: CommandContext,
    input: CommandInput,
    {
        call,
        scopes,
        tool,
        what,
    }: {
        call: Record<string, unknown>;
        scopes: readonly dextoSignIn.CliLoginScope[];
        tool: string;
        what: string;
    }
): Promise<unknown> {
    if (flag(input, 'dry-run')) {
        context.output.result(
            { dryRun: true, tool, arguments: call },
            `Would call ${tool} with ${JSON.stringify(call)}.`
        );
        return null;
    }
    await requireLoginScopes(context, scopes);
    await requireConsent(context, flag(input, 'yes'), what);
    return await queryWorkspaceTool(context, tool, { ...call, confirm: true });
}

export const marketplaceCommands: readonly Command[] = [
    search,
    get,
    install,
    uninstall,
    preview,
    publish,
    unpublish,
];
