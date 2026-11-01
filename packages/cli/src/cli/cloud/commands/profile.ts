// `profile`: read and change your own Dexto profile, as Settings → Profile does.

import { z } from 'zod';

import {
    CommandFailure,
    stringOption,
    UsageError,
    type Command,
    type CommandContext,
} from '../command.js';
import { queryWorkspaceTool } from './workspace.js';

const ProfileSchema = z.object({
    bio: z.string().nullable(),
    displayName: z.string(),
    handle: z.string(),
    links: z.array(z.unknown()),
    showTokenUsage: z.boolean(),
    visibility: z.enum(['private', 'public']),
    workEntries: z.array(z.unknown()),
});

type Profile = z.output<typeof ProfileSchema>;

const get: Command = {
    path: ['profile', 'get'],
    summary: 'Show your Dexto profile: handle, name, bio, links, work and whether it is public.',
    async run(context) {
        const profile = await readProfile(context, 'dexto_profile_get', {});
        context.output.result({ profile }, describeProfile(profile));
    },
};

const update: Command = {
    options: {
        bio: {
            description: 'Your bio; "" clears it.',
            type: 'string',
            valueName: 'TEXT',
        },
        'display-name': { description: 'Your display name.', type: 'string', valueName: 'NAME' },
        handle: {
            description:
                'Your handle, unique across Dexto: 3 to 30 lowercase letters, digits and hyphens.',
            type: 'string',
            valueName: 'HANDLE',
        },
        links: {
            description:
                'Your links, replacing them all, as JSON: [{"kind":"github","url":"https://…"}] or {"kind":"custom","label":"…","url":"…"} entries.',
            type: 'string',
            valueName: 'JSON',
        },
        'token-usage': {
            description: 'Whether your profile shows your token usage: show or hide.',
            type: 'string',
            valueName: 'show|hide',
        },
        visibility: {
            description: 'private, or public for anyone with the link.',
            type: 'string',
            valueName: 'private|public',
        },
        work: {
            description:
                'Your work entries, replacing them all, as JSON: {"kind":"site","siteId":"…"} or {"kind":"external","title":"…","url":"…","description":null,"imageUrl":null} entries.',
            type: 'string',
            valueName: 'JSON',
        },
    },
    path: ['profile', 'update'],
    summary:
        'Change your Dexto profile: only the fields you pass change, such as --handle shaun --visibility public.',
    async run(context, input) {
        const changes = profileChanges(input);
        if (Object.keys(changes).length === 0)
            throw new UsageError(
                'Pass at least one field to change, such as --handle or --visibility.'
            );
        const profile = await readProfile(context, 'dexto_profile_update', changes);
        context.output.result({ profile }, `Updated.\n${describeProfile(profile)}`);
    },
};

/** What `profile update` asks to change, in `dexto_profile_update`'s fields. */
function profileChanges(input: Parameters<Command['run']>[1]): Record<string, unknown> {
    const visibility = stringOption(input, 'visibility');
    if (visibility !== undefined && visibility !== 'private' && visibility !== 'public')
        throw new UsageError('--visibility must be private or public.');
    const tokenUsage = stringOption(input, 'token-usage');
    if (tokenUsage !== undefined && tokenUsage !== 'show' && tokenUsage !== 'hide')
        throw new UsageError('--token-usage must be show or hide.');
    const bio = stringOption(input, 'bio');
    const displayName = stringOption(input, 'display-name');
    const handle = stringOption(input, 'handle');
    const links = jsonListOption(input, 'links');
    const work = jsonListOption(input, 'work');
    return {
        ...(bio === undefined ? {} : { bio: bio.trim().length === 0 ? null : bio }),
        ...(displayName === undefined ? {} : { displayName }),
        ...(handle === undefined ? {} : { handle }),
        ...(links === undefined ? {} : { links }),
        ...(tokenUsage === undefined ? {} : { showTokenUsage: tokenUsage === 'show' }),
        ...(visibility === undefined ? {} : { visibility }),
        ...(work === undefined ? {} : { workEntries: work }),
    };
}

/** A JSON list option: every link or work entry at once, replacing what is there. */
function jsonListOption(input: Parameters<Command['run']>[1], name: string): unknown[] | undefined {
    const value = stringOption(input, name);
    if (value === undefined) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new UsageError(`--${name} must be a JSON list.`);
    }
    if (!Array.isArray(parsed)) throw new UsageError(`--${name} must be a JSON list.`);
    return parsed;
}

async function readProfile(
    context: CommandContext,
    tool: 'dexto_profile_get' | 'dexto_profile_update',
    input: Record<string, unknown>
): Promise<Profile> {
    const value = await queryWorkspaceTool(context, tool, input);
    const parsed = z.object({ profile: ProfileSchema }).safeParse(value);
    if (!parsed.success)
        throw new CommandFailure('failed', "Dexto didn't return your profile.", null);
    return parsed.data.profile;
}

function describeProfile(profile: Profile): string {
    return [
        `@${profile.handle} (${profile.displayName}), ${profile.visibility}`,
        ...(profile.bio === null ? [] : [profile.bio]),
        `${profile.links.length} links, ${profile.workEntries.length} work entries, token usage ${profile.showTokenUsage ? 'shown' : 'hidden'}`,
    ].join('\n');
}

export const profileCommands: readonly Command[] = [get, update];
