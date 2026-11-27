// `workspace contacts`: the person's Dexto Contacts, over Dexto's typed Contacts tools.

import { CommandFailure } from '../../failure.js';

import { z } from 'zod';

import {
    argument,
    flag,
    requiredOption,
    stringOption,
    YES_OPTION,
    type Command,
    type CommandContext,
} from '../command.js';
import type { Column } from '../output.js';
import { requireLoginScopes } from './deploys.js';
import { agreeToCall, listWorkspaceTools, queryWorkspaceTool, toolCallLevel } from './workspace.js';

const PersonSchema = z.object({
    contactId: z.string(),
    handle: z.string(),
    name: z.string(),
    organization: z.string().nullable(),
    status: z.string(),
    userId: z.string(),
});
const FoundSchema = z.object({
    handle: z.string(),
    name: z.string(),
    organization: z.string().nullable(),
    organizationId: z.string(),
    userId: z.string(),
});
const RequestSchema = FoundSchema.extend({ contactId: z.string(), direction: z.string() });
const ChangedSchema = z.object({ contactId: z.string(), status: z.string() });

const handleOf = (row: { handle: string }) => `@${row.handle}`;

const PEOPLE_COLUMNS: readonly Column<z.output<typeof PersonSchema>>[] = [
    { header: 'contact', value: (person) => person.contactId },
    { header: 'handle', value: handleOf },
    { header: 'name', value: (person) => person.name },
    { header: 'organization', value: (person) => person.organization },
    { header: 'status', value: (person) => person.status },
];

const FOUND_COLUMNS: readonly Column<z.output<typeof FoundSchema>>[] = [
    { header: 'handle', value: handleOf },
    { header: 'name', value: (person) => person.name },
    { header: 'organization', value: (person) => person.organization },
    { header: 'user', value: (person) => person.userId },
    { header: 'organization id', value: (person) => person.organizationId },
];

const REQUEST_COLUMNS: readonly Column<z.output<typeof RequestSchema>>[] = [
    { header: 'contact', value: (request) => request.contactId },
    { header: 'direction', value: (request) => request.direction },
    { header: 'handle', value: handleOf },
    { header: 'name', value: (request) => request.name },
    { header: 'organization', value: (request) => request.organization },
];

const list: Command = {
    options: {
        blocked: { description: 'List the people you blocked instead.', type: 'boolean' },
        query: { description: 'Only people whose name or @handle has this text.', type: 'string' },
    },
    examples: ['dexto workspace contacts list --json'],
    path: ['workspace', 'contacts', 'list'],
    summary: 'List your Contacts in this organization, or with --blocked the people you blocked.',
    async run(context, input) {
        await requireLoginScopes(context, ['contacts:read']);
        const query = stringOption(input, 'query');
        const { people } = z.object({ people: z.array(PersonSchema) }).parse(
            await queryWorkspaceTool(context, 'dexto_contacts_people_list', {
                ...(query === undefined ? {} : { query }),
                ...(flag(input, 'blocked') ? { status: 'blocked' } : {}),
            })
        );
        context.output.list({ data: people }, PEOPLE_COLUMNS);
    },
};

const search: Command = {
    arguments: '<query>',
    examples: ['dexto workspace contacts search "Alex" --json'],
    path: ['workspace', 'contacts', 'search'],
    summary:
        'Find Dexto people not in your Contacts yet by name or @handle, with what contacts connect needs.',
    async run(context, input) {
        // Finding people reaches beyond saved Contacts, so Dexto asks for the write permission.
        await requireLoginScopes(context, ['contacts:write']);
        const { people } = z.object({ people: z.array(FoundSchema) }).parse(
            await queryWorkspaceTool(context, 'dexto_contacts_people_search', {
                query: argument(input, 0, 'query'),
            })
        );
        context.output.list({ data: people }, FOUND_COLUMNS);
    },
};

const requests: Command = {
    examples: ['dexto workspace contacts requests --json'],
    path: ['workspace', 'contacts', 'requests'],
    summary: 'List connection requests: incoming ones waiting for you, and ones you sent.',
    async run(context) {
        await requireLoginScopes(context, ['contacts:read']);
        const value = z
            .object({ requests: z.array(RequestSchema) })
            .parse(await queryWorkspaceTool(context, 'dexto_contacts_requests_list', {}));
        context.output.list({ data: value.requests }, REQUEST_COLUMNS);
    },
};

