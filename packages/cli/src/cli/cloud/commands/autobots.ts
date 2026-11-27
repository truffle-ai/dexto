// `autobots`: the specialists you hired, hiring one from a template, and messaging one at its
// address, over Dexto's AutoBot tools and dexto_chat_send.

import { z } from 'zod';

import { CommandFailure } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import {
    argument,
    flag,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const AutobotSchema = z
    .object({
        address: z.string(),
        id: z.string(),
        name: z.string(),
        role: z.string(),
        updatedAt: z.string(),
        waitingOnYou: z.boolean(),
    })
    .passthrough();
const AutobotResultSchema = z.object({ autobot: AutobotSchema }).passthrough();

function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const result = schema.safeParse(value);
    if (!result.success)
        throw new CommandFailure('failed', `Dexto didn't return a valid ${what}.`, null);
    return result.data;
}

/** Calls an AutoBot tool; one you didn't hire fails as not found, with where to find yours. */
async function autobotTool(
    context: CommandContext,
    name: string,
    input: Record<string, unknown>
): Promise<unknown> {
    try {
        return await queryWorkspaceTool(context, name, input);
    } catch (error) {
        if (error instanceof CommandFailure && error.kind === 'not_found')
            throw new CommandFailure(
                'not_found',
                `${error.message} List the AutoBots you hired to find its id.`,
                'dexto autobots list'
            );
        throw error;
    }
}

/** A template as `publisher/slug`, such as `dexto/release-manager`; a leading `@` is allowed. */
function templateAddress(value: string): { publisherHandle: string; templateSlug: string } {
    const match = /^@?([^/\s]+)\/([^/\s]+)$/u.exec(value.trim());
    if (match === null || match[1] === undefined || match[2] === undefined)
        throw new UsageError('Name the template as publisher/slug, such as dexto/release-manager.');
    return { publisherHandle: match[1], templateSlug: match[2] };
}

const list: Command = {
    path: ['autobots', 'list'],
    summary:
        'List the AutoBots you hired: each one’s role and whether it waits on you. --json adds its goal and the address that reaches it.',
    examples: ['dexto autobots list', 'dexto autobots list --json'],
    async run(context) {
        await requireLoginScopes(context, ['autobots:read']);
        const result = parsed(
            z.object({ autobots: z.array(AutobotSchema) }).passthrough(),
            await autobotTool(context, 'dexto_autobots_list', {}),
            'AutoBot list'
        );
        context.output.list({ data: result.autobots }, [
            { header: 'id', value: (autobot) => autobot.id },
            { header: 'name', value: (autobot) => autobot.name },
            { header: 'role', value: (autobot) => autobot.role },
            { header: 'waiting on you', value: (autobot) => (autobot.waitingOnYou ? 'yes' : '') },
            { header: 'updated', value: (autobot) => autobot.updatedAt },
        ]);
    },
};

const get: Command = {
    path: ['autobots', 'get'],
    arguments: '<autobot_id>',
    summary:
        'Show one AutoBot you hired: its role, the goal it agreed with you, its starters, the template it came from and its address.',
    examples: ['dexto autobots get "$AUTOBOT_ID"', 'dexto autobots get "$AUTOBOT_ID" --json'],
    async run(context, input) {
        const autobotId = argument(input, 0, 'autobot_id');
        await requireLoginScopes(context, ['autobots:read']);
        context.output.record(
            parsed(
                AutobotResultSchema,
                await autobotTool(context, 'dexto_autobot_get', { autobotId }),
                'AutoBot'
            )
        );
    },
};

const hire: Command = {
    path: ['autobots', 'hire'],
    arguments: '<template>',
    summary:
        'Hire an AutoBot from a template, named publisher/slug. It installs the template’s Skills into your library and opens a first meeting in Dexto.',
    examples: [
        'dexto autobots hire dexto/release-manager --yes',
        'dexto autobots hire "$PUBLISHER/$TEMPLATE_SLUG" --yes --json',
    ],
    options: { ...YES_OPTION },
    async run(context, input) {
        const template = argument(input, 0, 'template');
        const address = templateAddress(template);
        await requireLoginScopes(context, ['autobots:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Hire an AutoBot from ${address.publisherHandle}/${address.templateSlug}? Its Skills are installed into your library.`
        );
        const value = await autobotTool(context, 'dexto_autobot_hire', address);
        const { autobot } = parsed(AutobotResultSchema, value, 'hired AutoBot');
        context.output.result(
            value,
            `Hired ${autobot.name} (${autobot.id}). It opened a first meeting with you in Dexto.`
        );
    },
};

const chat: Command = {
    path: ['autobots', 'chat'],
    arguments: '<autobot_id> <message>',
    summary:
        'Message an AutoBot you hired, in its own conversation. It steers its current turn unless --follow-up.',
    examples: [
        'dexto autobots chat "$AUTOBOT_ID" "What changed this week?" --yes',
        'dexto autobots chat "$AUTOBOT_ID" "Then draft the notes." --follow-up --yes --json',
    ],
    options: {
        'follow-up': {
            type: 'boolean',
            description: 'Wait until its current work ends instead of steering it.',
        },
        ...YES_OPTION,
    },
    async run(context, input) {
        const autobotId = argument(input, 0, 'autobot_id');
        const message = argument(input, 1, 'message');
        if (message.trim().length === 0) throw new UsageError('The message is empty.');
        await requireLoginScopes(context, ['sessions:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Send this message to the AutoBot ${autobotId}?`
        );
        const value = await autobotTool(context, 'dexto_chat_send', {
            sessionId: `agent:autobots:${autobotId}`,
            message,
            queue: flag(input, 'follow-up') ? 'follow-up' : 'steer',
        });
        context.output.result(value, `Sent to the AutoBot ${autobotId}.`);
    },
};

export const autobotCommands: readonly Command[] = [list, get, hire, chat];
