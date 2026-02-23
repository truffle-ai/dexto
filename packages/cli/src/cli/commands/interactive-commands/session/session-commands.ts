/**
 * Session Management Commands (Interactive CLI)
 *
 * This module contains session-related commands for the interactive CLI.
 * Session management in interactive mode uses overlays/selectors rather than subcommands.
 *
 * Commands:
 * - resume: Shows interactive session selector
 * - search: Opens interactive search overlay
 * - rename: Rename the current session
 *
 * Note: For non-interactive session subcommands (list, history, delete),
 * see src/cli/commands/session-commands.ts
 */

import type { DextoAgent } from '@dexto/core';
import type { CommandDefinition, CommandContext } from '../command-parser.js';

/**
 * Resume command - shows interactive session selector
 * Note: In interactive CLI, this always shows the selector (args ignored)
 * Tip: To start the interactive CLI directly in a session, use `dexto --resume <sessionId>`.
 */
export const resumeCommand: CommandDefinition = {
    name: 'resume',
    description: 'Switch to a different session (interactive selector)',
    usage: '/resume',
    category: 'General',
    aliases: ['r'],
    handler: async (
        _args: string[],
        _agent: DextoAgent,
        _ctx: CommandContext
    ): Promise<boolean | string> => {
        // In interactive CLI, /resume always triggers the interactive selector
        // The selector is shown via detectInteractiveSelector in inputParsing.ts
        // This handler should not be called in ink-cli (selector shows instead)
        const helpText = [
            '📋 Resume Session',
            '\nType /resume to show the session selector\n',
        ].join('\n');

        return helpText;
    },
};

/**
 * Standalone search command - opens interactive search overlay
 */
export const searchCommand: CommandDefinition = {
    name: 'search',
    description: 'Search messages across all sessions',
    usage: '/search',
    category: 'General',
    aliases: ['find'],
    handler: async (
        _args: string[],
        _agent: DextoAgent,
        _ctx: CommandContext
    ): Promise<boolean> => {
        // Interactive overlay handles everything - just return success
        return true;
    },
};

/**
 * Rename command - rename the current session
 * In interactive CLI, this shows the rename overlay.
 * The overlay is triggered via commandOverlays.ts registry.
 */
export const renameCommand: CommandDefinition = {
    name: 'rename',
    description: 'Rename the current session',
    usage: '/rename',
    category: 'General',
    handler: async (
        _args: string[],
        _agent: DextoAgent,
        _ctx: CommandContext
    ): Promise<boolean> => {
        // Interactive overlay handles everything - just return success
        return true;
    },
};
