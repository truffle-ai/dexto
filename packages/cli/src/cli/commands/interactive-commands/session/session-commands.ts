/**
 * Session Management Commands
 *
 * This module contains all session-related CLI commands.
 * These commands provide functionality for managing chat sessions, viewing history,
 * and searching sessions.
 *
 * Session Commands:
 * - list: List all available sessions with metadata
 * - new: Create a new session with optional custom ID
 * - switch: Switch to a different session
 * - current: Show current active session info
 * - delete: Delete a session (cannot delete active session)
 * - help: Show detailed help for session commands
 *
 * History Commands:
 * - history: Show session history for current/specified session
 * - search: Search session history across sessions
 */

import chalk from 'chalk';
import { logger, DextoAgent, type SessionMetadata } from '@dexto/core';
import { CommandDefinition, getCLISessionId } from '../command-parser.js';
import { formatSessionInfo, formatHistoryMessage } from '../../helpers/formatters.js';
import { CommandOutputHelper } from '../utils/command-output.js';

/**
 * Escape special regex characters in a string to prevent ReDoS attacks
 */
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Helper to get current session info from CLI context
 */
async function getCurrentSessionInfo(
    agent: DextoAgent
): Promise<{ id: string; metadata: SessionMetadata | undefined } | null> {
    const currentId = getCLISessionId(agent);
    if (!currentId) {
        return null;
    }
    const metadata = await agent.getSessionMetadata(currentId);
    return { id: currentId, metadata };
}

/**
 * Helper to display session history with consistent formatting
 */
async function displaySessionHistory(sessionId: string, agent: DextoAgent): Promise<void> {
    console.log(chalk.blue(`\n💬 Session History for: ${chalk.bold(sessionId)}\n`));

    const history = await agent.getSessionHistory(sessionId);

    if (history.length === 0) {
        console.log(chalk.dim('  No messages in this session yet.\n'));
        return;
    }

    // Display each message with formatting
    history.forEach((message, index) => {
        console.log(formatHistoryMessage(message, index));
    });

    console.log(chalk.dim(`\n  Total: ${history.length} messages`));
    console.log(
        chalk.dim(
            '  💡 Use /clear to reset session or dexto -r <id> to resume a different session\n'
        )
    );
}

/**
 * Session management commands
 */
