/**
 * MessageList Component
 * Displays a list of messages with optional welcome message
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { MessageItem } from './MessageItem.js';
import type { Message } from '../../state/types.js';
import { tone } from '../../signal/index.js';

interface MessageListProps {
    messages: Message[];
    maxVisible?: number;
}

/**
 * Pure presentational component for message list
 * Shows only recent messages for performance
 */
export function MessageList({ messages, maxVisible = 50 }: MessageListProps) {
    // Only render recent messages for performance
    const visibleMessages = useMemo(() => {
        return messages.slice(-maxVisible);
    }, [messages, maxVisible]);

    const hasMoreMessages = messages.length > maxVisible;

    return (
        <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
            {hasMoreMessages && (
                <Box marginBottom={1}>
                    <Text color={tone('dim')}>
                        ... ({messages.length - maxVisible} earlier messages hidden)
                    </Text>
                </Box>
            )}
            {visibleMessages.length === 0 && (
                <Box marginY={2}>
                    <Text color={tone('tealDim')}>
                        Welcome to Dexto CLI! Type your message below or use /help for commands.
                    </Text>
                </Box>
            )}
            {visibleMessages.map((msg) => (
                <MessageItem key={msg.id} message={msg} />
            ))}
        </Box>
    );
}
