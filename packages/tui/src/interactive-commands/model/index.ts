/**
 * Model Commands Module
 *
 * In interactive CLI, /model always shows the interactive model selector overlay.
 * This command definition exists for autocomplete and help display.
 */

import type { CommandDefinition } from '../command-parser.js';
import { overlayOnlyHandler } from '../command-parser.js';

/**
 * Model management command definition.
 * Handler is never called - model is in ALWAYS_OVERLAY and handled by ModelSelector overlay.
 */
export const modelCommands: CommandDefinition = {
    name: 'model',
    description: 'Switch AI model (interactive selector)',
    usage: '/model',
    category: 'General',
    aliases: ['m', 'models'],
    handler: overlayOnlyHandler,
};
