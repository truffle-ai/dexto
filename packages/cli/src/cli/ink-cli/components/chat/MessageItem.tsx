/**
 * MessageItem Component
 * Displays a single message with visual hierarchy
 * Uses colors and spacing instead of explicit labels
 */

import { memo } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { Message } from '../../state/types.js';

interface MessageItemProps {
    message: Message;
}

/**
 * Pure presentational component for a single message
 * Visual hierarchy through colors and spacing only (no borders for easy text copying)
 */
export const MessageItem = memo(({ message }: MessageItemProps) => {
    // User message: Simple '>' with dim background for easy scanning
    if (message.role === 'user') {
        return (
            <Box flexDirection="column" marginBottom={1}>
                <Box flexDirection="row" paddingX={1} backgroundColor="gray">
                    <Text color="green" dimColor>
                        {'> '}
                    </Text>
                    <Text color="white">{message.content}</Text>
                </Box>
            </Box>
        );
    }

    // Assistant message: Cyan accent bar with white text
    if (message.role === 'assistant') {
        return (
            <Box flexDirection="column" marginBottom={1}>
                <Box flexDirection="row">
                    <Text color="cyan" bold>
                        ▍{' '}
                    </Text>
                    <Box flexDirection="column" flexGrow={1}>
                        {message.content ? (
                            <Text color="white">{message.content}</Text>
                        ) : (
                            message.isStreaming && (
                                <Text color="gray">
                                    <Spinner type="dots" />
                                </Text>
                            )
                        )}
                    </Box>
                </Box>
            </Box>
        );
    }

    // Tool message: Yellow indicator with args and result preview
    if (message.role === 'tool') {
        return (
            <Box flexDirection="column" marginBottom={0}>
                <Box flexDirection="row">
                    <Text color="yellow" bold>
                        ⚙{' '}
                    </Text>
                    <Text color="yellow" dimColor>
                        {message.content}
                    </Text>
                </Box>
                {message.toolResult && (
                    <Box marginLeft={2} marginTop={0} flexDirection="column">
                        <Text color="gray" dimColor>
                            {message.toolResult}
                        </Text>
                    </Box>
                )}
            </Box>
        );
    }

    // System message: Compact gray text
    return (
        <Box flexDirection="column" marginBottom={0}>
            <Text color="gray" dimColor>
                {message.content}
            </Text>
        </Box>
    );
});

MessageItem.displayName = 'MessageItem';
