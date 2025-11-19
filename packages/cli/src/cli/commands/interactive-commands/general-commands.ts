/**
 * General Commands Module
 *
 * This module defines general-purpose slash commands for the Dexto CLI interface.
 * These are basic commands that don't fit into specific categories.
 *
 * Available General Commands:
 * - /help [command] - Show help information
 * - /exit, /quit, /q - Exit the CLI application
 * - /clear, /reset - Clear conversation history
 */

import chalk from 'chalk';
import { logger, type DextoAgent } from '@dexto/core';
import type { CommandDefinition } from './command-parser.js';
import { displayAllCommands, formatCommandHelp } from './command-parser.js';
import { formatForInkCli } from './utils/format-output.js';

/**
 * Creates the help command with access to all commands for display
 */
export function createHelpCommand(getAllCommands: () => CommandDefinition[]): CommandDefinition {
    return {
        name: 'help',
        description: 'Show help information',
        usage: '/help [command]',
        category: 'General',
        aliases: ['h', '?'],
        handler: async (args: string[], _agent: DextoAgent): Promise<boolean | string> => {
            const allCommands = getAllCommands();

            if (args.length === 0) {
                // Build output string for ink-cli
                const outputLines: string[] = ['\n📋 Available Commands:\n'];

                // Define category order for consistent display
                const categoryOrder = [
                    'General',
                    'MCP Management',
                    'Tool Management',
                    'Prompt Management',
                    'System',
                    'Documentation',
                ];

                const categories: { [key: string]: CommandDefinition[] } = {};

                // Initialize categories
                for (const category of categoryOrder) {
                    categories[category] = [];
                }

                // Categorize commands using metadata
                for (const cmd of allCommands) {
                    const category = cmd.category || 'General';
                    if (!categories[category]) {
                        categories[category] = [];
                    }
                    categories[category]!.push(cmd);
                }

                // Build output by category in order
                for (const category of categoryOrder) {
                    const cmds = categories[category];
                    if (cmds && cmds.length > 0) {
                        outputLines.push(`${category}:`);
                        for (const cmd of cmds) {
                            const help = formatCommandHelp(cmd, false);
                            outputLines.push('  ' + formatForInkCli(help));
                        }
                        outputLines.push('');
                    }
                }

                // Display any uncategorized commands (fallback)
                for (const [category, cmds] of Object.entries(categories)) {
                    if (!categoryOrder.includes(category) && cmds.length > 0) {
                        outputLines.push(`${category}:`);
                        for (const cmd of cmds) {
                            const help = formatCommandHelp(cmd, false);
                            outputLines.push('  ' + formatForInkCli(help));
                        }
                        outputLines.push('');
                    }
                }

                outputLines.push('💡 Tips:');
                outputLines.push('   • Type your message normally (without /) to chat with the AI');
                outputLines.push('   • Use /<prompt-name> to execute any listed prompt directly');
                outputLines.push('   • Use /clear to start a new session (preserves old)');
                outputLines.push('   • Press Ctrl+M to switch models, Ctrl+R to switch sessions');
                outputLines.push('   • Use /search <query> to search across all sessions\n');
                const output = outputLines.join('\n');

                // Log for regular CLI (with chalk formatting)
                displayAllCommands(allCommands);

                return formatForInkCli(output);
            }

            const commandName = args[0];
            if (!commandName) {
                const output = '❌ No command specified';
                console.log(chalk.red(output));
                return formatForInkCli(output);
            }

            // Find the specific command to show detailed help
            const cmd = allCommands.find(
                (c) => c.name === commandName || (c.aliases && c.aliases.includes(commandName))
            );

            if (cmd) {
                const helpText = formatCommandHelp(cmd, true);
                console.log(helpText);
                return formatForInkCli(helpText);
            }

            // Redirect to contextual help for commands that have their own help subcommands
            let output: string;
            if (commandName === 'session') {
                output =
                    '💡 For detailed session help, use:\n   /session help\n\n   This shows all session subcommands with examples and tips.';
                console.log(chalk.blue('💡 For detailed session help, use:'));
                console.log(`   ${chalk.cyan('/session help')}`);
                console.log(
                    chalk.dim('\n   This shows all session subcommands with examples and tips.')
                );
                return formatForInkCli(output);
            }

            if (commandName === 'model' || commandName === 'm') {
                output =
                    '💡 For detailed model help, use:\n   /model help\n\n   This shows all model subcommands with examples and usage.';
                console.log(chalk.blue('💡 For detailed model help, use:'));
                console.log(`   ${chalk.cyan('/model help')}`);
                console.log(
                    chalk.dim('\n   This shows all model subcommands with examples and usage.')
                );
                return formatForInkCli(output);
            }

            if (commandName === 'mcp') {
                output =
                    '💡 For detailed MCP help, use:\n   /mcp help\n\n   This shows all MCP subcommands with examples and usage.';
                console.log(chalk.blue('💡 For detailed MCP help, use:'));
                console.log(`   ${chalk.cyan('/mcp help')}`);
                console.log(
                    chalk.dim('\n   This shows all MCP subcommands with examples and usage.')
                );
                return formatForInkCli(output);
            }

            output = `❓ No help available for: ${commandName}\nUse /help to see all available commands`;
            console.log(chalk.yellow(`❓ No help available for: ${commandName}`));
            console.log(chalk.dim('Use /help to see all available commands'));
            return formatForInkCli(output);
        },
    };
}

/**
 * General commands that are available across all contexts
 * Note: The help command is created separately to avoid circular dependencies
 */
export const generalCommands: CommandDefinition[] = [
    {
        name: 'exit',
        description: 'Exit the CLI',
        usage: '/exit',
        category: 'General',
        aliases: ['quit', 'q'],
        handler: async (_args: string[], _agent: DextoAgent): Promise<boolean | string> => {
            logger.warn('Exiting AI CLI. Goodbye!');
            process.exit(0);
        },
    },
    {
        name: 'clear',
        description: 'Start a new session (clears viewable history without deleting)',
        usage: '/clear',
        category: 'General',
        aliases: ['new'],
        handler: async (_args: string[], agent: DextoAgent): Promise<boolean | string> => {
            try {
                // Create a new session instead of deleting history
                // This clears the viewable conversation without deleting the old session
                const newSession = await agent.createSession();

                // Emit event for UI layers to handle session switching
                // This maintains separation: command does business logic, UI handles state
                agent.agentEventBus.emit('session:created', {
                    sessionId: newSession.id,
                    switchTo: true, // Signal that UI should switch to this session
                });

                const output = `🔄 Started new session: ${newSession.id.slice(0, 8)}\n💡 Previous session preserved. Use /resume to switch back.`;
                console.log(chalk.green(output));
                return formatForInkCli(output);
            } catch (error) {
                const errorMsg = `Failed to start new session: ${error instanceof Error ? error.message : String(error)}`;
                logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
];
