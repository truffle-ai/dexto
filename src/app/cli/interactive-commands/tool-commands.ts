/**
 * Tool Commands Module
 *
 * This module defines tool management slash commands for the Dexto CLI interface.
 * These commands provide functionality for listing and managing MCP tools.
 *
 * Available Tool Commands:
 * - /tools - List all available MCP tools
 */

import chalk from 'chalk';
import { logger } from '@core/index.js';
import type { DextoAgent } from '@core/index.js';
import type { CommandDefinition } from './command-parser.js';

/**
 * Tool management commands
 */
export const toolCommands: CommandDefinition[] = [
    {
        name: 'tools',
        description: 'List all available tools (MCP and internal tools)',
        usage: '/tools',
        category: 'Tool Management',
        handler: async (args: string[], agent: DextoAgent): Promise<boolean> => {
            try {
                const allTools = await agent.getAllTools();
                const mcpTools = await agent.getAllMcpTools();
                const toolEntries = Object.entries(allTools);

                if (toolEntries.length === 0) {
                    console.log(chalk.yellow('📋 No tools available'));
                    return true;
                }

                console.log(chalk.bold.green(`\n🔧 Available Tools (${toolEntries.length}):\n`));

                // Display tools with descriptions and source
                for (const [toolName, toolInfo] of toolEntries) {
                    const description = toolInfo.description || 'No description available';
                    const isMcpTool = Object.keys(mcpTools).includes(toolName);

                    // Determine tool source: internal tools take precedence over MCP tools
                    let source: string;
                    if (!isMcpTool && !toolName.startsWith('mcp--')) {
                        // Non-MCP tool that doesn't have mcp prefix = internal tool
                        source = chalk.magenta('[Internal]');
                    } else if (isMcpTool || toolName.startsWith('mcp--')) {
                        source = chalk.blue('[MCP]');
                    } else {
                        source = chalk.gray('[Unknown]');
                    }

                    console.log(
                        `  ${chalk.yellow(toolName)} ${source} - ${chalk.dim(description)}`
                    );
                }

                console.log(
                    chalk.dim('\n💡 Tools are provided by connected MCP servers and internal tools')
                );
            } catch (error) {
                logger.error(
                    `Failed to list tools: ${error instanceof Error ? error.message : String(error)}`
                );
            }
            return true;
        },
    },
];
