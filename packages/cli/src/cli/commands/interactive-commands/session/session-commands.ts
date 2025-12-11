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
import { CommandDefinition, CommandHandlerResult, getCLISessionId } from '../command-parser.js';
import { CommandOutputHelper } from '../utils/command-output.js';
import type {
    SessionListStyledData,
    SessionHistoryStyledData,
} from '../../../ink-cli/state/types.js';

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
            handler: async (args: string[], agent: DextoAgent): Promise<CommandHandlerResult> => {
                try {
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

                    // Build styled data
                    const sessions: SessionListStyledData['sessions'] = [];
                    for (const { id, metadata } of entries) {
                        if (!metadata) continue;
                        const isCurrent = current ? id === current.id : false;
                        sessions.push({
                            id,
                            messageCount: metadata.messageCount || 0,
                            lastActive: metadata.lastActivity
                                ? new Date(metadata.lastActivity).toLocaleString()
                                : 'Unknown',
                            isCurrent,
                        });
                    }

                    const styledData: SessionListStyledData = {
                        sessions,
                        total: sessionIds.length,
                    };

                    // Build fallback text
                    const fallbackLines: string[] = ['Sessions:'];
                    for (const session of sessions) {
                        const marker = session.isCurrent ? '> ' : '  ';
                        fallbackLines.push(
                            `${marker}${session.id.slice(0, 8)} - ${session.messageCount} messages`
                        );
                    }
                    fallbackLines.push(`Total: ${sessionIds.length} sessions`);

                    return CommandOutputHelper.styled(
                        'session-list',
                        styledData,
                        fallbackLines.join('\n')
                    );
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
            handler: async (args: string[], agent: DextoAgent): Promise<CommandHandlerResult> => {
                try {
                    // Use provided session ID or current session from CLI context
                    const currentSessionId = getCLISessionId(agent);
                    const sessionId = args.length > 0 && args[0] ? args[0] : currentSessionId;

                    if (!sessionId) {
                        return CommandOutputHelper.error(
                            new Error('No session available. Create a session first.')
                        );
                    }

                    const history = await agent.getSessionHistory(sessionId);

                    // Build styled data
                    const styledData: SessionHistoryStyledData = {
                        sessionId,
                        messages: history.map((msg) => ({
                            role: msg.role,
                            content:
                                typeof msg.content === 'string'
                                    ? msg.content
                                    : JSON.stringify(msg.content),
                            timestamp: msg.timestamp
                                ? new Date(msg.timestamp).toLocaleTimeString()
                                : '',
                        })),
                        total: history.length,
                    };

                    // Build fallback text
                    const fallbackLines: string[] = [`Session History: ${sessionId.slice(0, 8)}`];
                    if (history.length === 0) {
                        fallbackLines.push('  No messages in this session yet.');
                    } else {
                        for (const msg of history) {
                            const content =
                                typeof msg.content === 'string'
                                    ? msg.content
                                    : JSON.stringify(msg.content);
                            fallbackLines.push(`  [${msg.role}] ${content.slice(0, 50)}...`);
                        }
                        fallbackLines.push(`Total: ${history.length} messages`);
                    }

                    return CommandOutputHelper.styled(
                        'session-history',
                        styledData,
                        fallbackLines.join('\n')
                    );
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
    handler: async (args: string[], agent: DextoAgent): Promise<CommandHandlerResult> => {
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
    handler: async (args: string[], agent: DextoAgent): Promise<CommandHandlerResult> => {
        try {
            // Use provided session ID or current session from CLI context
            const currentSessionId = getCLISessionId(agent);
            const sessionId = args.length > 0 && args[0] ? args[0] : currentSessionId;

            if (!sessionId) {
                return CommandOutputHelper.error(
                    new Error('No session available. Create a session first.')
                );
            }

            const history = await agent.getSessionHistory(sessionId);

            // Build styled data
            const styledData: SessionHistoryStyledData = {
                sessionId,
                messages: history.map((msg) => ({
                    role: msg.role,
                    content:
                        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                    timestamp: msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '',
                })),
                total: history.length,
            };

            // Build fallback text
            const fallbackLines: string[] = [`Session History: ${sessionId.slice(0, 8)}`];
            if (history.length === 0) {
                fallbackLines.push('  No messages in this session yet.');
            } else {
                for (const msg of history) {
                    const content =
                        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                    fallbackLines.push(`  [${msg.role}] ${content.slice(0, 50)}...`);
                }
                fallbackLines.push(`Total: ${history.length} messages`);
            }

            return CommandOutputHelper.styled(
                'session-history',
                styledData,
                fallbackLines.join('\n')
            );
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
 * Standalone search command - opens interactive search overlay
 */
export const searchCommand: CommandDefinition = {
    name: 'search',
    description: 'Search messages across all sessions',
    usage: '/search',
    category: 'General',
    aliases: ['find'],
    handler: async (): Promise<boolean> => {
        // Interactive overlay handles everything - just return success
        return true;
    },
};
