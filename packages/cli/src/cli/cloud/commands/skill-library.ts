// The `skills` verbs past push and sync: read a Skill and its files, check, create, update and delete
// one, install and uninstall it, list and restore its versions, and publish it to the Store. Each
// calls the Dexto MCP's own Skill tool with the person's sign-in.

import { CommandFailure } from '../../failure.js';

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

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
    UUID,
} from '../command.js';
import type { Column } from '../output.js';
import { readSkillBundle, SKILL_BUNDLE_OPTIONS } from '../skill-bundle.js';
import { requireLoginScopes } from './deploys.js';
import { agreeToCall, listWorkspaceTools, queryWorkspaceTool, toolCallLevel } from './workspace.js';

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

const SkillSchema = z.object({
    release: z.object({ id: z.string(), version: z.string() }),
    title: z.string(),
});
const FileSchema = z.object({ content: z.string(), file: z.object({ path: z.string() }) });
const AuthoredSchema = z.object({
    skill: z.object({ id: z.string(), slug: z.string(), title: z.string() }),
});
const VersionSchema = z.object({
    createdAt: z.string(),
    number: z.number(),
    savedBy: z.object({ displayName: z.string() }).nullable(),
    versionId: z.string(),
});
const VersionsSchema = z.object({ versions: z.array(VersionSchema) });

const VERSION_COLUMNS: readonly Column<z.output<typeof VersionSchema>>[] = [
    { header: 'number', value: (version) => String(version.number) },
    { header: 'version_id', value: (version) => version.versionId },
    { header: 'saved', value: (version) => version.createdAt },
    { header: 'saved_by', value: (version) => version.savedBy?.displayName ?? '' },
];

const LISTING_OPTION = {
    listing: {
        description: '<skill> is a Store listing id, not a library Skill id.',
        type: 'boolean',
    },
} as const satisfies Record<string, OptionSpec>;

const DRY_RUN_OPTION = {
    'dry-run': {
        description: 'Check the input and show the call, without making it.',
        type: 'boolean',
    },
} as const satisfies Record<string, OptionSpec>;

const WRITE_OPTIONS = { ...DRY_RUN_OPTION, ...YES_OPTION } as const;

const SKILL_ARGUMENT =
    '<skill> is a library Skill id, or a Store listing as @publisher/name (or by id with --listing).';

const get: Command = {
    arguments: '<skill>',
    examples: ['dexto skills get "$SKILL_ID" --json', 'dexto skills get @publisher/name --json'],
    options: LISTING_OPTION,
    path: ['skills', 'get'],
    summary: `Show a Skill: its SKILL.md instructions, its files and its release. ${SKILL_ARGUMENT}`,
    async run(context, input) {
        await requireLoginScopes(context, ['skills:read']);
        context.output.record(
            await queryWorkspaceTool(context, 'dexto_skill_get', {
                location: skillLocation(input, argument(input, 0, 'skill')),
            })
        );
    },
};

const file: Command = {
    arguments: '<skill> <path>',
    examples: ['dexto skills file "$SKILL_ID" references/style.md --out style.md'],
    options: {
        ...LISTING_OPTION,
        out: {
            description: "Write the file's text here, and show the rest without it.",
            type: 'string',
            valueName: 'PATH',
        },
    },
    path: ['skills', 'file'],
    summary: `Read one file a Skill's bundle declares, by its path in the bundle. ${SKILL_ARGUMENT}`,
    async run(context, input) {
        await requireLoginScopes(context, ['skills:read']);
        const value = await queryWorkspaceTool(context, 'dexto_skill_file_get', {
            location: skillLocation(input, argument(input, 0, 'skill')),
            path: argument(input, 1, 'path'),
        });
        const out = stringOption(input, 'out');
        if (out === undefined) return context.output.record(value);
        const { content, ...rest } = FileSchema.parse(value);
        await writeFile(out, content, 'utf8');
        context.output.record({ ...rest, contentPath: path.resolve(out) });
    },
};

