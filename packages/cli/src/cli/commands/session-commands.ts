/**
 * Non-Interactive Session Management Commands
 *
 * This module provides CLI commands for managing sessions outside of interactive mode.
 * These commands allow users to manage sessions via direct CLI invocation.
 */

import chalk from 'chalk';
import { logger, DextoAgent, type SessionMetadata } from '@dexto/core';
import {
    formatSessionInfo,
    formatHistoryMessage,
} from './interactive-commands/session/helpers/formatters.js';

/**
 * Escape special regex characters in a string to prevent ReDoS attacks
 */
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
}

/**
 * List all available sessions
 */
export async function handleSessionListCommand(agent: DextoAgent): Promise<void> {
    try {
        console.log(chalk.bold.blue('\n📋 Sessions:\n'));

        const sessionIds = await agent.listSessions();
        const current = await getCurrentSessionInfo(agent);

        if (sessionIds.length === 0) {
            console.log(
                chalk.dim(
                    '  No sessions found. Run `dexto` to start a new session, or use `dexto -c`/`dexto -r <id>`.\n'
                )
            );
            return;
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
            const isCurrent = id === current.id;
            console.log(`  ${formatSessionInfo(id, metadata, isCurrent)}`);
            displayed++;
        }

        console.log(chalk.dim(`\n  Total: ${displayed} of ${sessionIds.length} sessions`));
        console.log(chalk.dim('  💡 Use `dexto -r <id>` to resume a session\n'));
    } catch (error) {
        logger.error(
            `Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`,
            null,
            'red'
        );
        throw error;
    }
}

/**
 * Show session history
 */
export async function handleSessionHistoryCommand(
    agent: DextoAgent,
    sessionId?: string
): Promise<void> {
    try {
        // Use provided session ID or current session
        const targetSessionId = sessionId || agent.getCurrentSessionId();
        await displaySessionHistory(targetSessionId, agent);
    } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
            console.log(chalk.red(`❌ Session not found: ${sessionId || 'current'}`));
            console.log(chalk.dim('   Use `dexto session list` to see available sessions'));
        } else {
            logger.error(
                `Failed to get session history: ${error instanceof Error ? error.message : String(error)}`,
                null,
                'red'
            );
        }
        throw error;
    }
}

/**
 * Delete a session
 */
export async function handleSessionDeleteCommand(
    agent: DextoAgent,
    sessionId: string
): Promise<void> {
    try {
        const current = await getCurrentSessionInfo(agent);

        // Check if trying to delete current session
        if (sessionId === current.id) {
            console.log(chalk.yellow('⚠️  Cannot delete the currently active session.'));
            console.log(chalk.dim('   Switch to another session first, then delete this one.'));
            return;
        }

        await agent.deleteSession(sessionId);
        console.log(chalk.green(`✅ Deleted session: ${chalk.bold(sessionId)}`));
    } catch (error) {
        logger.error(
            `Failed to delete session: ${error instanceof Error ? error.message : String(error)}`,
            null,
            'red'
        );
        throw error;
    }
}

/**
 * Search session history
 */
export async function handleSessionSearchCommand(
    agent: DextoAgent,
    query: string,
    options: {
        sessionId?: string;
        role?: 'user' | 'assistant' | 'system' | 'tool';
        limit?: number;
    } = {}
): Promise<void> {
    try {
        const searchOptions: {
            limit: number;
            sessionId?: string;
            role?: 'user' | 'assistant' | 'system' | 'tool';
        } = {
            limit: options.limit || 10,
        };

        if (options.sessionId) {
            searchOptions.sessionId = options.sessionId;
        }
        if (options.role) {
            const allowed = new Set(['user', 'assistant', 'system', 'tool']);
            if (!allowed.has(options.role)) {
                console.log(
                    chalk.red(
                        `❌ Invalid role: ${options.role}. Use one of: user, assistant, system, tool`
                    )
                );
                return;
            }
            searchOptions.role = options.role;
        }

        console.log(chalk.blue(`🔍 Searching for: "${query}"`));
        if (searchOptions.sessionId) {
            console.log(chalk.dim(`   Session: ${searchOptions.sessionId}`));
        }
        if (searchOptions.role) {
            console.log(chalk.dim(`   Role: ${searchOptions.role}`));
        }
        console.log(chalk.dim(`   Limit: ${searchOptions.limit}`));
        console.log();

        const results = await agent.searchMessages(query, searchOptions);

        if (results.results.length === 0) {
            console.log(chalk.yellow('📭 No messages found matching your search'));
            return;
        }

        console.log(
            chalk.green(`✅ Found ${results.total} result${results.total === 1 ? '' : 's'}`)
        );
        if (results.hasMore) {
            console.log(chalk.dim(`   Showing first ${results.results.length} results`));
        }
        console.log();

        // Precompile safe regex for highlighting (only if query is not empty)
        const highlightRegex = query.trim()
            ? new RegExp(`(${escapeRegExp(query.trim())})`, 'gi')
            : null;

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

            // Safe highlighting - only if we have a valid regex
            const highlightedContext = highlightRegex
                ? result.context.replace(highlightRegex, chalk.inverse('$1'))
                : result.context;

            console.log(`   ${highlightedContext}`);
            console.log();
        });

        if (results.hasMore) {
            console.log(chalk.dim('💡 Use --limit to see more results'));
        }
    } catch (error) {
        logger.error(
            `Search failed: ${error instanceof Error ? error.message : String(error)}`,
            null,
            'red'
        );
        throw error;
    }
}
