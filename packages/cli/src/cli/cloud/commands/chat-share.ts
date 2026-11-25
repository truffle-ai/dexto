// `chat share`: who in its organization can open one of your own cloud chats, over dexto_chat_share.

import { z } from 'zod';

import { CommandFailure } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import { argument, chatArgument, flag, UsageError, YES_OPTION, type Command } from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const ACCESS = ['private', 'view', 'prompt'] as const;
type Access = (typeof ACCESS)[number];

const SharedSchema = z.object({ access: z.enum(ACCESS), sessionId: z.string() });

/** What each change does, said before it is made. */
function consentText(sessionId: string, access: Access): string {
    if (access === 'private') return `Make chat ${sessionId} private, so only you can open it.`;
    if (access === 'view')
        return `Share chat ${sessionId} with your organization: every member can open and read it.`;
    return `Share chat ${sessionId} with your organization: every member can open it and send messages. Their turns use your organization's credits and count as your usage.`;
}

function doneText(sessionId: string, access: Access): string {
    if (access === 'private') return `Chat ${sessionId} is now private.`;
    if (access === 'view')
        return `Chat ${sessionId} is now shared with your organization: members can view it.`;
    return `Chat ${sessionId} is now shared with your organization: members can view it and send messages.`;
}

export const chatShareCommand: Command = {
    arguments: '<chat_id> <private|view|prompt>',
    examples: [
        'dexto chat share "$CHAT_ID" view --yes --json',
        'dexto chat share "$CHAT_ID" prompt',
        'dexto chat share "$CHAT_ID" private --yes',
    ],
    jsonOutput: {
        description: 'The access the chat now has.',
        schema: z.toJSONSchema(SharedSchema),
    },
    options: {
        'dry-run': {
            description: 'Check the input and show the call, without asking or making it.',
            type: 'boolean',
        },
        ...YES_OPTION,
    },
    path: ['chat', 'share'],
    summary:
        'Set who in your organization can open one of your own chats: private (only you), view (members read it) or prompt (members also send messages, using organization credits). Always asks first. Requires sessions:write.',
    async run(context, input) {
        const sessionId = chatArgument(input, 0);
        const given = argument(input, 1, 'access');
        const access = ACCESS.find((each) => each === given);
        if (access === undefined)
            throw new UsageError(`Access must be one of: ${ACCESS.join(', ')}, not ${given}.`);
        const call = { sessionId, access };
        if (flag(input, 'dry-run')) {
            context.output.result(
                { dryRun: true, tool: 'dexto_chat_share', arguments: call },
                `Would call dexto_chat_share with ${JSON.stringify(call)}.`
            );
            return;
        }
        await requireLoginScopes(context, ['sessions:write']);
        await requireConsent(context, flag(input, 'yes'), consentText(sessionId, access));
        const value = await queryWorkspaceTool(context, 'dexto_chat_share', {
            ...call,
            confirm: true,
        }).catch((error: unknown) => {
            // Dexto finds only your own chats, so another member's chat is not found either.
            if (error instanceof CommandFailure && error.kind === 'not_found')
                throw new CommandFailure(
                    'not_found',
                    `You have no chat ${sessionId}. Only a chat's owner can share it.`,
                    null
                );
            throw error;
        });
        const shared = SharedSchema.parse(value);
        context.output.result(shared, doneText(shared.sessionId, shared.access));
    },
};
