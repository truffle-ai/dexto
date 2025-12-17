/**
 * Model Commands Module
 *
 * In interactive CLI, /model always shows the interactive model selector overlay.
 * This command definition exists for autocomplete and help display.
 */

import type { CommandDefinition, CommandHandlerResult } from '../command-parser.js';

/**
 * Model management command definition
 * Always shows the interactive model selector overlay (handled by ALWAYS_OVERLAY)
 */
export const modelCommands: CommandDefinition = {
    name: 'model',
    description: 'Switch AI model (interactive selector)',
    usage: '/model',
    category: 'General',
    aliases: ['m'],
    handler: async (): Promise<CommandHandlerResult> => {
        // This handler is never called - model is in ALWAYS_OVERLAY
        // which intercepts and shows the model selector overlay instead
        return true;
    },
};
