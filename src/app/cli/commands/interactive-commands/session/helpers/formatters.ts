/**
 * Session Formatting Utilities
 *
 * This module contains formatting functions for session-related CLI output.
 * Extracted from commands.ts as part of CLI refactoring to improve code organization.
 */

import chalk from 'chalk';
import type { SessionMetadata } from '@core/session/index.js';
import type { InternalMessage } from '@core/context/index.js';

/**
 * Helper to format session information consistently
 */
export function formatSessionInfo(
    sessionId: string,
    metadata?: SessionMetadata,
    isCurrent: boolean = false
): string {
    const prefix = isCurrent ? chalk.green('→') : ' ';
    const name = isCurrent ? chalk.green.bold(sessionId) : chalk.cyan(sessionId);

    let info = `${prefix} ${name}`;

    if (metadata) {
        const messages = metadata.messageCount || 0;
        const activity =
            metadata.lastActivity && metadata.lastActivity > 0
                ? new Date(metadata.lastActivity).toLocaleString()
                : 'Never';

        info += chalk.dim(` (${messages} messages, last: ${activity})`);

        if (isCurrent) {
            info += chalk.yellow(' [ACTIVE]');
        }
    }

    return info;
}

/**
 * Helper to format conversation history
 */
export function formatHistoryMessage(message: InternalMessage, index: number): string {
    const timestamp = message.timestamp
        ? new Date(message.timestamp).toLocaleTimeString()
        : `#${index + 1}`;

    let roleColor = chalk.dim;
    let displayLabel: string = message.role;

    switch (message.role) {
        case 'user':
            roleColor = chalk.blue;
            displayLabel = 'You';
            break;
        case 'assistant':
            roleColor = chalk.green;
            displayLabel = 'Assistant';
            break;
        case 'system':
            roleColor = chalk.yellow;
            displayLabel = 'System';
            break;
        case 'tool':
            roleColor = chalk.magenta;
            displayLabel = 'Tool';
            break;
    }

    // Handle content formatting
    let content = '';
    if (typeof message.content === 'string') {
        content = message.content;
    } else if (message.content === null) {
        content = '[No content]';
    } else if (Array.isArray(message.content)) {
        // Handle multimodal content
        content = message.content
            .map((part) => {
                if (part.type === 'text') return part.text;
                if (part.type === 'image') return '[Image]';
                if (part.type === 'file') return `[File: ${part.filename || 'unknown'}]`;
                return '[Unknown content]';
            })
            .join(' ');
    } else {
        content = '[No content]';
    }

    // Truncate very long messages
    if (content.length > 200) {
        content = content.substring(0, 200) + '...';
    }

    // Format tool calls if present
    let toolInfo = '';
    if (message.toolCalls && message.toolCalls.length > 0) {
        const toolNames = message.toolCalls
            .map((tc: any) => tc.function?.name || 'unknown')
            .join(', ');
        toolInfo = chalk.dim(` [Tools: ${toolNames}]`);
    }

    return `  ${chalk.dim(timestamp)} ${roleColor.bold(displayLabel)}: ${content}${toolInfo}`;
}
