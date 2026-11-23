// `computer url`: a link to a server on one of your Dexto computers, through `dexto_computer_port_link`.

import { z } from 'zod';

import { CommandFailure } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import {
    argument,
    boundedOption,
    flag,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandInput,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const TOOL = 'dexto_computer_port_link';

const LinkSchema = z
    .object({
        expiresAt: z.string().nullable(),
        port: z.number(),
        url: z.string(),
        visibility: z.enum(['organization', 'public']),
    })
    .passthrough();
type Link = z.output<typeof LinkSchema>;

const DRY_RUN_OPTION = {
    'dry-run': { description: 'Show the call without making it.', type: 'boolean' },
} as const;

function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const result = schema.safeParse(value);
    if (!result.success)
        throw new CommandFailure('failed', `Dexto didn't return a valid ${what}.`, null);
    return result.data;
}

/** The port at `index`: the bounds Cloud sets, checked before anything is sent. */
function port(input: CommandInput, index: number): number {
    const value = Number(argument(input, index, 'port'));
    if (!Number.isInteger(value) || value < 1 || value > 65_535)
        throw new UsageError('<port> must be a whole number from 1 to 65535.');
    return value;
}

function describeLink(link: Link): string {
    const who =
        link.visibility === 'public'
            ? 'Anyone with the link can open it'
            : 'Members of your organization open it after signing in';
    return `${link.url}\n${who}${link.expiresAt === null ? '' : `, until ${link.expiresAt}`}.`;
}

const share: Command = {
    path: ['computer', 'url'],
    arguments: '<computer_id> <port>',
    summary:
        'Share a server on one of your computers, such as a dev server on port 3000, as a link. Only your organization opens it unless you pass --public.',
    options: {
        public: {
            description:
                'Let anyone with the link open it, not only your organization. Lasts 24 hours unless --expires-in-hours says otherwise; refused while your organization has public links off.',
            type: 'boolean',
        },
        'expires-in-hours': {
            description: 'Close the link after this many hours, 1 to 720.',
            type: 'string',
            valueName: 'N',
        },
        ...DRY_RUN_OPTION,
        ...YES_OPTION,
    },
    examples: [
        'dexto computer url "$COMPUTER_ID" 3000 --yes --json',
        'dexto computer url "$COMPUTER_ID" 8080 --public --expires-in-hours 2 --yes --json',
        'dexto computer url "$COMPUTER_ID" 3000 --dry-run --json',
    ],
    async run(context, input) {
        const computerId = argument(input, 0, 'computer_id');
        const sharedPort = port(input, 1);
        const expiresInHours = boundedOption(input, 'expires-in-hours', 1, 720);
        const isPublic = flag(input, 'public');
        const call = {
            action: isPublic ? 'publish' : 'share',
            computerId,
            port: sharedPort,
            ...(expiresInHours === undefined ? {} : { expiresInHours }),
        };
        const shared = `port ${sharedPort} ${isPublic ? 'publicly' : 'with your organization'}`;
        if (flag(input, 'dry-run'))
            return context.output.result(
                { dryRun: true, tool: TOOL, arguments: call },
                `Would share ${shared}.`
            );
        await requireLoginScopes(context, ['computers:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            isPublic ? `Share ${shared}? Anyone with the link can open it.` : `Share ${shared}?`
        );
        const link = parsed(
            LinkSchema,
            await queryWorkspaceTool(context, TOOL, { ...call, confirm: true }),
            'port link'
        );
        context.output.result(link, describeLink(link));
    },
};

const list: Command = {
    path: ['computer', 'url', 'list'],
    arguments: '<computer_id>',
    summary: "List a computer's open port links.",
    examples: ['dexto computer url list "$COMPUTER_ID" --json'],
    async run(context, input) {
        const computerId = argument(input, 0, 'computer_id');
        await requireLoginScopes(context, ['computers:read']);
        const listed = parsed(
            z.object({ links: z.array(LinkSchema) }).passthrough(),
            await queryWorkspaceTool(context, TOOL, { action: 'list', computerId }),
            'port link list'
        );
        context.output.result(
            listed,
            listed.links.length === 0
                ? 'No open links.'
                : listed.links.map((link) => `${link.port}  ${describeLink(link)}`).join('\n')
        );
    },
};

const revoke: Command = {
    path: ['computer', 'url', 'revoke'],
    arguments: '<computer_id> <port>',
    summary: "Close a computer port's link at once.",
    options: { ...DRY_RUN_OPTION, ...YES_OPTION },
    examples: [
        'dexto computer url revoke "$COMPUTER_ID" 3000 --yes --json',
        'dexto computer url revoke "$COMPUTER_ID" 3000 --dry-run --json',
    ],
    async run(context, input) {
        const computerId = argument(input, 0, 'computer_id');
        const closedPort = port(input, 1);
        const call = { action: 'revoke', computerId, port: closedPort };
        if (flag(input, 'dry-run'))
            return context.output.result(
                { dryRun: true, tool: TOOL, arguments: call },
                `Would close the link to port ${closedPort}.`
            );
        await requireLoginScopes(context, ['computers:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Close the link to port ${closedPort}? Anyone using it loses access at once.`
        );
        const revoked = await queryWorkspaceTool(context, TOOL, { ...call, confirm: true });
        context.output.result(revoked, `Closed the link to port ${closedPort}.`);
    },
};

export const computerUrlCommands: readonly Command[] = [share, list, revoke];
