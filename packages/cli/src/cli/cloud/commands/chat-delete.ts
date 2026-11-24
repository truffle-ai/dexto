// `chat delete`: delete one of your cloud chats over dexto_chat_delete, or with --local a chat on this
// machine and its synced copy.

import { z } from 'zod';
import { nodeChatSync } from '../../chat-sync/node.js';
import { deletedCopyText } from '../../chat-sync/notices.js';
import { CommandFailure } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import { argument, flag, YES_OPTION, type Command, type CommandContext } from '../command.js';
import { chatNotFound, openLocalChats } from './chat-read.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const DeletedSchema = z.object({ deleted: z.literal(true), sessionId: z.string() });

/** A chat on this machine, then its synced copy in Dexto Cloud, which waits if it can't be reached. */
async function deleteLocalChat(context: CommandContext, sessionId: string): Promise<void> {
    const agent = await openLocalChats(context);
    if ((await agent.getSessionMetadata(sessionId)) === undefined)
        throw chatNotFound('delete', sessionId, true);
    await agent.deleteSession(sessionId);
    const syncedCopy = await nodeChatSync(() => undefined)
        .deleteLocalChat(sessionId)
        .catch(() => 'pending' as const);
    context.output.result(
        { deleted: true, sessionId, syncedCopy },
        [`Deleted chat ${sessionId} on this machine.`, deletedCopyText(syncedCopy)]
            .filter((line) => line !== null)
            .join('\n')
    );
}

export const chatDeleteCommand: Command = {
    path: ['chat', 'delete'],
    arguments: '<chat_id>',
    summary:
        "Delete one of your cloud chats and its computer, or with --local a chat on this machine and its synced copy. Can't be undone; always asks first. Requires sessions:write.",
    options: {
        local: {
            type: 'boolean',
            description: 'Delete a chat on this machine instead, from dexto chat list --local.',
        },
        'dry-run': {
            description:
                'Check the input and show what would be deleted, without asking or deleting.',
            type: 'boolean',
        },
        ...YES_OPTION,
    },
    examples: [
        'dexto chat delete "$CHAT_ID"',
        'dexto chat delete "$CHAT_ID" --yes --json',
        'dexto chat delete "$CHAT_ID" --local --yes --json',
    ],
    jsonOutput: {
        description:
            'The deleted chat. With --local, syncedCopy says what happened to its copy in Dexto Cloud: none, deleted, pending or in_cloud.',
        schema: z.toJSONSchema(DeletedSchema),
    },
    async run(context, input) {
        const sessionId = argument(input, 0, 'chat_id');
        const local = flag(input, 'local');
        if (flag(input, 'dry-run')) {
            context.output.result(
                local
                    ? { dryRun: true, local: true, sessionId }
                    : { dryRun: true, tool: 'dexto_chat_delete', arguments: { sessionId } },
                `Would delete chat ${sessionId}${local ? ' on this machine' : ''}.`
            );
            return;
        }
        if (!local) await requireLoginScopes(context, ['sessions:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            local
                ? `Deleting chat ${sessionId} on this machine, and its synced copy, can't be undone.`
                : `Deleting chat ${sessionId} and its computer can't be undone.`
        );
        if (local) return deleteLocalChat(context, sessionId);
        // Dexto finds only your own chats, so another member's chat is not found either.
        const value = await queryWorkspaceTool(context, 'dexto_chat_delete', { sessionId }).catch(
            (error: unknown) => {
                if (error instanceof CommandFailure && error.kind === 'not_found')
                    throw chatNotFound('delete', sessionId, false);
                throw error;
            }
        );
        const deleted = DeletedSchema.parse(value);
        context.output.result(deleted, `Deleted chat ${deleted.sessionId}.`);
    },
};