export const sessionCommand: CommandDefinition = {
    name: 'session',
    description: 'Manage chat sessions',
    usage: '/session <subcommand> [args]',
    category: 'Session Management',
    aliases: ['s'],
    subcommands: [
        {
            name: 'list',
            description: 'List all sessions',
            usage: '/session list',
            handler: async (args: string[], agent: DextoAgent): Promise<boolean | string> => {
                try {
                    console.log(chalk.bold.blue('\n📋 Sessions:\n'));

                    const sessionIds = await agent.listSessions();
                    const current = await getCurrentSessionInfo(agent);

                    if (sessionIds.length === 0) {
                        return CommandOutputHelper.info(
                            '📋 No sessions found.\n  Run `dexto` to start a new session, or use `dexto -r <id>` to resume.'
                        );
                    }

                    // Fetch metadata concurrently; errors do not abort listing
                    const entries = await Promise.all(
                        sessionIds.map(async (id) => {
                            try {
                                const metadata = await agent.getSessionMetadata(id);
                                return { id, metadata };
                            } catch (e) {
                                logger.error(
                                    `Failed to fetch metadata for session ${id}: ${e instanceof Error ? e.message : String(e)}`,
                                    null,
                                    'red'
                                );
                                return { id, metadata: undefined as SessionMetadata | undefined };
                            }
                        })
                    );

                    let displayed = 0;
                    for (const { id, metadata } of entries) {
                        if (!metadata) continue;
                        const isCurrent = current ? id === current.id : false;
                        console.log(`  ${formatSessionInfo(id, metadata, isCurrent)}`);
                        displayed++;
                    }

                    console.log(
                        chalk.dim(`\n  Total: ${displayed} of ${sessionIds.length} sessions`)
                    );
                    console.log(chalk.dim('  💡 Use /resume to pick a session\n'));
                    return CommandOutputHelper.noOutput(); // List is displayed above
                } catch (error) {
                    return CommandOutputHelper.error(error, 'Failed to list sessions');
                }
            },
        },
        {
            name: 'history',
            description: 'Show session history for current session',
            usage: '/session history [sessionId]',
            aliases: ['h'],
            handler: async (args: string[], agent: DextoAgent): Promise<boolean | string> => {
                try {
                    // Use provided session ID or current session from CLI context
                    const currentSessionId = getCLISessionId(agent);
                    const sessionId = args.length > 0 && args[0] ? args[0] : currentSessionId;

                    if (!sessionId) {
                        return CommandOutputHelper.error(
                            new Error('No session available. Create a session first.')
                        );
                    }

                    await displaySessionHistory(sessionId, agent);
                    return CommandOutputHelper.noOutput(); // History is displayed by displaySessionHistory
                } catch (error) {
                    if (error instanceof Error && error.message.includes('not found')) {
                        return CommandOutputHelper.error(
                            new Error(
                                `Session not found: ${args[0] || 'current'}\n   Use /session list to see available sessions`
                            )
                        );
                    }
                    return CommandOutputHelper.error(error, 'Failed to get session history');
                }
            },
        },
        {
            name: 'delete',
            description: 'Delete a session',
            usage: '/session delete <id>',
            handler: async (args: string[], agent: DextoAgent): Promise<boolean | string> => {
                const validationError = CommandOutputHelper.validateRequiredArg(
                    args,
                    0,
                    'Session ID',
                    '/session delete <id>'
                );
                if (validationError) return validationError;

                const sessionId = args[0]!;
                try {
                    const current = await getCurrentSessionInfo(agent);

                    // Check if trying to delete current session
                    if (current && sessionId === current.id) {
                        return CommandOutputHelper.warning(
                            '⚠️  Cannot delete the currently active session.\n   Switch to another session first, then delete this one.'
                        );
                    }

                    await agent.deleteSession(sessionId);
                    return CommandOutputHelper.success(
                        `✅ Deleted session: ${sessionId.slice(0, 8)}`
                    );
                } catch (error) {
                    return CommandOutputHelper.error(error, 'Failed to delete session');
                }
            },
        },
        {
            name: 'help',
            description: 'Show detailed help for session commands',
            usage: '/session help',
            handler: async (_args: string[], _agent: DextoAgent): Promise<boolean | string> => {
                const helpText = [
                    '\n📋 Session Management Commands:\n',
                    'Available subcommands:',
                    '  /session list - List all sessions with their status and activity',
                    '  /session history [sessionId] - Display session history',
                    '  /session delete <id> - Delete a session (cannot delete active session)',
                    '  /session help - Show this help message',
                    '\n💡 Sessions allow you to maintain separate chat sessions',
                    '💡 Use /resume to switch between sessions',
                    '💡 Use /clear to start a new session (preserves old sessions)\n',
                ].join('\n');

                console.log(chalk.bold.blue('\n📋 Session Management Commands:\n'));

                console.log(chalk.cyan('Available subcommands:'));
                console.log(
                    `  ${chalk.yellow('/session list')} - List all sessions with their status and activity`
                );
                console.log(
                    `  ${chalk.yellow('/session history')} - Display session history for current session`
                );
                console.log(
                    `  ${chalk.yellow('/session delete')} ${chalk.blue('<id>')} - Delete a session (cannot delete active session)`
                );
                console.log(`  ${chalk.yellow('/session help')} - Show this help message`);

                console.log(
                    chalk.dim('\n💡 Sessions allow you to maintain separate chat sessions')
                );
                console.log(chalk.dim('💡 Use /resume to switch between sessions'));
                console.log(
                    chalk.dim('💡 Use /clear to start a new session (preserves old sessions)\n')
                );

                return helpText;
            },
        },
    ],
    handler: async (args: string[], agent: DextoAgent): Promise<boolean | string> => {
        // Default to help if no subcommand
        if (args.length === 0) {
            const helpSubcommand = sessionCommand.subcommands?.find((s) => s.name === 'help');
            if (helpSubcommand) {
                return helpSubcommand.handler([], agent);
            }
            return true;
        }

        const subcommand = args[0];
        const subArgs = args.slice(1);

        // Find matching subcommand
        const subcmd = sessionCommand.subcommands?.find((s) => s.name === subcommand);
        if (subcmd) {
            return subcmd.handler(subArgs, agent);
        }

        console.log(chalk.red(`❌ Unknown session subcommand: ${subcommand}`));
        console.log(chalk.dim('Available subcommands: list, history, delete, help'));
        console.log(chalk.dim('💡 Use /session help for detailed command descriptions'));
        return true;
    },
};

