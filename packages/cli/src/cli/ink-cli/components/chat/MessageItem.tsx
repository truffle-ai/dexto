/**
 * MessageItem Component
 * Displays a single message with visual hierarchy
 * Uses colors and spacing instead of explicit labels
 */

import { memo } from 'react';
import { Box, Text } from 'ink';
import type {
    Message,
    ConfigStyledData,
    StatsStyledData,
    HelpStyledData,
    SessionListStyledData,
    SessionHistoryStyledData,
    LogConfigStyledData,
    RunSummaryStyledData,
} from '../../state/types.js';
import { ToolIcon } from './ToolIcon.js';
import {
    ConfigBox,
    StatsBox,
    HelpBox,
    SessionListBox,
    SessionHistoryBox,
    LogConfigBox,
} from './styled-boxes/index.js';

/**
 * Format milliseconds into a compact human-readable string
 * Examples: "1.2s", "1m 23s", "1h 2m"
 */
function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const tenths = Math.floor((ms % 1000) / 100);

    if (seconds < 60) {
        return `${seconds}.${tenths}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes < 60) {
        return `${minutes}m ${remainingSeconds}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

interface MessageItemProps {
    message: Message;
}

/**
 * Pure presentational component for a single message
 * Visual hierarchy through colors and spacing only (no borders for easy text copying)
 *
 * Memoization with custom comparator prevents re-renders when message array changes
 * but individual message content hasn't changed.
 */
export const MessageItem = memo(
    ({ message }: MessageItemProps) => {
        // Check for styled message first
        if (message.styledType && message.styledData) {
            switch (message.styledType) {
                case 'config':
                    return <ConfigBox data={message.styledData as ConfigStyledData} />;
                case 'stats':
                    return <StatsBox data={message.styledData as StatsStyledData} />;
                case 'help':
                    return <HelpBox data={message.styledData as HelpStyledData} />;
                case 'session-list':
                    return <SessionListBox data={message.styledData as SessionListStyledData} />;
                case 'session-history':
                    return (
                        <SessionHistoryBox data={message.styledData as SessionHistoryStyledData} />
                    );
                case 'log-config':
                    return <LogConfigBox data={message.styledData as LogConfigStyledData} />;
                case 'run-summary': {
                    const data = message.styledData as RunSummaryStyledData;
                    const durationStr = formatDuration(data.durationMs);
                    const tokensStr =
                        data.outputTokens > 0 ? `, Used ${data.outputTokens} tokens` : '';
                    return (
                        <Box marginTop={1} marginBottom={1}>
                            <Text color="gray" dimColor>
                                ─ Worked for {durationStr}
                                {tokensStr} ─
                            </Text>
                        </Box>
                    );
                }
            }
        }

        // User message: Simple '>' with dim background for easy scanning
        if (message.role === 'user') {
            return (
                <Box flexDirection="column" marginTop={2} marginBottom={1}>
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
                            <Text color="white">{message.content || ' '}</Text>
                        </Box>
                    </Box>
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
                        <Text color={textColor} bold>
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
            <Box flexDirection="column" marginBottom={1}>
                <Text color="gray" dimColor>
                    {message.content}
                </Text>
            </Box>
        );
    },
    // Custom comparator: only re-render if message content actually changed
    (prev, next) => {
        return (
            prev.message.id === next.message.id &&
            prev.message.content === next.message.content &&
            prev.message.role === next.message.role &&
            prev.message.toolStatus === next.message.toolStatus &&
            prev.message.toolResult === next.message.toolResult &&
            prev.message.isStreaming === next.message.isStreaming &&
            prev.message.styledType === next.message.styledType
        );
    }
);

MessageItem.displayName = 'MessageItem';
