/**
 * MessageItem Component
 * Displays a single message in the chat
 */

import React, { memo } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { Message } from '../../state/types.js';

interface MessageItemProps {
    message: Message;
}

/**
 * Pure presentational component for a single message
 * Memoized to prevent unnecessary re-renders
 */
export const MessageItem = memo(({ message }: MessageItemProps) => {
    const roleColor =
        message.role === 'user'
            ? 'green'
            : message.role === 'assistant'
              ? 'cyan'
              : message.role === 'tool'
                ? 'yellow'
                : 'gray';

    const roleLabel =
        message.role === 'user'
            ? 'You:'
            : message.role === 'assistant'
              ? 'AI:'
              : message.role === 'tool'
                ? 'Tool:'
                : 'System:';

    return (
        <Box marginBottom={1} flexDirection="column">
            <Box>
                <Text color={roleColor} bold>
                    {roleLabel}
                </Text>
            </Box>
            <Box marginLeft={2}>
                <Text wrap="wrap">{message.content || '...'}</Text>
                {message.isStreaming && (
                    <Text color="gray">
                        {' '}
                        <Spinner type="dots" />
                    </Text>
                )}
            </Box>
        </Box>
    );
});

MessageItem.displayName = 'MessageItem';
