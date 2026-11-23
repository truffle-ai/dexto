// `skills push` packs a local Skill folder into the person's library; `skills sync` copies the
// library to this computer, where local skill discovery finds it. The other `skills` verbs are in
// skill-library.ts.

import { CommandFailure } from '../../failure.js';

import { getStandaloneSkillPaths } from '@dexto/agent-management';
import { createCloudClient } from '@dexto/cloud-client';
import { z } from 'zod';

import { argument, flag, YES_OPTION, type Command, type CommandContext } from '../command.js';
import { readSkillBundle, SKILL_BUNDLE_OPTIONS } from '../skill-bundle.js';
import { syncCloudSkills } from '../skills-sync.js';
import { tarArchive } from '../tar.js';
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
        ...SKILL_BUNDLE_OPTIONS,
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
        const { description, files, slug, title } = await readSkillBundle(
            input,
            argument(input, 0, 'folder')
        );
        const mode =
            flag(input, 'update') || (await ownsSkill(context, slug)) ? 'update' : 'create';
        const metadata = { description, mode, slug, title } satisfies {
            description: string;
            mode: 'create' | 'update';
            slug: string;
            title: string;
        };
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

const sync: Command = {
    path: ['skills', 'sync'],
    summary:
        'Copy your Dexto Skills library to this computer, where agents find it after your local Skills',
    async run(context) {
        const connection = await context.connection();
        if (connection.kind !== 'oauth')
            throw new CommandFailure(
                'needs_sign_in',
                'Skills belong to a person, and a developer key acts for a Cloud project.',
                'dexto login'
            );
        const directory = getStandaloneSkillPaths().cloud;
        const synced = await syncCloudSkills({
            client: createCloudClient({
                apiBaseUrl: connection.apiBaseUrl,
                // The library is the person's, in no Cloud project.
                cloudProject: null,
                fetch: context.runtime.fetch,
                token: connection.token,
            }),
            directory,
        });
        context.output.result(
            { directory, ...synced },
            `Synced your Skills to ${directory}: ${synced.downloaded.length} downloaded, ${synced.removed.length} removed.`
        );
    },
};

export const skillCommands: readonly Command[] = [push, sync];
