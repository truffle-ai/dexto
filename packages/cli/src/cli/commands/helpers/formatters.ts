/**
 * Session Formatting Utilities
 *
 * This module contains formatting functions for session-related CLI output.
 * Shared between interactive and non-interactive session commands.
 */

import chalk from 'chalk';
import type { InternalMessage, ToolCall } from '@dexto/core';
import { isAssistantMessage } from '@dexto/core';

/**
 * Helper to format conversation history
 */
export function formatHistoryMessage(message: InternalMessage, index: number): string {
    const timestamp = message.timestamp
        ? new Date(message.timestamp).toLocaleTimeString()
        : `#${index + 1}`;

    let roleColor = chalk.gray;
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
            roleColor = chalk.rgb(255, 165, 0);
            displayLabel = 'System';
            break;
        case 'tool':
            roleColor = chalk.green;
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
                if (part.type === 'resource') return `[Resource: ${part.name || part.uri}]`;
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
    if (isAssistantMessage(message) && message.toolCalls && message.toolCalls.length > 0) {
        const toolNames = message.toolCalls
            .map((tc: ToolCall) => tc.function?.name || 'unknown')
            .join(', ');
        toolInfo = chalk.gray(` [Tools: ${toolNames}]`);
    }

    return `  ${chalk.gray(timestamp)} ${roleColor.bold(displayLabel)}: ${content}${toolInfo}`;
}
