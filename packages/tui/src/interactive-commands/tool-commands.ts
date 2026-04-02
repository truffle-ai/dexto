/**
 * Tool Commands Module
 *
 * This module defines tool management slash commands for the Dexto CLI interface.
 * These commands provide functionality for listing and managing MCP tools.
 *
 * Available Tool Commands:
 * - /tools - Interactive tool browser
 */

import type { CommandDefinition, CommandContext } from './command-parser.js';
import type { TuiAgentBackend } from '../agent-backend.js';

/**
 * Tool management commands
 */
export const toolCommands: CommandDefinition[] = [
    {
        name: 'tools',
        description: 'Browse available tools interactively',
        usage: '/tools',
        category: 'Tool Management',
        handler: async (
            _args: string[],
            _agent: TuiAgentBackend,
            _ctx: CommandContext
        ): Promise<boolean | string> => {
            // Overlay is handled via commandOverlays.ts mapping
            return true;
        },
    },
];
