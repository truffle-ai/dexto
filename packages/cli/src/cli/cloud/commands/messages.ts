// `messages`: the person's Dexto direct conversations, read as them over the Dexto MCP.

import { z } from 'zod';

import { argument, type Command } from '../command.js';
import { READ_OPTIONS, readConversationPage } from './channels.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const ConversationSchema = z
    .object({
        id: z.string(),
        unread: z.boolean(),
        lastActivityAt: z.string(),
        participants: z.array(z.object({ displayName: z.string().nullable() }).passthrough()),
    })
    .passthrough();
const ListSchema = z.object({ conversations: z.array(ConversationSchema) }).passthrough();

const list: Command = {
    path: ['messages', 'list'],
    summary:
        'List your direct conversations in this organization, most recent first. Example: dexto messages list --json',
    async run(context) {
        await requireLoginScopes(context, ['messages:read']);
        const { conversations } = ListSchema.parse(
            await queryWorkspaceTool(context, 'dexto_direct_conversations_list', {})
        );
        context.output.list({ data: conversations }, [
            { header: 'id', value: (conversation) => conversation.id },
            {
                header: 'with',
                value: (conversation) =>
                    conversation.participants.map((person) => person.displayName ?? '').join(', '),
            },
            { header: 'last activity', value: (conversation) => conversation.lastActivityAt },
            { header: 'unread', value: (conversation) => (conversation.unread ? 'yes' : '') },
        ]);
    },
};

const read: Command = {
    arguments: '<conversation_id>',
    options: READ_OPTIONS,
    path: ['messages', 'read'],
    summary:
        'Read the newest messages of a direct conversation, or of one reply thread with --thread. Reading marks nothing read. Example: dexto messages read "$CONVERSATION_ID" --json',
    async run(context, input) {
        await readConversationPage(context, input, 'dexto_direct_conversation_get', {
            conversationId: argument(input, 0, 'conversation_id'),
        });
    },
};

export const messageCommands: readonly Command[] = [list, read];
