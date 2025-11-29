/**
 * MessageItem Component
 * Displays a single message with visual hierarchy
 * Uses colors and spacing instead of explicit labels
 */

import { memo } from 'react';
import { Box, Text } from 'ink';
import type { Message } from '../../state/types.js';
import { ToolIcon } from './ToolIcon.js';

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
                <Text>{''}</Text>
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
                        <Text color="white">{message.content || ' '}</Text>
                        {message.isCancelled && (
                            <Text color="yellow" dimColor>
                                {'[Cancelled]'}
                            </Text>
                        )}
                    </Box>
                </Box>
                <Text>{''}</Text>
            </Box>
        );
    }

    // Tool message: Animated icon with status-based colors
    if (message.role === 'tool') {
        const toolStatus = message.toolStatus || 'running';
        const textColor = toolStatus === 'finished' ? 'green' : 'magentaBright';

        return (
            <Box flexDirection="column" marginBottom={1}>
                <Box flexDirection="row">
                    <ToolIcon status={toolStatus} />
                    <Text color={textColor}>{message.content}</Text>
                </Box>
                {message.toolResult && (
                    <Box marginLeft={2} marginTop={0} flexDirection="column">
                        <Text color="gray" dimColor>
                            {message.toolResult}
                        </Text>
                    </Box>
                )}
                <Text>{''}</Text>
            </Box>
        );
    }

    // System message: Compact gray text
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text color="gray" dimColor>
                {message.content}
            </Text>
            <Text>{''}</Text>
        </Box>
    );
});

MessageItem.displayName = 'MessageItem';
