// `workspace share`: read who can open something you own and what others shared with you, and
// turn a Drive file's public link on or off.

import { z } from 'zod';

import { CommandFailure } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import {
    argument,
    DRY_RUN_OPTION,
    flag,
    showDryRun,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

/** The kinds of thing Sharing names, as the Dexto MCP takes them. */
const KINDS = ['app', 'drive', 'skill', 'project', 'loop', 'chat', 'site'] as const;
type Kind = (typeof KINDS)[number];

const KIND_HELP = 'app, drive, skill, project, loop, chat or site';

function kindOf(value: string): Kind {
    const kind = KINDS.find((each) => each === value);
    if (kind === undefined) throw new UsageError(`The kind must be ${KIND_HELP}.`);
    return kind;
}

const AccessSchema = z
    .object({
        access: z.string(),
        organization: z.object({ role: z.string() }).passthrough().nullable(),
        people: z.array(
            z.object({ email: z.string(), name: z.string(), role: z.string() }).passthrough()
        ),
        public: z.object({ kind: z.string(), url: z.string().optional() }).passthrough().nullable(),
        title: z.string(),
    })
    .passthrough();

const ReceivedItemSchema = z
    .object({
        target: z.object({ kind: z.string() }).passthrough(),
        title: z.string(),
        url: z.string(),
        owner: z.object({ displayName: z.string(), handle: z.string().nullable() }).passthrough(),
    })
    .passthrough();

const ReceivedSchema = z
    .object({
        invitations: z.array(ReceivedItemSchema),
        shared: z.array(ReceivedItemSchema.extend({ via: z.string() })),
    })
    .passthrough();

function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const result = schema.safeParse(value);
    if (!result.success)
        throw new CommandFailure('failed', `Dexto didn't return a valid ${what}.`, null);
    return result.data;
}

const access: Command = {
    path: ['workspace', 'share', 'access'],
    arguments: '<kind> <id>',
    summary: `Show who can open something you own: its organization, people, public link and access level. Kind is ${KIND_HELP}.`,
    examples: [
        'dexto workspace share access drive FILE_ID --json',
        'dexto workspace share access app ARTIFACT_ID --app artifacts --collection artifacts',
    ],
    options: {
        app: {
            description: "For kind app: the App's id, such as artifacts.",
            type: 'string',
            valueName: 'APP',
        },
        collection: {
            description: "For kind app: the record's collection, such as artifacts.",
            type: 'string',
            valueName: 'COLLECTION',
        },
    },
    async run(context, input) {
        const kind = kindOf(argument(input, 0, 'kind'));
        const id = argument(input, 1, 'id');
        const app = stringOption(input, 'app');
        const collection = stringOption(input, 'collection');
        const result = parsed(
            AccessSchema,
            await queryWorkspaceTool(context, 'dexto_share_access', {
                kind,
                id,
                ...(app === undefined ? {} : { app }),
                ...(collection === undefined ? {} : { collection }),
            }),
            'sharing answer'
        );
        context.output.result(result, describeAccess(result));
    },
};

function describeAccess(result: z.output<typeof AccessSchema>): string {
    return [
        `${result.title}: ${result.access}`,
        ...(result.organization === null ? [] : [`Organization: ${result.organization.role}`]),
        ...result.people.map((person) => `${person.name} <${person.email}> ${person.role}`),
        ...(result.public === null
            ? []
            : [
                  result.public.url === undefined
                      ? `Public: ${result.public.kind}`
                      : `Public link: ${result.public.url}`,
              ]),
    ].join('\n');
}

const received: Command = {
    path: ['workspace', 'share', 'received'],
    summary:
        'List what others shared with you or your organization, newest first, and invitations you have not answered. Only the kinds your sign-in may read.',
    examples: [
        'dexto workspace share received --json',
        'dexto workspace share received --kind drive',
    ],
    options: {
        kind: {
            description: `Only this kind: ${KIND_HELP}.`,
            type: 'string',
            valueName: 'KIND',
        },
    },
    async run(context, input) {
        const kind = stringOption(input, 'kind');
        const result = parsed(
            ReceivedSchema,
            await queryWorkspaceTool(
                context,
                'dexto_share_received',
                kind === undefined ? {} : { kind: kindOf(kind) }
            ),
            'list of shared things'
        );
        context.output.result(result, describeReceived(result));
    },
};

