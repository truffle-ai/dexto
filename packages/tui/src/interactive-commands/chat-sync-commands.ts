/**
 * Chat sync commands: /sync shows or changes where chats sync to Dexto Cloud, and /private keeps
 * this chat on this machine. The host owns the state and the words; these only pass them on.
 */

import { getTuiRuntimeServices } from '../host/index.js';
import type { CommandDefinition } from './command-parser.js';
import type { HistoryReloadMarker } from '../services/CommandService.js';

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

export const moveCommands: CommandDefinition[] = ['cloud', 'local'].map((name) => ({
    name,
    description:
        name === 'cloud'
            ? 'Move this synced chat to its cloud computer'
            : 'Bring this chat and its work back to this machine',
    usage: `/${name}`,
    category: 'General',
    handler: async (args, _agent, ctx) =>
        runChatMove(name === 'cloud' ? 'cloud' : 'local', args, ctx.sessionId),
}));

export async function runChatMove(
    to: 'cloud' | 'local',
    args: readonly string[],
    sessionId: string | null
): Promise<string | HistoryReloadMarker> {
    if (args.length > 0) return `Usage: /${to}`;
    const move = getTuiRuntimeServices().chatMove;
    if (move === undefined) return 'Chat hand-off is not available here.';
    if (sessionId === null) return 'Start a chat before moving it.';
    const output = await move(to, sessionId);
    return to === 'local' ? { __reloadHistory: true, sessionId, output } : output;
}

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
    if (moveCommands.includes(command)) return getTuiRuntimeServices().chatMove !== undefined;
    if (command !== syncCommand && command !== privateCommand) return true;
    return getTuiRuntimeServices().chatSync !== undefined;
}