const validate: Command = {
    arguments: '<folder>',
    examples: ['dexto skills validate ./my-skill --json'],
    options: SKILL_BUNDLE_OPTIONS,
    path: ['skills', 'validate'],
    summary:
        'Check a local Skill folder as Dexto would save it, without saving it: its digest and manifest, or the problem to fix.',
    async run(context, input) {
        await requireLoginScopes(context, ['skills:read']);
        const { call } = await bundleCall(input, argument(input, 0, 'folder'));
        const value = await queryWorkspaceTool(context, 'dexto_skill_validate', call);
        context.output.result(value, `${call.slug} is a valid Skill.`);
    },
};

const create: Command = {
    arguments: '<folder>',
    examples: ['dexto skills create ./my-skill --yes --json'],
    options: { ...SKILL_BUNDLE_OPTIONS, ...WRITE_OPTIONS },
    path: ['skills', 'create'],
    summary:
        'Create one of your own Skills from a local folder of text files (SKILL.md at its root) and install it. Sending the same folder again returns the same Skill.',
    async run(context, input) {
        await requireLoginScopes(context, ['skills:write']);
        const bundle = await bundleCall(input, argument(input, 0, 'folder'));
        await writeSkill(context, input, {
            call: bundle.call,
            done: (value) => authoredMessage('Created', value),
            shown: bundle.shown,
            title: `Create the Skill ${bundle.call.slug}`,
            tool: 'dexto_skill_create',
        });
    },
};

const update: Command = {
    arguments: '<skill_id> <folder>',
    examples: ['dexto skills update "$SKILL_ID" ./my-skill --yes --json'],
    options: { ...SKILL_BUNDLE_OPTIONS, ...WRITE_OPTIONS },
    path: ['skills', 'update'],
    summary:
        "Replace one of your own Skills with a local folder as its new release. The release has only the folder's files.",
    async run(context, input) {
        await requireLoginScopes(context, ['skills:write']);
        const skillId = argument(input, 0, 'skill_id');
        const bundle = await bundleCall(input, argument(input, 1, 'folder'));
        await writeSkill(context, input, {
            call: { skillId, ...bundle.call },
            done: (value) => authoredMessage('Updated', value),
            shown: { skillId, ...bundle.shown },
            title: `Update the Skill ${skillId}`,
            tool: 'dexto_skill_update',
        });
    },
};

const remove: Command = {
    arguments: '<skill>',
    examples: ['dexto skills delete my-skill --yes --json'],
    options: WRITE_OPTIONS,
    path: ['skills', 'delete'],
    summary: 'Delete one of your own Skills, by its id or slug.',
    async run(context, input) {
        await requireLoginScopes(context, ['skills:write']);
        const skill = argument(input, 0, 'skill');
        await writeSkill(context, input, {
            call: librarySkill(skill),
            done: () => `Deleted the Skill ${skill}.`,
            title: `Delete the Skill ${skill}`,
            tool: 'dexto_skill_delete',
        });
    },
};

const install: Command = {
    arguments: '<skill>',
    examples: [
        'dexto skills install @publisher/name --yes --json',
        'dexto skills install my-skill --yes --json',
    ],
    options: { ...LISTING_OPTION, ...WRITE_OPTIONS },
    path: ['skills', 'install'],
    summary:
        'Install a Skill for your agents: a Store listing as @publisher/name (or by id with --listing), added to your library, or a Skill in your library by its id or slug.',
    async run(context, input) {
        await requireLoginScopes(context, ['skills:write']);
        const skill = argument(input, 0, 'skill');
        await writeSkill(context, input, {
            call: storeListing(input, skill) ?? librarySkill(skill),
            done: () => `Installed the Skill ${skill}.`,
            title: `Install the Skill ${skill}`,
            tool: 'dexto_skill_install',
        });
    },
};

const uninstall: Command = {
    arguments: '<skill>',
    examples: ['dexto skills uninstall my-skill --yes --json'],
    options: WRITE_OPTIONS,
    path: ['skills', 'uninstall'],
    summary:
        'Uninstall a library Skill, by its id or slug, so your agents stop using it. It stays in your library.',
    async run(context, input) {
        await requireLoginScopes(context, ['skills:write']);
        const skill = argument(input, 0, 'skill');
        await writeSkill(context, input, {
            call: librarySkill(skill),
            done: () => `Uninstalled the Skill ${skill}.`,
            title: `Uninstall the Skill ${skill}`,
            tool: 'dexto_skill_uninstall',
        });
    },
};

