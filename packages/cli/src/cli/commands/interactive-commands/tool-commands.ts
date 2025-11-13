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
import { logger, type DextoAgent } from '@dexto/core';
import type { CommandDefinition } from './command-parser.js';
import { formatForInkCli } from './utils/format-output.js';

/**
 * Tool management commands
 */
export const toolCommands: CommandDefinition[] = [
    {
        name: 'tools',
        description: 'List all available tools (MCP and internal tools)',
        usage: '/tools',
        category: 'Tool Management',
        handler: async (args: string[], agent: DextoAgent): Promise<boolean | string> => {
            try {
                const allTools = await agent.getAllTools();
                const mcpTools = await agent.getAllMcpTools();
                const toolEntries = Object.entries(allTools);

                if (toolEntries.length === 0) {
                    const output = '📋 No tools available';
                    console.log(chalk.yellow(output));
                    return formatForInkCli(output);
                }

                // Build output string
                const outputLines: string[] = [`\n🔧 Available Tools (${toolEntries.length}):\n`];

                // Display tools with descriptions and source
                for (const [toolName, toolInfo] of toolEntries) {
                    const description = toolInfo.description || 'No description available';
                    const isMcpTool = Object.keys(mcpTools).includes(toolName);

                    // Determine tool source: internal tools take precedence over MCP tools
                    let source: string;
                    if (!isMcpTool && !toolName.startsWith('mcp--')) {
                        // Non-MCP tool that doesn't have mcp prefix = internal tool
                        source = '[Internal]';
                    } else if (isMcpTool || toolName.startsWith('mcp--')) {
                        source = '[MCP]';
                    } else {
                        source = '[Unknown]';
                    }

                    outputLines.push(`  ${toolName} ${source} - ${description}`);
                }

                outputLines.push(
                    '\n💡 Tools are provided by connected MCP servers and internal tools'
                );
                const output = outputLines.join('\n');

                // Log for regular CLI (with chalk formatting)
                console.log(chalk.bold.green(`\n🔧 Available Tools (${toolEntries.length}):\n`));
                for (const [toolName, toolInfo] of toolEntries) {
                    const description = toolInfo.description || 'No description available';
                    const isMcpTool = Object.keys(mcpTools).includes(toolName);
                    let source: string;
                    if (!isMcpTool && !toolName.startsWith('mcp--')) {
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

                return formatForInkCli(output);
            } catch (error) {
                const errorMsg = `Failed to list tools: ${error instanceof Error ? error.message : String(error)}`;
                logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
];
