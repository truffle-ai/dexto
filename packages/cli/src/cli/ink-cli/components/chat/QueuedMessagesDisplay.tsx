/**
 * QueuedMessagesDisplay - Shows queued messages waiting to be processed
 *
 * Similar to webui's QueuedMessagesDisplay.tsx but for Ink/terminal.
 * Shows:
 * - Count of queued messages
 * - Keyboard hint (↑ to edit)
 * - Truncated preview of each queued message
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { QueuedMessage, ContentPart } from '@dexto/core';

interface QueuedMessagesDisplayProps {
    messages: QueuedMessage[];
}

/**
 * Extract text content from ContentPart[]
 */
function getMessageText(content: ContentPart[]): string {
    const textParts = content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text);
    return textParts.join(' ') || '[attachment]';
}

/**
 * Truncate text to fit terminal width
 */
function truncateText(text: string, maxLength: number = 60): string {
    // Replace newlines with spaces for single-line display
    const singleLine = text.replace(/\n/g, ' ').trim();
    if (singleLine.length <= maxLength) {
        return singleLine;
    }
    return singleLine.slice(0, maxLength - 3) + '...';
}

export function QueuedMessagesDisplay({ messages }: QueuedMessagesDisplayProps) {
    if (messages.length === 0) return null;

    return (
        <Box flexDirection="column" marginBottom={1}>
            {/* Header with count and keyboard hint */}
            <Box>
                <Text color="gray">
                    {messages.length} message{messages.length !== 1 ? 's' : ''} queued
                </Text>
                <Text color="gray"> • </Text>
                <Text color="gray">↑ to edit</Text>
            </Box>

            {/* Messages list */}
            {messages.map((message, index) => (
                <Box key={message.id} flexDirection="row">
                    {/* Arrow indicator - last message gets special indicator */}
                    <Text color="gray">{index === messages.length - 1 ? '↳ ' : '│ '}</Text>
                    {/* Message preview */}
                    <Text color="gray" italic>
                        {truncateText(getMessageText(message.content))}
                    </Text>
                </Box>
            ))}
        </Box>
    );
}