const versions: Command = {
    arguments: '<skill_id>',
    examples: ['dexto skills versions "$SKILL_ID" --json'],
    path: ['skills', 'versions'],
    summary: "List a Skill's saved versions, newest first: the first is the one in use.",
    async run(context, input) {
        await requireLoginScopes(context, ['skills:read']);
        const listed = VersionsSchema.parse(
            await queryWorkspaceTool(context, 'dexto_skill_versions', {
                skillId: argument(input, 0, 'skill_id'),
            })
        );
        context.output.list({ data: listed.versions }, VERSION_COLUMNS);
    },
};

const restore: Command = {
    arguments: '<skill_id> <version_id>',
    examples: ['dexto skills restore "$SKILL_ID" "$VERSION_ID" --yes --json'],
    options: WRITE_OPTIONS,
    path: ['skills', 'restore'],
    summary:
        'Put an old version of a Skill back: its files are saved again as the newest version, and every version stays in the history.',
    async run(context, input) {
        await requireLoginScopes(context, ['skills:write']);
        const skillId = argument(input, 0, 'skill_id');
        const versionId = argument(input, 1, 'version_id');
        await writeSkill(context, input, {
            call: { skillId, versionId },
            done: () => `Restored version ${versionId} of the Skill ${skillId}.`,
            title: `Restore version ${versionId} of the Skill ${skillId}`,
            tool: 'dexto_skill_restore',
        });
    },
};

const publish: Command = {
    arguments: '<skill_id>',
    examples: [
        'dexto skills publish "$SKILL_ID" --summary "Writes in our brand voice." --category writing --yes --json',
    ],
    options: {
        category: { description: `The Store category: ${CATEGORIES.join(', ')}.`, type: 'string' },
        description: {
            description: "The listing's longer description, in markdown.",
            type: 'string',
        },
        homepage: { description: "An https link to the Skill's own site.", type: 'string' },
        keyword: {
            description: 'A search word, lowercase; repeat for up to eight.',
            multiple: true,
            type: 'string',
        },
        license: {
            description: 'An SPDX license id, such as MIT, or proprietary.',
            type: 'string',
        },
        release: {
            description: "The release to publish, by id (default: the Skill's latest).",
            type: 'string',
            valueName: 'ID',
        },
        repository: {
            description: "An https link to the Skill's source repository.",
            type: 'string',
        },
        summary: { description: 'One line saying what the Skill does.', type: 'string' },
        title: {
            description: "The listing's name (default: the Skill's title).",
            type: 'string',
        },
        ...WRITE_OPTIONS,
    },
    path: ['skills', 'publish'],
    summary: 'Publish a release of one of your own Skills to the Dexto Store.',
    async run(context, input) {
        const summary = requiredOption(input, 'summary');
        const category = choiceOption(input, 'category', CATEGORIES);
        const skillId = argument(input, 0, 'skill_id');
        let releaseId = stringOption(input, 'release');
        let title = stringOption(input, 'title');
        if (releaseId === undefined || title === undefined) {
            await requireLoginScopes(context, ['skills:read', 'skills:write']);
            const skill = SkillSchema.parse(
                await queryWorkspaceTool(context, 'dexto_skill_get', {
                    location: { kind: 'library', skillId },
                })
            );
            releaseId ??= skill.release.id;
            title ??= skill.title;
        } else await requireLoginScopes(context, ['skills:write']);
        const keywords = listOption(input, 'keyword');
        // Flags left out stay undefined, which the JSON call leaves out: the listing keeps them.
        await writeSkill(context, input, {
            call: {
                category,
                description: stringOption(input, 'description'),
                homepageUrl: stringOption(input, 'homepage'),
                keywords: keywords.length === 0 ? undefined : keywords,
                license: stringOption(input, 'license'),
                releaseId,
                repositoryUrl: stringOption(input, 'repository'),
                skillId,
                summary,
                title,
            },
            done: () => `Published ${title} to the Store.`,
            title: `Publish the Skill ${skillId} to the Store`,
            tool: 'dexto_skill_publish',
        });
    },
};

