/**
 * Chat sync commands: /sync shows or changes where chats sync to Dexto Cloud, and /private keeps
 * this chat on this machine. The host owns the state and the words; these only pass them on.
 */

import { getTuiRuntimeServices } from '../host/index.js';
import type { CommandDefinition } from './command-parser.js';

export const syncCommand: CommandDefinition = {
    name: 'sync',
    description: 'Show or change chat sync to Dexto Cloud',
    usage: '/sync [on|off] [project]',
    category: 'General',
    handler: async (args, _agent, ctx) => runChatSync('sync', args, ctx.sessionId),
};

export const privateCommand: CommandDefinition = {
    name: 'private',
    description: 'Keep this chat on this machine: it stops syncing and its cloud copy is deleted',
    usage: '/private [off]',
    category: 'General',
    handler: async (args, _agent, ctx) => runChatSync('private', args, ctx.sessionId),
};

async function runChatSync(
    name: 'sync' | 'private',
    args: string[],
    sessionId: string | null
): Promise<string> {
    const chatSync = getTuiRuntimeServices().chatSync;
    if (chatSync === undefined) return 'Chat sync is not available here.';
    return await chatSync.command(name, args, sessionId);
}

/** False for these commands when the host doesn't sync chats; true for every other command. */
export function chatSyncAvailable(command: CommandDefinition): boolean {
    if (command !== syncCommand && command !== privateCommand) return true;
    return getTuiRuntimeServices().chatSync !== undefined;
}