function receivedLine(item: z.output<typeof ReceivedItemSchema>, via: string | null): string {
    const owner =
        item.owner.handle === null
            ? item.owner.displayName
            : `${item.owner.displayName} (@${item.owner.handle})`;
    return [item.target.kind, item.title, owner, ...(via === null ? [] : [via]), item.url].join(
        '  '
    );
}

function describeReceived(result: z.output<typeof ReceivedSchema>): string {
    if (result.shared.length === 0 && result.invitations.length === 0)
        return 'Nothing is shared with you.';
    return [
        ...result.shared.map((item) => receivedLine(item, item.via)),
        ...(result.invitations.length === 0
            ? []
            : ['', 'Invitations:', ...result.invitations.map((item) => receivedLine(item, null))]),
    ].join('\n');
}

const PublicLinkSchema = z
    .object({
        created: z.boolean(),
        title: z.string(),
        url: z.string(),
        downloadUrl: z.string().optional(),
        downloadCommand: z.string().optional(),
    })
    .passthrough();

const UnsharedSchema = z.object({ unshared: z.object({ title: z.string() }).passthrough() });

const makePublic: Command = {
    path: ['workspace', 'share', 'public'],
    arguments: '<file_id>',
    summary:
        'Turn on a public link for a Drive file you own: anyone with it can open the file signed out, and download it with the returned curl command. Turning it on again gives the same link. Always asks first. Requires drive:write.',
    examples: [
        'dexto workspace share public FILE_ID --yes --json',
        'dexto workspace share public FILE_ID --dry-run',
    ],
    jsonOutput: {
        description:
            'The link: created (false when it was already on), title, url, and for a file downloadUrl and downloadCommand.',
        schema: z.toJSONSchema(PublicLinkSchema),
    },
    options: { ...DRY_RUN_OPTION, ...YES_OPTION },
    async run(context, input) {
        const call = { action: 'public', kind: 'drive', id: argument(input, 0, 'file_id') };
        if (flag(input, 'dry-run')) return showDryRun(context, 'dexto_share', call);
        await requireLoginScopes(context, ['drive:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Turn on a public link for Drive file ${call.id}? Anyone with the link can open and download it without signing in, and everyone in your organization can open it.`
        );
        const link = parsed(
            PublicLinkSchema,
            await queryWorkspaceTool(context, 'dexto_share', { ...call, confirm: true }),
            'public link'
        );
        context.output.result(
            link,
            [
                `Public link for ${link.title}: ${link.url}`,
                ...(link.downloadCommand === undefined
                    ? []
                    : [`Download: ${link.downloadCommand}`]),
            ].join('\n')
        );
    },
};

const unsharePublic: Command = {
    path: ['workspace', 'share', 'unshare-public'],
    arguments: '<file_id>',
    summary:
        "Turn off a Drive file's public link and its download, so the link stops working. Everyone in your organization keeps access. Requires drive:write.",
    examples: ['dexto workspace share unshare-public FILE_ID --json'],
    jsonOutput: {
        description: 'The file whose link was turned off.',
        schema: z.toJSONSchema(UnsharedSchema),
    },
    options: DRY_RUN_OPTION,
    async run(context, input) {
        const call = { action: 'unshare_public', kind: 'drive', id: argument(input, 0, 'file_id') };
        if (flag(input, 'dry-run')) return showDryRun(context, 'dexto_share', call);
        await requireLoginScopes(context, ['drive:write']);
        const result = parsed(
            UnsharedSchema,
            await queryWorkspaceTool(context, 'dexto_share', call),
            'answer'
        );
        context.output.result(result, `The public link for ${result.unshared.title} is off.`);
    },
};

export const shareCommands: readonly Command[] = [access, received, makePublic, unsharePublic];
