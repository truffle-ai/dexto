// `chat delete`: delete one of your own cloud chats over dexto_chat_delete, or with --local a chat
// stored on this machine (and its synced copy in Dexto Cloud).

import { z } from 'zod';

import type { CloudDelete } from '../../chat-sync/engine.js';
import { CommandFailure } from '../../failure.js';
import { requireConsent, shellWord } from '../../interaction.js';
import { argument, flag, YES_OPTION, type Command, type CommandContext } from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const CloudDeletedSchema = z.object({ deleted: z.literal(true), sessionId: z.string() });
// What happened to a local chat's synced copy, as the chat sync answers it.
const CLOUD_COPIES = [
    'none',
    'deleted',
    'pending',
    'in_cloud',
] as const satisfies readonly CloudDelete[];

const DeletedSchema = z.discriminatedUnion('location', [
    CloudDeletedSchema.extend({ location: z.literal('cloud') }),
    z.object({
        deleted: z.literal(true),
        location: z.literal('local'),
        sessionId: z.string(),
        cloudCopy: z.enum(CLOUD_COPIES),
    }),
]);

/** Deletes a chat on this machine through the local agent, then its synced copy in Dexto Cloud. */
async function deleteLocalChat(
    context: CommandContext,
    sessionId: string,
    yes: boolean
): Promise<void> {
    if (context.openLocalAgent === undefined)
        throw new CommandFailure(
            'failed',
            "This machine's chats are deleted only by dexto itself.",
            null
        );
    const agent = await context.openLocalAgent();
    if ((await agent.getSessionMetadata(sessionId)) === undefined)
        throw new CommandFailure(
            'not_found',
            `This machine has no chat ${sessionId}. Without --local, chat delete deletes a cloud chat.`,
            `dexto chat delete ${shellWord(sessionId)} --yes`
        );
    await requireConsent(
        context,
        yes,
        `Deleting chat ${sessionId} on this machine, and its synced copy in Dexto Cloud, can't be undone.`
    );
    await agent.deleteSession(sessionId);
    const [{ nodeChatSync }, { deletedCopyText }] = await Promise.all([
        import('../../chat-sync/node.js'),
        import('../../chat-sync/notices.js'),
    ]);
    // A copy Dexto Cloud can't be reached for now is deleted the next time it can.
    const cloudCopy = await nodeChatSync(() => undefined)
        .deleteLocalChat(sessionId)
        .catch(() => 'pending' as const);
    const copyText = deletedCopyText(cloudCopy);
    context.output.result(
        { deleted: true, location: 'local', sessionId, cloudCopy },
        [`Deleted chat ${sessionId} on this machine.`, copyText].filter(Boolean).join(' ')
    );
}

export const chatDeleteCommand: Command = {
    arguments: '<chat_id>',
    examples: [
        'dexto chat delete "$CHAT_ID" --yes --json',
        'dexto chat delete "$CHAT_ID" --profile "$PROFILE" --yes',
        'dexto chat delete "$CHAT_ID" --local --yes',
    ],
    jsonOutput: {
        description:
            'The deleted chat: location cloud, or local with what happened to its synced copy in Dexto Cloud (cloudCopy).',
        schema: z.toJSONSchema(DeletedSchema),
    },
    options: {
        local: {
            description:
                'Delete a chat stored on this machine instead (see dexto chat list --local), and its synced copy.',
            type: 'boolean',
        },
        'dry-run': {
            description:
                'Check the input and show what would be deleted, without asking or deleting.',
            type: 'boolean',
        },
        ...YES_OPTION,
    },
    path: ['chat', 'delete'],
    summary:
        "Delete one of your own cloud chats: its run stops, its subagents are cancelled, and its computer and stored outputs are deleted. It can't be undone; a Project's conversation is refused. --local deletes a chat on this machine. Requires sessions:write.",
    async run(context, input) {
        const sessionId = argument(input, 0, 'chat_id');
        const local = flag(input, 'local');
        if (flag(input, 'dry-run')) {
            const call = { sessionId };
            context.output.result(
                local
                    ? { dryRun: true, location: 'local', sessionId }
                    : { dryRun: true, tool: 'dexto_chat_delete', arguments: call },
                local
                    ? `Would delete chat ${sessionId} on this machine.`
                    : `Would call dexto_chat_delete with ${JSON.stringify(call)}.`
            );
            return;
        }
        if (local) return deleteLocalChat(context, sessionId, flag(input, 'yes'));
        await requireLoginScopes(context, ['sessions:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Deleting cloud chat ${sessionId}, with its computer and stored outputs, can't be undone.`
        );
        const value = await queryWorkspaceTool(context, 'dexto_chat_delete', { sessionId }).catch(
            (error: unknown) => {
                // Dexto finds only your own chats, so another member's chat is not found either.
                if (error instanceof CommandFailure && error.kind === 'not_found')
                    throw new CommandFailure(
                        'not_found',
                        `You have no cloud chat ${sessionId}. Only a chat's owner can delete it; a chat stored on this machine is deleted with --local.`,
                        `dexto chat delete ${shellWord(sessionId)} --local --yes`
                    );
                throw error;
            }
        );
        const deleted = CloudDeletedSchema.parse(value);
        context.output.result(
            { ...deleted, location: 'cloud' },
            `Deleted chat ${deleted.sessionId}.`
        );
    },
};
