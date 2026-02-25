/**
 * Plugin Commands Module
 *
 * In interactive CLI, /plugin always shows the interactive plugin manager overlay.
 * This command definition exists for autocomplete and help display.
 */

import type { CommandDefinition } from '../command-parser.js';
import { overlayOnlyHandler } from '../command-parser.js';

/**
 * Plugin management command definition.
 * Handler is never called - plugin is in ALWAYS_OVERLAY and handled by PluginManager overlay.
 */
export const pluginCommands: CommandDefinition = {
    name: 'plugin',
    description: 'Manage plugins (interactive)',
    usage: '/plugin',
    category: 'Plugin Management',
    handler: overlayOnlyHandler,
};