const inviteLink: Command = {
    examples: ['dexto workspace contacts invite-link --json'],
    path: ['workspace', 'contacts', 'invite-link'],
    summary: 'Show your invite link, for people not on Dexto yet.',
    async run(context) {
        await requireLoginScopes(context, ['contacts:read']);
        const value = await queryWorkspaceTool(context, 'dexto_contacts_invite_link', {});
        context.output.result(value, z.object({ url: z.string() }).parse(value).url);
    },
};

const connect: Command = {
    arguments: '<handle>',
    options: {
        organization: {
            description: 'The organization id to reach them in, from contacts search.',
            type: 'string',
            valueName: 'ID',
        },
        user: {
            description: 'Their user id, from contacts search.',
            type: 'string',
            valueName: 'ID',
        },
        ...YES_OPTION,
    },
    examples: [
        'dexto workspace contacts connect @alex --user "$USER_ID" --organization "$ORGANIZATION_ID" --yes --json',
    ],
    path: ['workspace', 'contacts', 'connect'],
    summary:
        'Ask someone from contacts search to connect, by handle, --user and --organization. Asks first.',
    async run(context, input) {
        const handle = argument(input, 0, 'handle');
        const call = {
            handle,
            organizationId: requiredOption(input, 'organization'),
            userId: requiredOption(input, 'user'),
        };
        const value = await changeContact(
            context,
            'dexto_contacts_connect',
            call,
            `Ask @${handle.replace(/^@/u, '')} to connect`,
            flag(input, 'yes')
        );
        const note = z.object({ note: z.string() }).parse(value).note;
        context.output.result(value, note);
    },
};

/** A command that changes one contact, by the contactId the list and requests commands show. */
function contactChange(
    word: string,
    tool: string,
    extra: Record<string, unknown>,
    summary: string,
    title: string
): Command {
    return {
        arguments: '<contact_id>',
        examples: [`dexto workspace contacts ${word} "$CONTACT_ID" --yes --json`],
        options: YES_OPTION,
        path: ['workspace', 'contacts', word],
        summary,
        async run(context, input) {
            const contactId = argument(input, 0, 'contact_id');
            const value = await changeContact(
                context,
                tool,
                { ...extra, contactId },
                `${title} ${contactId}`,
                flag(input, 'yes')
            );
            const changed = ChangedSchema.parse(value);
            context.output.result(value, `Contact ${changed.contactId} is now ${changed.status}.`);
        },
    };
}

/** Calls a Contacts tool that changes something, once the person agreed as its level asks. */
async function changeContact(
    context: CommandContext,
    name: string,
    call: Record<string, unknown>,
    title: string,
    yes: boolean
): Promise<unknown> {
    await requireLoginScopes(context, ['contacts:write']);
    const tool = (await listWorkspaceTools(context)).find((each) => each.name === name);
    if (tool === undefined)
        throw new CommandFailure('failed', "This Dexto can't manage Contacts yet.", null);
    const agreed = await agreeToCall(
        context,
        { level: toolCallLevel(tool, call), schema: tool.inputSchema, title },
        yes
    );
    return await queryWorkspaceTool(context, name, { ...call, ...agreed });
}

export const contactCommands: readonly Command[] = [
    list,
    search,
    requests,
    inviteLink,
    connect,
    contactChange(
        'accept',
        'dexto_contacts_request_answer',
        { answer: 'accept' },
        'Accept an incoming connection request. Asks first.',
        'Accept the connection request'
    ),
    contactChange(
        'decline',
        'dexto_contacts_request_answer',
        { answer: 'decline' },
        'Decline an incoming connection request. Asks first.',
        'Decline the connection request'
    ),
    contactChange(
        'remove',
        'dexto_contacts_remove',
        {},
        'Cancel a request you sent, or remove a connection. Asks first.',
        'Remove contact'
    ),
    contactChange(
        'block',
        'dexto_contacts_block',
        {},
        'Block someone by a connection or request with them; they are not told. Asks first.',
        'Block contact'
    ),
    contactChange(
        'unblock',
        'dexto_contacts_unblock',
        {},
        'Remove your block on someone; the earlier connection does not come back. Asks first.',
        'Unblock contact'
    ),
];
