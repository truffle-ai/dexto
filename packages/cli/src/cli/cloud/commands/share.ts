// `workspace share`: manage who can open something you own, and see what others shared with you.

import { z } from 'zod';

import { CommandFailure } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import {
    argument,
    choiceOption,
    flag,
    listOption,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
    type OptionSpec,
} from '../command.js';
import { callWorkspaceTool, queryWorkspaceTool } from './workspace.js';

/** The kinds of thing Sharing names, as the Dexto MCP takes them. */
const KINDS = ['app', 'drive', 'skill', 'project', 'loop', 'chat', 'site'] as const;
type Kind = (typeof KINDS)[number];

const KIND_HELP = 'app, drive, skill, project, loop, chat or site';

const targetOptions = {
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
} as const satisfies Record<string, OptionSpec>;

const writeOptions = {
    ...targetOptions,
    'dry-run': { description: 'Show the call without making it.', type: 'boolean' },
    ...YES_OPTION,
} as const satisfies Record<string, OptionSpec>;

const grantOptions = {
    ...writeOptions,
    role: {
        description: 'Access role: viewer (default) or editor where supported.',
        type: 'string',
        valueName: 'ROLE',
    },
    'no-notify': { description: 'Do not send Dexto notifications.', type: 'boolean' },
} as const satisfies Record<string, OptionSpec>;

type ShareTarget = ReturnType<typeof targetOf>;
type GrantFields = ReturnType<typeof grantFields>;
type ShareCall =
    | ({ action: 'organization' } & ShareTarget & GrantFields)
    | ({ action: 'people'; userIds: string[] } & ShareTarget & GrantFields)
    | ({ action: 'unshare_organization' } & ShareTarget)
    | ({ action: 'unshare_person'; userId: string } & ShareTarget);

async function shareCall(
    context: CommandContext,
    input: CommandInput,
    call: ShareCall,
    description: string
) {
    if (flag(input, 'dry-run')) {
        context.output.result(
            { dryRun: true, tool: 'dexto_share', arguments: call },
            `Would call dexto_share with ${JSON.stringify(call)}.`
        );
        return;
    }
    await requireConsent(
        context,
        flag(input, 'yes'),
        `${description} Details: ${JSON.stringify(call)}.`
    );
    return await callWorkspaceTool(context, 'dexto_share', {
        ...call,
        ...(call.action === 'organization' || call.action === 'people' ? { confirm: true } : {}),
    });
}

function targetOf(input: CommandInput) {
    const kind = kindOf(argument(input, 0, 'kind'));
    const id = argument(input, 1, 'id');
    const app = stringOption(input, 'app');
    const collection = stringOption(input, 'collection');
    return {
        kind,
        id,
        ...(app === undefined ? {} : { app }),
        ...(collection === undefined ? {} : { collection }),
    };
}

function grantFields(input: CommandInput) {
    const role = choiceOption(input, 'role', ['viewer', 'editor']);
    return {
        ...(role === undefined ? {} : { role }),
        ...(flag(input, 'no-notify') ? { notify: false } : {}),
    };
}

const organization: Command = {
    path: ['workspace', 'share', 'organization'],
    arguments: '<kind> <id>',
    summary: `Share something you own with your organization. Kind is ${KIND_HELP}.`,
    examples: [
        'dexto workspace share organization project "$PROJECT_ID" --role editor --yes --json',
    ],
    jsonOutput: outputSchema(
        z.object({ created: z.boolean(), organizationId: z.string(), title: z.string() })
    ),
    options: grantOptions,
    async run(context, input) {
        const target = targetOf(input);
        const grant = grantFields(input);
        return await shareCall(
            context,
            input,
            { action: 'organization', ...target, ...grant },
            `Share ${target.kind} ${target.id} with your organization as ${grant.role ?? 'viewer'}.`
        );
    },
};

const people: Command = {
    path: ['workspace', 'share', 'people'],
    arguments: '<kind> <id>',
    summary: `Share something you own with people in its organization. Kind is ${KIND_HELP}. Chat editors can send messages using your organization's credits, counted as your usage.`,
    examples: ['dexto workspace share people drive "$FILE_ID" --user-id "$USER_ID" --yes --json'],
    jsonOutput: outputSchema(z.object({ added: z.array(z.string()), title: z.string() })),
    options: {
        ...grantOptions,
        'user-id': {
            description: 'A recipient user id; repeat for each person.',
            type: 'string',
            multiple: true,
            valueName: 'USER_ID',
        },
    },
    async run(context, input) {
        const target = targetOf(input);
        const grant = grantFields(input);
        const userIds = listOption(input, 'user-id');
        if (userIds.length === 0) throw new UsageError('Pass at least one --user-id.');
        return await shareCall(
            context,
            input,
            { action: 'people', ...target, userIds, ...grant },
            `Share ${target.kind} ${target.id} with ${userIds.join(', ')} as ${grant.role ?? 'viewer'}.${target.kind === 'chat' && grant.role === 'editor' ? " They can send messages using your organization's credits, counted as your usage." : ''}`
        );
    },
};

const unshareOrganization: Command = {
    path: ['workspace', 'share', 'unshare-organization'],
    arguments: '<kind> <id>',
    summary: 'Stop sharing with the organization and turn off its public link.',
    examples: ['dexto workspace share unshare-organization drive "$FILE_ID" --yes --json'],
    jsonOutput: outputSchema(z.object({ organizationId: z.string() })),
    options: writeOptions,
    async run(context, input) {
        const target = targetOf(input);
        return await shareCall(
            context,
            input,
            { action: 'unshare_organization', ...target },
            `Stop sharing ${target.kind} ${target.id} with its organization and turn off its public link.`
        );
    },
};

const unsharePerson: Command = {
    path: ['workspace', 'share', 'unshare-person'],
    arguments: '<kind> <id> <user_id>',
    summary: 'Take one person’s access away.',
    examples: ['dexto workspace share unshare-person drive "$FILE_ID" "$USER_ID" --yes --json'],
    jsonOutput: outputSchema(z.object({ userId: z.string() })),
    options: writeOptions,
    async run(context, input) {
        const target = targetOf(input);
        const userId = argument(input, 2, 'user_id');
        return await shareCall(
            context,
            input,
            { action: 'unshare_person', ...target, userId },
            `Stop sharing ${target.kind} ${target.id} with ${userId}.`
        );
    },
};

function outputSchema(result: z.ZodObject) {
    const dryRun = z.object({
        dryRun: z.literal(true),
        tool: z.literal('dexto_share'),
        arguments: z.record(z.string(), z.unknown()),
    });
    return {
        description: 'The sharing operation result, or the call shown by --dry-run.',
        schema: z.toJSONSchema(z.union([result, dryRun])),
    };
}

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
    options: targetOptions,
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

export const shareCommands: readonly Command[] = [
    access,
    received,
    organization,
    people,
    unshareOrganization,
    unsharePerson,
];