/**
 * Standalone history command for quick access
 */
export const historyCommand: CommandDefinition = {
    name: 'history',
    description: 'Show session history',
    usage: '/history [sessionId]',
    category: 'Session Management',
    aliases: ['hist'],
    handler: async (args: string[], agent: DextoAgent): Promise<boolean | string> => {
        try {
            // Use provided session ID or current session from CLI context
            const currentSessionId = getCLISessionId(agent);
            const sessionId = args.length > 0 && args[0] ? args[0] : currentSessionId;

            if (!sessionId) {
                return CommandOutputHelper.error(
                    new Error('No session available. Create a session first.')
                );
            }

            await displaySessionHistory(sessionId, agent);
            return CommandOutputHelper.noOutput();
        } catch (error) {
            if (error instanceof Error && error.message.includes('not found')) {
                return CommandOutputHelper.error(
                    new Error(
                        `Session not found: ${args[0] || 'current'}\n   Use /session list to see available sessions`
                    )
                );
            }
            return CommandOutputHelper.error(error, 'Failed to get session history');
        }
    },
};

/**
 * Resume command - shows interactive session selector
 * Note: In interactive CLI, this always shows the selector (args ignored)
 * For headless CLI, use `dexto -r <sessionId>` instead
 */
export const resumeCommand: CommandDefinition = {
    name: 'resume',
    description: 'Switch to a different session (interactive selector)',
    usage: '/resume',
    category: 'General',
    aliases: ['r'],
    handler: async (_args: string[], _agent: DextoAgent): Promise<boolean | string> => {
        // In interactive CLI, /resume always triggers the interactive selector
        // The selector is shown via detectInteractiveSelector in inputParsing.ts
        // This handler should not be called in ink-cli (selector shows instead)
        const helpText = [
            '📋 Resume Session',
            '\nType /resume to show the session selector\n',
        ].join('\n');

        console.log(chalk.blue(helpText));
        return helpText;
    },
};

/**
 * Standalone search command for quick access
 */
