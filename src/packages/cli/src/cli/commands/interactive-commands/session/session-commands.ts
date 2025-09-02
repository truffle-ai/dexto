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
import { logger } from '@core/logger/index.js';
import { DextoAgent } from '@core/index.js';
import type { SessionMetadata } from '@core/index.js';
import { CommandDefinition } from '../command-parser.js';
import { formatSessionInfo, formatHistoryMessage } from './helpers/formatters.js';

/**
 * Helper to get current session info
 */
async function getCurrentSessionInfo(
    agent: DextoAgent
): Promise<{ id: string; metadata: SessionMetadata | undefined }> {
    const currentId = agent.getCurrentSessionId();
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
        chalk.dim('  💡 Use /clear to reset session or /session switch to change sessions\n')
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
            handler: async (args: string[], agent: DextoAgent) => {
                try {
                    console.log(chalk.bold.blue('\n📋 Sessions:\n'));

                    const sessionIds = await agent.listSessions();
                    const current = await getCurrentSessionInfo(agent);

                    if (sessionIds.length === 0) {
                        console.log(
                            chalk.dim('  No sessions found. Use /session new to create one.\n')
                        );
                        return true;
                    }

                    // Fetch metadata concurrently; errors do not abort listing
                    const entries = await Promise.all(
                        sessionIds.map(async (id) => {
                            try {
                                const metadata = await agent.getSessionMetadata(id);
                                return { id, metadata };
                            } catch (e) {
                                logger.error(
                                    `Failed to fetch metadata for session ${id}: ${e instanceof Error ? e.message : String(e)}`
                                );
                                return { id, metadata: undefined as SessionMetadata | undefined };
                            }
                        })
                    );

                    let displayed = 0;
                    for (const { id, metadata } of entries) {
                        if (!metadata) continue;
                        const isCurrent = id === current.id;
                        console.log(`  ${formatSessionInfo(id, metadata, isCurrent)}`);
                        displayed++;
                    }

                    console.log(
                        chalk.dim(`\n  Total: ${displayed} of ${sessionIds.length} sessions`)
                    );
                    console.log(chalk.dim('  💡 Use /session switch <id> to change sessions\n'));
                } catch (error) {
                    logger.error(
                        `Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
                return true;
            },
        },
        {
            name: 'new',
            description: 'Create a new session',
            usage: '/session new [id]',
            handler: async (args: string[], agent: DextoAgent) => {
                try {
                    const sessionId = args[0]; // Optional custom ID
                    const session = await agent.createSession(sessionId);

                    console.log(chalk.green(`✅ Created new session: ${chalk.bold(session.id)}`));

                    // Switch to the new session
                    await agent.loadSessionAsDefault(session.id);
                    console.log(chalk.yellow(`🔄 Switched to new session`));
                } catch (error) {
                    logger.error(
                        `Failed to create session: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
                return true;
            },
        },
        {
            name: 'switch',
            description: 'Switch to a different session',
            usage: '/session switch <id>',
            handler: async (args: string[], agent: DextoAgent) => {
                if (args.length === 0) {
                    console.log(chalk.red('❌ Session ID required. Usage: /session switch <id>'));
                    return true;
                }

                try {
                    const sessionId = args[0]!; // Safe to assert non-null since we checked args.length

                    await agent.loadSessionAsDefault(sessionId);

                    const metadata = await agent.getSessionMetadata(sessionId);
                    console.log(chalk.green(`✅ Switched to session: ${chalk.bold(sessionId)}`));

                    if (metadata && metadata.messageCount > 0) {
                        console.log(chalk.dim(`   ${metadata.messageCount} messages in history`));
                    } else {
                        console.log(chalk.dim('   New session - no previous messages'));
                    }
                } catch (error) {
                    logger.error(
                        `Failed to switch session: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
                return true;
            },
        },
        {
            name: 'current',
            description: 'Show current session',
            usage: '/session current',
            handler: async (args: string[], agent: DextoAgent) => {
                try {
                    const current = await getCurrentSessionInfo(agent);
                    console.log(chalk.blue('\n📍 Current Session:\n'));
                    console.log('  ' + formatSessionInfo(current.id, current.metadata, true));
                    console.log();
                } catch (error) {
                    logger.error(
                        `Failed to get current session: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
                return true;
            },
        },
        {
            name: 'history',
            description: 'Show session history for current session',
            usage: '/session history [sessionId]',
            aliases: ['h'],
            handler: async (args: string[], agent: DextoAgent) => {
                try {
                    // Use provided session ID or current session
                    const sessionId =
                        args.length > 0 && args[0] ? args[0] : agent.getCurrentSessionId();

                    await displaySessionHistory(sessionId, agent);
                } catch (error) {
                    if (error instanceof Error && error.message.includes('not found')) {
                        console.log(chalk.red(`❌ Session not found: ${args[0] || 'current'}`));
                        console.log(chalk.dim('   Use /session list to see available sessions'));
                    } else {
                        logger.error(
                            `Failed to get session history: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }
                return true;
            },
        },
        {
            name: 'delete',
            description: 'Delete a session',
            usage: '/session delete <id>',
            handler: async (args: string[], agent: DextoAgent) => {
                if (args.length === 0) {
                    console.log(chalk.red('❌ Session ID required. Usage: /session delete <id>'));
                    return true;
                }

                try {
                    const sessionId = args[0]!; // Safe to assert non-null since we checked args.length

                    const current = await getCurrentSessionInfo(agent);

                    // Check if trying to delete current session
                    if (sessionId === current.id) {
                        console.log(
                            chalk.yellow('⚠️  Cannot delete the currently active session.')
                        );
                        console.log(
                            chalk.dim('   Switch to another session first, then delete this one.')
                        );
                        return true;
                    }

                    await agent.deleteSession(sessionId);
                    console.log(chalk.green(`✅ Deleted session: ${chalk.bold(sessionId)}`));
                } catch (error) {
                    logger.error(
                        `Failed to delete session: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
                return true;
            },
        },
        {
            name: 'help',
            description: 'Show detailed help for session commands',
            usage: '/session help',
            handler: async (_args: string[], _agent: DextoAgent) => {
                console.log(chalk.bold.blue('\n📋 Session Management Commands:\n'));

                console.log(chalk.cyan('Available subcommands:'));
                console.log(
                    `  ${chalk.yellow('/session list')} - List all sessions with their status and activity`
                );
                console.log(
                    `  ${chalk.yellow('/session new')} ${chalk.blue('[name]')} - Create a new session (optional custom name)`
                );
                console.log(
                    `  ${chalk.yellow('/session switch')} ${chalk.blue('<id>')} - Switch to a different session`
                );
                console.log(
                    `  ${chalk.yellow('/session current')} - Show current session info and message count`
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
                console.log(chalk.dim('💡 Use /session switch <id> to change sessions'));
                console.log(chalk.dim('💡 Session names can be custom or auto-generated UUIDs\n'));

                return true;
            },
        },
    ],
    handler: async (args: string[], agent: DextoAgent) => {
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
        console.log(
            chalk.dim('Available subcommands: list, new, switch, current, history, delete, help')
        );
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
    handler: async (args: string[], agent: DextoAgent) => {
        try {
            // Use provided session ID or current session
            const sessionId = args.length > 0 && args[0] ? args[0] : agent.getCurrentSessionId();

            await displaySessionHistory(sessionId, agent);
        } catch (error) {
            if (error instanceof Error && error.message.includes('not found')) {
                console.log(chalk.red(`❌ Session not found: ${args[0] || 'current'}`));
                console.log(chalk.dim('   Use /session list to see available sessions'));
            } else {
                logger.error(
                    `Failed to get session history: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
        return true;
    },
};

/**
 * Standalone search command for quick access
 */
export const searchCommand: CommandDefinition = {
    name: 'search',
    description: 'Search session history',
    usage: '/search <query> [options]',
    category: 'Session Management',
    aliases: ['find'],
    handler: async (args: string[], agent: DextoAgent) => {
        if (args.length === 0) {
            console.log(chalk.red('❌ Search query is required'));
            console.log(
                chalk.dim(
                    'Usage: /search <query> [--session <sessionId>] [--role <role>] [--limit <number>]'
                )
            );
            console.log(chalk.dim('Examples:'));
            console.log(chalk.dim('  /search "hello world"'));
            console.log(chalk.dim('  /search error --role assistant'));
            console.log(chalk.dim('  /search deploy --session abc123'));
            return true;
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
                console.log(chalk.red('❌ Search query is required'));
                return true;
            }

            console.log(chalk.blue(`🔍 Searching for: "${query}"`));
            if (options.sessionId) {
                console.log(chalk.dim(`   Session: ${options.sessionId}`));
            }
            if (options.role) {
                console.log(chalk.dim(`   Role: ${options.role}`));
            }
            console.log(chalk.dim(`   Limit: ${options.limit}`));
            console.log();

            const results = await agent.searchMessages(query, options);

            if (results.results.length === 0) {
                console.log(chalk.yellow('📭 No messages found matching your search'));
                return true;
            }

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
                    `${chalk.dim(`${index + 1}.`)} ${chalk.cyan(result.sessionId)} ${roleColor(`[${result.message.role}]`)}`
                );
                console.log(
                    `   ${result.context.replace(new RegExp(`(${query})`, 'gi'), chalk.inverse('$1'))}`
                );
                console.log();
            });

            if (results.hasMore) {
                console.log(chalk.dim('💡 Use --limit to see more results'));
            }
        } catch (error) {
            logger.error(
                `Search failed: ${error instanceof Error ? error.message : String(error)}`
            );
            console.log(chalk.red('❌ Search failed. Please try again.'));
        }
        return true;
    },
};
