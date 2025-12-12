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
import type { CommandDefinition, CommandHandlerResult, CommandContext } from './command-parser.js';
import { formatCommandHelp } from './command-parser.js';
import { formatForInkCli } from './utils/format-output.js';
import { CommandOutputHelper } from './utils/command-output.js';
import type { HelpStyledData, ShortcutsStyledData } from '../../ink-cli/state/types.js';
import { writeToClipboard } from '../../ink-cli/utils/clipboardUtils.js';

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
        handler: async (
            args: string[],
            _agent: DextoAgent,
            _ctx: CommandContext
        ): Promise<CommandHandlerResult> => {
            const allCommands = getAllCommands();

            if (args.length === 0) {
                // Build styled data for help
                const styledData: HelpStyledData = {
                    commands: allCommands.map((cmd) => ({
                        name: cmd.name,
                        description: cmd.description,
                        category: cmd.category || 'General',
                    })),
                };

                // Build fallback text
                const fallbackLines: string[] = ['Available Commands:'];
                for (const cmd of allCommands) {
                    fallbackLines.push(`  /${cmd.name} - ${cmd.description}`);
                }

                // NOTE: Don't call displayAllCommands() here - it uses console.log which
                // interferes with Ink's rendering. The styled output will be rendered by Ink.

                return CommandOutputHelper.styled('help', styledData, fallbackLines.join('\n'));
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
        handler: async (
            _args: string[],
            _agent: DextoAgent,
            _ctx: CommandContext
        ): Promise<boolean | string> => {
            logger.warn('Exiting AI CLI. Goodbye!');
            process.exit(0);
        },
    },
    {
        name: 'clear',
        description: 'Clear context window (history preserved in DB, not sent to LLM)',
        usage: '/clear',
        category: 'General',
        aliases: ['new'],
        handler: async (
            _args: string[],
            agent: DextoAgent,
            ctx: CommandContext
        ): Promise<boolean | string> => {
            try {
                const { sessionId } = ctx;
                if (!sessionId) {
                    const output = '⚠️  No active session to clear';
                    console.log(chalk.yellow(output));
                    return formatForInkCli(output);
                }

                // Clear context window - adds a marker so filterCompacted skips prior messages
                // History stays in DB for review, but LLM won't see it
                await agent.clearContext(sessionId);

                const output = `🔄 Context cleared\n💡 Previous messages preserved in history but not sent to LLM.`;
                console.log(chalk.green(output));
                return formatForInkCli(output);
            } catch (error) {
                const errorMsg = `Failed to clear context: ${error instanceof Error ? error.message : String(error)}`;
                logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'copy',
        description: 'Copy the last assistant response to clipboard',
        usage: '/copy',
        category: 'General',
        aliases: ['cp'],
        handler: async (
            _args: string[],
            agent: DextoAgent,
            ctx: CommandContext
        ): Promise<boolean | string> => {
            try {
                const { sessionId } = ctx;
                if (!sessionId) {
                    const output = '❌ No active session';
                    console.log(chalk.red(output));
                    return formatForInkCli(output);
                }

                // Get session history
                const history = await agent.getSessionHistory(sessionId);
                if (!history || history.length === 0) {
                    const output = '❌ No messages in current session';
                    console.log(chalk.red(output));
                    return formatForInkCli(output);
                }

                // Find the last assistant message
                const lastAssistantMessage = [...history]
                    .reverse()
                    .find((msg) => msg.role === 'assistant');

                if (!lastAssistantMessage) {
                    const output = '❌ No assistant response to copy';
                    console.log(chalk.yellow(output));
                    return formatForInkCli(output);
                }

                // Extract text content from the message
                let textContent = '';
                if (typeof lastAssistantMessage.content === 'string') {
                    textContent = lastAssistantMessage.content;
                } else if (Array.isArray(lastAssistantMessage.content)) {
                    // Handle multi-part content
                    textContent = lastAssistantMessage.content
                        .filter(
                            (part): part is { type: 'text'; text: string } => part.type === 'text'
                        )
                        .map((part) => part.text)
                        .join('\n');
                }

                if (!textContent) {
                    const output = '❌ No text content to copy';
                    console.log(chalk.yellow(output));
                    return formatForInkCli(output);
                }

                // Copy to clipboard
                const success = await writeToClipboard(textContent);
                if (success) {
                    const preview =
                        textContent.length > 50
                            ? textContent.substring(0, 50) + '...'
                            : textContent;
                    const output = `📋 Copied to clipboard (${textContent.length} chars)\n${chalk.dim(preview.replace(/\n/g, ' '))}`;
                    console.log(chalk.green('📋 Copied to clipboard'));
                    return formatForInkCli(output);
                } else {
                    const output = '❌ Failed to copy to clipboard';
                    console.log(chalk.red(output));
                    return formatForInkCli(output);
                }
            } catch (error) {
                const errorMsg = `Failed to copy: ${error instanceof Error ? error.message : String(error)}`;
                logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'shortcuts',
        description: 'Show keyboard shortcuts',
        usage: '/shortcuts',
        category: 'General',
        aliases: ['keys', 'hotkeys'],
        handler: async (
            _args: string[],
            _agent: DextoAgent,
            _ctx: CommandContext
        ): Promise<CommandHandlerResult> => {
            const styledData: ShortcutsStyledData = {
                categories: [
                    {
                        name: 'Global',
                        shortcuts: [
                            { keys: 'Ctrl+C', description: 'Clear input, then exit (press twice)' },
                            { keys: 'Escape', description: 'Cancel processing / close overlay' },
                        ],
                    },
                    {
                        name: 'Input',
                        shortcuts: [
                            { keys: 'Enter', description: 'Submit message' },
                            { keys: 'Shift+Enter', description: 'New line (multi-line input)' },
                            { keys: 'Up/Down', description: 'Navigate input history' },
                            { keys: 'Ctrl+R', description: 'Search history (older match)' },
                            { keys: 'Ctrl+E', description: 'Search history (newer match)' },
                            { keys: 'Tab', description: 'Autocomplete command' },
                            { keys: 'Ctrl+U', description: 'Clear input line' },
                            { keys: 'Ctrl+W', description: 'Delete word before cursor' },
                            { keys: 'Ctrl+A', description: 'Move cursor to start' },
                            { keys: 'Ctrl+E', description: 'Move cursor to end' },
                        ],
                    },
                    {
                        name: 'Autocomplete & Selectors',
                        shortcuts: [
                            { keys: 'Up/Down', description: 'Navigate options' },
                            { keys: 'Enter', description: 'Select / execute' },
                            { keys: 'Tab', description: 'Load command into input' },
                            { keys: 'Escape', description: 'Close overlay' },
                        ],
                    },
                    {
                        name: 'Tool Approval',
                        shortcuts: [
                            { keys: 'y', description: 'Allow once' },
                            { keys: 'a', description: 'Allow for session' },
                            { keys: 'n', description: 'Deny' },
                            { keys: 'Escape', description: 'Cancel' },
                        ],
                    },
                ],
            };

            // Build fallback text
            const fallbackLines: string[] = ['Keyboard Shortcuts:'];
            for (const category of styledData.categories) {
                fallbackLines.push(`\n${category.name}:`);
                for (const shortcut of category.shortcuts) {
                    fallbackLines.push(`  ${shortcut.keys.padEnd(14)} ${shortcut.description}`);
                }
            }

            return CommandOutputHelper.styled('shortcuts', styledData, fallbackLines.join('\n'));
        },
    },
];