export const searchCommand: CommandDefinition = {
    name: 'search',
    description: 'Search messages across all sessions (or specific session)',
    usage: '/search <query> [--session <id>] [--role <user|assistant>] [--limit <n>]',
    category: 'General',
    aliases: ['find'],
    handler: async (args: string[], agent: DextoAgent): Promise<boolean | string> => {
        if (args.length === 0) {
            const helpText = [
                '\n🔍 Search Session History:\n',
                'Usage:',
                '  /search <query> [--session <sessionId>] [--role <role>] [--limit <number>]',
                '\nExamples:',
                '  /search "hello world"           # Search all sessions',
                '  /search error --role assistant  # Search assistant messages',
                '  /search deploy --session abc123 # Search specific session',
                '  /search bug --limit 20          # Show up to 20 results',
                '\nOptions:',
                '  --session <id>  Search only in specific session',
                '  --role <role>   Filter by role (user, assistant, system, tool)',
                '  --limit <n>     Max results to show (default: 10)\n',
            ].join('\n');

            console.log(chalk.bold.blue('\n🔍 Search Session History:\n'));
            console.log(chalk.cyan('Usage:'));
            console.log(
                chalk.dim(
                    '  /search <query> [--session <sessionId>] [--role <role>] [--limit <number>]'
                )
            );
            console.log(chalk.cyan('\nExamples:'));
            console.log(chalk.dim('  /search "hello world"           # Search all sessions'));
            console.log(chalk.dim('  /search error --role assistant  # Search assistant messages'));
            console.log(chalk.dim('  /search deploy --session abc123 # Search specific session'));
            console.log(chalk.dim('  /search bug --limit 20          # Show up to 20 results'));
            console.log(chalk.cyan('\nOptions:'));
            console.log(chalk.dim('  --session <id>  Search only in specific session'));
            console.log(
                chalk.dim('  --role <role>   Filter by role (user, assistant, system, tool)')
            );
            console.log(chalk.dim('  --limit <n>     Max results to show (default: 10)\n'));

            return helpText;
        }

        try {
            // Parse arguments
            const options: {
                limit: number;
                sessionId?: string;
                role?: 'user' | 'assistant' | 'system' | 'tool';
            } = { limit: 10 };
            let query = '';
            let i = 0;

            while (i < args.length) {
                const arg = args[i];
                if (arg === '--session' && i + 1 < args.length) {
                    const sessionValue = args[i + 1];
                    if (sessionValue) {
                        options.sessionId = sessionValue;
                    }
                    i += 2;
                } else if (arg === '--role' && i + 1 < args.length) {
                    const roleValue = args[i + 1] as 'user' | 'assistant' | 'system' | 'tool';
                    if (roleValue && ['user', 'assistant', 'system', 'tool'].includes(roleValue)) {
                        options.role = roleValue;
                    }
                    i += 2;
                } else if (arg === '--limit' && i + 1 < args.length) {
                    const limitValue = args[i + 1];
                    options.limit = limitValue ? parseInt(limitValue) || 10 : 10;
                    i += 2;
                } else {
                    if (!arg) {
                        i++;
                        continue;
                    }
                    // Remove surrounding quotes if present
                    let cleanArg = arg;
                    if (
                        cleanArg &&
                        ((cleanArg.startsWith('"') && cleanArg.endsWith('"')) ||
                            (cleanArg.startsWith("'") && cleanArg.endsWith("'")))
                    ) {
                        cleanArg = cleanArg.slice(1, -1);
                    }
                    query += (query ? ' ' : '') + cleanArg;
                    i++;
                }
            }

            if (!query.trim()) {
                return CommandOutputHelper.error(new Error('Search query is required'));
            }

            const results = await agent.searchMessages(query, options);

            if (results.results.length === 0) {
                const noResultsMsg = `📭 No messages found matching: "${query}"`;
                console.log(chalk.yellow(noResultsMsg));
                return noResultsMsg;
            }

            // Build output string for ink-cli
            const outputLines: string[] = [];
            outputLines.push(`\n🔍 Search results for: "${query}"`);
            if (options.sessionId) {
                outputLines.push(`   Session: ${options.sessionId}`);
            }
            if (options.role) {
                outputLines.push(`   Role: ${options.role}`);
            }
            outputLines.push(`   Limit: ${options.limit}\n`);
            outputLines.push(`✅ Found ${results.total} result${results.total === 1 ? '' : 's'}`);
            if (results.hasMore) {
                outputLines.push(`   Showing first ${results.results.length} results`);
            }
            outputLines.push('');

            // Console output header for regular CLI
            console.log(chalk.blue(`🔍 Searching for: "${query}"`));
            if (options.sessionId) {
                console.log(chalk.dim(`   Session: ${options.sessionId}`));
            }
            if (options.role) {
                console.log(chalk.dim(`   Role: ${options.role}`));
            }
            console.log(chalk.dim(`   Limit: ${options.limit}`));
            console.log();
            console.log(
                chalk.green(`✅ Found ${results.total} result${results.total === 1 ? '' : 's'}`)
            );
            if (results.hasMore) {
                console.log(chalk.dim(`   Showing first ${results.results.length} results`));
            }
            console.log();

            // Display results
            results.results.forEach((result, index) => {
                const roleColor =
                    result.message.role === 'user'
                        ? chalk.blue
                        : result.message.role === 'assistant'
                          ? chalk.green
                          : chalk.yellow;

                console.log(
                    `${chalk.dim(`${index + 1}.`)} ${chalk.cyan(result.sessionId.slice(0, 8))} ${roleColor(`[${result.message.role}]`)}`
                );
                console.log(
                    `   ${result.context.replace(new RegExp(`(${escapeRegExp(query.trim().slice(0, 256))})`, 'gi'), chalk.inverse('$1'))}`
                );
                console.log();

                // For ink-cli output (without color codes)
                outputLines.push(
                    `${index + 1}. ${result.sessionId.slice(0, 8)} [${result.message.role}]`
                );
                outputLines.push(`   ${result.context}`);
                outputLines.push('');
            });

            if (results.hasMore) {
                outputLines.push('💡 Use --limit to see more results');
                console.log(chalk.dim('💡 Use --limit to see more results'));
            }

            const output = outputLines.join('\n');

            return output;
        } catch (error) {
            return CommandOutputHelper.error(error, 'Search failed');
        }
    },
};
