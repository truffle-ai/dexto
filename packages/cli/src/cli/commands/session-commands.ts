/**
 * Non-Interactive Session Management Commands
 *
 * This module provides CLI commands for managing sessions outside of interactive mode.
 * These commands allow users to manage sessions via direct CLI invocation.
 */

import chalk from 'chalk';
import { logger, DextoAgent, type SessionMetadata } from '@dexto/core';
import { formatHistoryMessage } from './helpers/formatters.js';

/**
 * Helper to get most recent session info (for non-interactive CLI)
 * Non-interactive commands don't have a "current session" concept,
 * so we use the most recently active session as a sensible default.
 */
async function getMostRecentSessionInfo(
    agent: DextoAgent
): Promise<{ id: string; metadata: SessionMetadata | undefined } | null> {
    const sessionIds = await agent.listSessions();
    if (sessionIds.length === 0) {
        return null;
    }

    // Find most recently active session
    let mostRecentId: string | null = null;
    let mostRecentActivity = 0;

    for (const sessionId of sessionIds) {
        const metadata = await agent.getSessionMetadata(sessionId);
        if (metadata && metadata.lastActivity > mostRecentActivity) {
            mostRecentActivity = metadata.lastActivity;
            mostRecentId = sessionId;
        }
    }

    if (!mostRecentId) {
        return null;
    }

    const metadata = await agent.getSessionMetadata(mostRecentId);
    return { id: mostRecentId, metadata };
}

/**
 * Helper to display session history with consistent formatting
 */
async function displaySessionHistory(sessionId: string, agent: DextoAgent): Promise<void> {
    console.log(chalk.blue(`\n💬 Session History for: ${chalk.bold(sessionId)}\n`));

    const history = await agent.getSessionHistory(sessionId);

    if (history.length === 0) {
        console.log(chalk.gray('  No messages in this session yet.\n'));
        return;
    }

    // Display each message with formatting
    history.forEach((message, index) => {
        console.log(formatHistoryMessage(message, index));
    });

    console.log(chalk.gray(`\n  Total: ${history.length} messages`));
}

/**
 * Show session history
 */
export async function handleSessionHistoryCommand(
    agent: DextoAgent,
    sessionId?: string
): Promise<void> {
    try {
        // Use provided session ID or most recent session
        let targetSessionId = sessionId;
        if (!targetSessionId) {
            const recentSession = await getMostRecentSessionInfo(agent);
            if (!recentSession) {
                console.log(chalk.red('❌ No sessions found'));
                console.log(chalk.gray('   Create a session first by running: dexto'));
                throw new Error('No sessions found');
            }
            targetSessionId = recentSession.id;
            console.log(chalk.gray(`Using most recent session: ${targetSessionId}\n`));
        }

        await displaySessionHistory(targetSessionId, agent);
    } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
            console.log(chalk.red(`❌ Session not found: ${sessionId || 'current'}`));
            console.log(chalk.gray('   Use `dexto chat list --local` to see available sessions'));
        } else if (error instanceof Error && error.message !== 'No sessions found') {
            logger.error(`Failed to get session history: ${error.message}`, null, 'red');
        }
        throw error;
    }
}
