/**
 * MCP Commands Module
 *
 * In interactive CLI, /mcp always shows the interactive MCP server list overlay.
 * This command definition exists for autocomplete and help display.
 */

import type { CommandDefinition } from '../command-parser.js';
import { overlayOnlyHandler } from '../command-parser.js';

/**
 * MCP management command definition.
 * Handler is never called - mcp is in ALWAYS_OVERLAY and handled by McpServerList overlay.
 */
export const mcpCommands: CommandDefinition = {
    name: 'mcp',
    description: 'Manage MCP servers (interactive)',
    usage: '/mcp',
    category: 'MCP Management',
    handler: overlayOnlyHandler,
};
