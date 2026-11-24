// `channels`: the person's Dexto channels, read and sent as them over the Dexto MCP.

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { requireConsent } from '../../interaction.js';
import {
    argument,
    choiceOption,
    flag,
    integerOption,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const SEND_AS = ['origin', 'user'] as const;

const ChannelSchema = z
    .object({
        id: z.string(),
        title: z.string().nullable(),
        visibility: z.string(),
        unread: z.boolean(),
    })
    .passthrough();
const ListSchema = z.object({ channels: z.array(ChannelSchema) }).passthrough();
const MessageSchema = z
    .object({
        authorName: z.string(),
        id: z.string(),
        nextTextOffset: z.number().nullable(),
        text: z.string(),
    })
    .passthrough();
const PageSchema = z
    .object({
        messages: z.array(MessageSchema),
        nextCursor: z.number().nullable(),
        previousCursor: z.number().nullable(),
    })
    .passthrough();
const SentSchema = z.object({ accepted: z.literal(true), messageId: z.string() }).passthrough();

const THREAD_OPTION = {
    thread: {
        description: 'A reply thread, by the id of the message it replies to.',
        type: 'string',
        valueName: 'MESSAGE_ID',
    },
} as const;

const list: Command = {
    path: ['channels', 'list'],
    examples: ['dexto channels list --json'],
    summary:
        'List the channels you are in, in this organization. Example: dexto channels list --json',
    async run(context) {
        await requireLoginScopes(context, ['messages:read']);
        const { channels } = ListSchema.parse(
            await queryWorkspaceTool(context, 'dexto_channels_list', {})
        );
        context.output.list({ data: channels }, [
            { header: 'id', value: (channel) => channel.id },
            { header: 'title', value: (channel) => channel.title ?? '' },
            { header: 'visibility', value: (channel) => channel.visibility },
            { header: 'unread', value: (channel) => (channel.unread ? 'yes' : '') },
        ]);
    },
};

const read: Command = {
    arguments: '<channel_id>',
    options: {
        ...THREAD_OPTION,
        before: {
            description: 'Older messages: the previousCursor of the last read.',
            type: 'string',
            valueName: 'CURSOR',
        },
        after: {
            description: 'Newer messages: the nextCursor of the last read.',
            type: 'string',
            valueName: 'CURSOR',
        },
        'text-offset': {
            description: 'The rest of a long message: its nextTextOffset from the last read.',
            type: 'string',
            valueName: 'N',
        },
    },
    path: ['channels', 'read'],
    examples: ['dexto channels read "$CHANNEL_ID" --json'],
    summary:
        'Read the newest messages of a channel, or of one reply thread with --thread. Reading marks nothing read. Example: dexto channels read "$CHANNEL_ID" --json',
    async run(context, input) {
        const channelId = argument(input, 0, 'channel_id');
        const before = integerOption(input, 'before');
        const after = integerOption(input, 'after');
        const textOffset = integerOption(input, 'text-offset');
        const thread = stringOption(input, 'thread');
        if (before !== undefined && after !== undefined)
            throw new UsageError('Pass --before or --after, not both.');
        await requireLoginScopes(context, ['messages:read']);
        const value = await queryWorkspaceTool(context, 'dexto_channel_get', {
            channelId,
            ...(before === undefined ? {} : { before }),
            ...(after === undefined ? {} : { after }),
            ...(textOffset === undefined ? {} : { textOffset }),
            ...(thread === undefined ? {} : { threadRootMessageId: thread }),
        });
        if (context.output.json) return context.output.record(value);
        printPage(context, PageSchema.parse(value));
    },
};

const send: Command = {
    arguments: '<channel_id> <text>',
    options: {
        ...THREAD_OPTION,
        as: {
            description:
                'origin (the default: your verified Project identity where there is one, else you) or user (you, with Dexto attribution).',
            type: 'string',
        },
        'request-key': {
            description:
                'A key for this exact send. Running again with the same key after a lost response never sends twice. One is made when you leave it out, and printed.',
            type: 'string',
            valueName: 'KEY',
        },
        'dry-run': { description: 'Show the call without sending it.', type: 'boolean' },
        ...YES_OPTION,
    },
    path: ['channels', 'send'],
    examples: ['dexto channels send "$CHANNEL_ID" "Example message" --dry-run --json'],
    summary:
        'Send this exact text (or - for stdin) to a channel you are in. Everyone in it sees it. Example: dexto channels send "$CHANNEL_ID" "Shipped." --yes',
    async run(context, input) {
        const channelId = argument(input, 0, 'channel_id');
        const given = argument(input, 1, 'text');
        const text = given === '-' ? await context.runtime.readStdin() : given;
        if (text.trim().length === 0) throw new UsageError('The message is empty.');
        const sendAs = choiceOption(input, 'as', SEND_AS);
        const thread = stringOption(input, 'thread');
        const call = {
            channelId,
            text,
            requestKey: stringOption(input, 'request-key') ?? randomUUID(),
            ...(sendAs === undefined ? {} : { sendAs }),
            ...(thread === undefined ? {} : { threadRootMessageId: thread }),
        };
        if (flag(input, 'dry-run'))
            return context.output.result(
                { dryRun: true, tool: 'dexto_channel_send', arguments: call },
                `Would send ${text.length} characters to channel ${channelId}.`
            );
        await requireLoginScopes(context, ['messages:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Send this message to channel ${channelId}? Everyone in it sees it.`
        );
        // Said before the call, so a lost response can still be retried without sending twice.
        context.output.note(`Request key: ${call.requestKey}`);
        const value = await queryWorkspaceTool(context, 'dexto_channel_send', {
            ...call,
            confirm: true,
        });
        const sent = SentSchema.parse(value);
        context.output.result(
            { ...sent, requestKey: call.requestKey },
            `Sent message ${sent.messageId}. To retry without sending twice: --request-key ${call.requestKey}`
        );
    },
};

/** A page of messages for people, oldest first, with how to read further. */
function printPage(context: CommandContext, page: z.output<typeof PageSchema>): void {
    if (page.messages.length === 0) context.runtime.writeOutput('No messages.\n');
    for (const message of page.messages) {
        context.runtime.writeOutput(`${message.authorName} (${message.id}):\n${message.text}\n\n`);
        if (message.nextTextOffset !== null)
            context.output.note(
                `More of ${message.id}: add --text-offset ${message.nextTextOffset}`
            );
    }
    if (page.previousCursor !== null)
        context.output.note(`Older messages: add --before ${page.previousCursor}`);
    if (page.nextCursor !== null)
        context.output.note(`Newer messages: add --after ${page.nextCursor}`);
}

export const channelCommands: readonly Command[] = [list, read, send];