/** A Store listing named by @publisher/name, or by its id with --listing; else null. */
function storeListing(
    input: CommandInput,
    skill: string
): { name: string } | { listingId: string } | null {
    if (skill.startsWith('@')) return { name: skill };
    if (flag(input, 'listing')) return { listingId: skill };
    return null;
}

/** Where `dexto_skill_get` and `dexto_skill_file_get` find a Skill: the Store, or the library by id. */
function skillLocation(input: CommandInput, skill: string) {
    const listing = storeListing(input, skill);
    return listing === null
        ? ({ kind: 'library', skillId: skill } as const)
        : ({ kind: 'marketplace', ...listing } as const);
}

/** A library Skill by its id, or else by its slug. */
function librarySkill(skill: string): { skillId: string } | { slug: string } {
    return UUID.test(skill) ? { skillId: skill } : { slug: skill };
}

function authoredMessage(verb: string, value: unknown): string {
    const { skill } = AuthoredSchema.parse(value);
    return `${verb} ${skill.title} (${skill.slug}): skill ${skill.id}.`;
}

/**
 * A folder as the Skill tools take a complete bundle: every file as UTF-8 text, with the role
 * Dexto gives it by where it sits (as a pushed bundle's files get). `shown` is the call with each
 * file by its size instead of its text, for a dry run.
 */
async function bundleCall(input: CommandInput, folder: string) {
    const { description, files: read, slug, title } = await readSkillBundle(input, folder);
    const decoder = new globalThis.TextDecoder('utf-8', { fatal: true });
    const files = read.map((each) => {
        let content: string;
        try {
            content = decoder.decode(each.bytes);
        } catch {
            throw new UsageError(
                `${each.path} is not UTF-8 text. Use dexto skills push for a folder with other files.`
            );
        }
        return {
            content,
            ...(each.executable ? { executable: true } : {}),
            path: each.path,
            role: fileRole(each.path),
        };
    });
    return {
        call: { description, files, slug, title },
        shown: {
            description,
            files: files.map(({ content, ...each }) => ({
                ...each,
                bytes: Buffer.byteLength(content, 'utf8'),
            })),
            slug,
            title,
        },
    };
}

function fileRole(file: string): 'asset' | 'config' | 'instructions' | 'reference' | 'script' {
    if (file === 'SKILL.md') return 'instructions';
    if (file.startsWith('references/')) return 'reference';
    if (file.startsWith('scripts/')) return 'script';
    if (file.startsWith('assets/')) return 'asset';
    return 'config';
}

/**
 * Makes a Skill change once agreed and prints `done` of its result, or with --dry-run shows the
 * call (as `shown`, when that differs from it) without making it.
 */
async function writeSkill(
    context: CommandContext,
    input: CommandInput,
    write: {
        call: Record<string, unknown>;
        done: (value: unknown) => string;
        shown?: Record<string, unknown>;
        title: string;
        tool: string;
    }
): Promise<void> {
    const { call, tool: name } = write;
    const tool = (await listWorkspaceTools(context)).find((each) => each.name === name);
    if (tool === undefined)
        throw new CommandFailure('failed', `This Dexto has no ${name} tool.`, null);
    if (flag(input, 'dry-run')) {
        const shown = write.shown ?? call;
        return context.output.result(
            { dryRun: true, tool: name, arguments: shown },
            `Would call ${name} with ${JSON.stringify(shown)}.`
        );
    }
    const agreed = await agreeToCall(
        context,
        { level: toolCallLevel(tool, call), schema: tool.inputSchema, title: write.title },
        flag(input, 'yes')
    );
    const value = await queryWorkspaceTool(context, name, { ...call, ...agreed });
    context.output.result(value, write.done(value));
}

export const skillLibraryCommands: readonly Command[] = [
    get,
    file,
    validate,
    create,
    update,
    remove,
    install,
    uninstall,
    versions,
    restore,
    publish,
];
