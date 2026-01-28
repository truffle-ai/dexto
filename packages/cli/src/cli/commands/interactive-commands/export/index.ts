/**
 * Export Command Module
 *
 * Provides the /export command for exporting conversation history.
 * Always shows the interactive export wizard overlay.
 */

import type { CommandDefinition, CommandContext, CommandHandlerResult } from '../command-parser.js';
import type { DextoAgent } from '@dexto/core';

/**
 * Export command definition
 * Always shows the interactive export wizard overlay (handled by ALWAYS_OVERLAY)
 */
export const exportCommand: CommandDefinition = {
    name: 'export',
    description: 'Export conversation to markdown or JSON',
    usage: '/export',
    category: 'Session',
    handler: async (
        _args: string[],
        _agent: DextoAgent,
        _ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        // This handler is never called - export is in ALWAYS_OVERLAY
        // which intercepts and shows the export wizard overlay instead
        return true;
    },
};
