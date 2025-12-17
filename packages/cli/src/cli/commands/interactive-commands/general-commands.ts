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
import type { DextoAgent } from '@dexto/core';
import type { CommandDefinition, CommandHandlerResult, CommandContext } from './command-parser.js';
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
        usage: '/help',
        category: 'General',
        aliases: ['h', '?'],
        handler: async (
            _args: string[],
            _agent: DextoAgent,
            _ctx: CommandContext
        ): Promise<CommandHandlerResult> => {
            const allCommands = getAllCommands();

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

            return CommandOutputHelper.styled('help', styledData, fallbackLines.join('\n'));
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
            console.log(chalk.yellow('Exiting AI CLI. Goodbye!'));
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
                    return formatForInkCli('⚠️  No active session to clear');
                }

                // Clear context window - adds a marker so filterCompacted skips prior messages
                // History stays in DB for review, but LLM won't see it
                await agent.clearContext(sessionId);

                return formatForInkCli(
                    '🔄 Context cleared\n💡 Previous messages preserved in history but not sent to LLM.'
                );
            } catch (error) {
                const errorMsg = `Failed to clear context: ${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(errorMsg);
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
                    return formatForInkCli('❌ No active session');
                }

                // Get session history
                const history = await agent.getSessionHistory(sessionId);
                if (!history || history.length === 0) {
                    return formatForInkCli('❌ No messages in current session');
                }

                // Find the last assistant message
                const lastAssistantMessage = [...history]
                    .reverse()
                    .find((msg) => msg.role === 'assistant');

                if (!lastAssistantMessage) {
                    return formatForInkCli('❌ No assistant response to copy');
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
                    return formatForInkCli('❌ No text content to copy');
                }

                // Copy to clipboard
                const success = await writeToClipboard(textContent);
                if (success) {
                    const preview =
                        textContent.length > 50
                            ? textContent.substring(0, 50) + '...'
                            : textContent;
                    return formatForInkCli(
                        `📋 Copied to clipboard (${textContent.length} chars)\n${preview.replace(/\n/g, ' ')}`
                    );
                } else {
                    return formatForInkCli('❌ Failed to copy to clipboard');
                }
            } catch (error) {
                const errorMsg = `Failed to copy: ${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(errorMsg);
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
                            { keys: 'Ctrl+R', description: 'Search history (enter search mode)' },
                            { keys: 'Tab', description: 'Autocomplete command' },
                            { keys: 'Ctrl+U', description: 'Clear input line' },
                            { keys: 'Ctrl+W', description: 'Delete word before cursor' },
                            { keys: 'Ctrl+A', description: 'Move cursor to start' },
                            { keys: 'Ctrl+E', description: 'Move cursor to end' },
                        ],
                    },
                    {
                        name: 'History Search (after Ctrl+R)',
                        shortcuts: [
                            { keys: 'Ctrl+R', description: 'Next older match' },
                            { keys: 'Ctrl+E', description: 'Next newer match' },
                            { keys: 'Enter', description: 'Accept and exit search' },
                            { keys: 'Escape', description: 'Cancel search' },
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
