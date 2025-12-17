/**
 * MCP Commands Module
 *
 * In interactive CLI, /mcp always shows the interactive MCP server list overlay.
 * This command definition exists for autocomplete and help display.
 */

import type { CommandDefinition, CommandHandlerResult } from '../command-parser.js';

/**
 * MCP management command definition
 * Always shows the interactive MCP server list overlay (handled by ALWAYS_OVERLAY)
 */
export const mcpCommands: CommandDefinition = {
    name: 'mcp',
    description: 'Manage MCP servers (interactive)',
    usage: '/mcp',
    category: 'MCP Management',
    handler: async (): Promise<CommandHandlerResult> => {
        // This handler is never called - mcp is in ALWAYS_OVERLAY
        // which intercepts and shows the MCP server list overlay instead
        return true;
    },
};
