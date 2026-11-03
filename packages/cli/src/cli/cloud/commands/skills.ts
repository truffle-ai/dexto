// `skills push`: packs a local Skill folder and creates or updates it in the person's library.

import path from 'node:path';

import { z } from 'zod';

import {
    argument,
    flag,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
} from '../command.js';
import { tarArchive } from '../tar.js';
import { readSkillFolder, skillHeader, titleFromSlug, SLUG } from '../skill-bundle.js';
import { uploadSkillBundle } from './skill-transport.js';
import { formatBytes } from './files.js';
import { agreeToCall, listWorkspaceTools, queryWorkspaceTool, toolCallLevel } from './workspace.js';

const SearchSchema = z.object({
    skills: z.array(
        z.object({
            slug: z.string(),
            source: z.string(),
            visibility: z.enum(['organization', 'private', 'shared']).nullable().default(null),
        })
    ),
});
const ImportedSchema = z.object({
    location: z.object({ skillId: z.string() }),
    slug: z.string(),
    title: z.string(),
});

const push: Command = {
    arguments: '<folder>',
    options: {
        description: {
            description: "What the Skill does (default: description in SKILL.md's header).",
            type: 'string',
        },
        slug: {
            description:
                "The Skill's slug (default: slug or name in SKILL.md's header, else the folder's name).",
            type: 'string',
        },
        title: {
            description:
                "The Skill's title (default: title in SKILL.md's header, else from the slug).",
            type: 'string',
        },
        update: {
            description:
                'Update your Skill with this slug (default: update it if you have one, else create it).',
            type: 'boolean',
        },
        ...YES_OPTION,
    },
    path: ['skills', 'push'],
    summary:
        'Pack a local Skill folder (SKILL.md at its root, dotfiles left out) and create or update it in your library.',
    async run(context, input) {
        const folder = argument(input, 0, 'folder');
        const files = await readSkillFolder(folder);
        const header = skillHeader(new globalThis.TextDecoder().decode(files[0]?.bytes));
        const named = header.name !== undefined && SLUG.test(header.name) ? header.name : null;
        const slug =
            stringOption(input, 'slug') ??
            header.slug ??
            named ??
            path.basename(path.resolve(folder));
        if (!SLUG.test(slug))
            throw new UsageError(
                `${slug} can't be a Skill's slug: use up to 80 lowercase letters, digits, dots, dashes and underscores. Pass --slug.`
            );
        const title =
            stringOption(input, 'title') ??
            header.title ??
            (named === null ? header.name : undefined) ??
            titleFromSlug(slug);
        const description = stringOption(input, 'description') ?? header.description;
        if (description === undefined)
            throw new UsageError(
                "SKILL.md's header has no description. Add one there, or pass --description."
            );

        const mode =
            flag(input, 'update') || (await ownsSkill(context, slug)) ? 'update' : 'create';
        const metadata = { description, mode, slug, title };
        // Ask before anything is sent: the import is what changes the library.
        const tool = (await listWorkspaceTools(context)).find(
            (each) => each.name === 'dexto_skill_bundle_import'
        );
        const agreed =
            tool === undefined
                ? {}
                : await agreeToCall(
                      context,
                      {
                          level: toolCallLevel(tool, metadata),
                          schema: tool.inputSchema,
                          title: `${mode === 'create' ? 'Create' : 'Update'} the Skill ${slug}`,
                      },
                      flag(input, 'yes')
                  );

        const archive = tarArchive(files);
        const imported = await uploadSkillBundle(context, archive, { ...metadata, ...agreed });
        const shown = ImportedSchema.safeParse(imported);
        context.output.result(
            imported,
            shown.success
                ? `${mode === 'create' ? 'Created' : 'Updated'} ${shown.data.title} (${shown.data.slug}, ${files.length} file${files.length === 1 ? '' : 's'}, ${formatBytes(archive.length)}): skill ${shown.data.location.skillId}.`
                : JSON.stringify(imported, null, 2)
        );
    },
};

/**
 * Whether the person has a Skill with this slug they can save over: their own, or their
 * organization's. One someone shared with them is theirs to copy, so a push makes the person's own.
 */
async function ownsSkill(context: CommandContext, slug: string): Promise<boolean> {
    const found = SearchSchema.safeParse(
        await queryWorkspaceTool(context, 'dexto_skills_search', {
            limit: 50,
            query: slug,
            source: 'library',
        })
    );
    return (
        found.success &&
        found.data.skills.some(
            (skill) =>
                skill.slug === slug &&
                skill.source === 'user' &&
                (skill.visibility === 'private' || skill.visibility === 'organization')
        )
    );
}

export const skillCommands: readonly Command[] = [push];
