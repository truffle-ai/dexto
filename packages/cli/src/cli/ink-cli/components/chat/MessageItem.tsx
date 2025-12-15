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
    ShortcutsStyledData,
    SysPromptStyledData,
} from '../../state/types.js';
import {
    ConfigBox,
    StatsBox,
    HelpBox,
    SessionListBox,
    SessionHistoryBox,
    LogConfigBox,
    ShortcutsBox,
    SyspromptBox,
} from './styled-boxes/index.js';
import { ToolResultRenderer } from '../renderers/index.js';

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
                        <Box marginTop={1} marginBottom={1} width="100%">
                            <Text color="gray" dimColor>
                                ─ Worked for {durationStr}
                                {tokensStr} ─
                            </Text>
                        </Box>
                    );
                }
                case 'shortcuts':
                    return <ShortcutsBox data={message.styledData as ShortcutsStyledData} />;
                case 'sysprompt':
                    return <SyspromptBox data={message.styledData as SysPromptStyledData} />;
            }
        }

        // User message: '>' prefix with gray background
        if (message.role === 'user') {
            return (
                <Box flexDirection="column" marginTop={2} marginBottom={1} width="100%">
                    <Box flexDirection="row" paddingX={1} backgroundColor="gray">
                        <Text color="green" dimColor>
                            {'> '}
                        </Text>
                        <Text color="white">{message.content}</Text>
                    </Box>
                </Box>
            );
        }

        // Assistant message: Gray circle indicator (unless continuation)
        // IMPORTANT: width="100%" is required to prevent Ink layout failures on large content.
        // Without width constraints, streaming content causes terminal blackout at ~50+ lines.
        if (message.role === 'assistant') {
            // Continuation messages: no indicator, no margins - flows seamlessly from previous
            if (message.isContinuation) {
                return (
                    <Box flexDirection="row" width="100%">
                        <Text>{'  '}</Text>
                        <Text color="white">{message.content || ''}</Text>
                    </Box>
                );
            }

            return (
                <Box flexDirection="column" marginBottom={1} width="100%">
                    <Box flexDirection="row">
                        <Text color="gray">⏺ </Text>
                        <Box flexDirection="column" flexGrow={1}>
                            <Text color="white">{message.content || ' '}</Text>
                        </Box>
                    </Box>
                </Box>
            );
        }

        // Tool message: Green for success, red for failure
        if (message.role === 'tool') {
            const iconColor = message.isError ? 'red' : 'green';

            // Use structured renderers if display data is available
            const hasStructuredDisplay = message.toolDisplayData && message.toolContent;

            return (
                <Box flexDirection="column" marginBottom={1} width="100%">
                    <Box flexDirection="row">
                        <Text color={iconColor}>⏺ </Text>
                        <Text color={iconColor}>{message.content}</Text>
                    </Box>
                    {hasStructuredDisplay ? (
                        <Box marginLeft={2} marginTop={0} flexDirection="column">
                            <ToolResultRenderer
                                display={message.toolDisplayData!}
                                content={message.toolContent!}
                                maxLines={15}
                            />
                        </Box>
                    ) : (
                        message.toolResult && (
                            <Box marginLeft={2} marginTop={0} flexDirection="column">
                                <Text color="gray" dimColor>
                                    {message.toolResult}
                                </Text>
                            </Box>
                        )
                    )}
                </Box>
            );
        }

        // System message: Compact gray text
        return (
            <Box flexDirection="column" marginBottom={1} width="100%">
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
            prev.message.styledType === next.message.styledType &&
            prev.message.styledData === next.message.styledData &&
            prev.message.isContinuation === next.message.isContinuation &&
            prev.message.isError === next.message.isError &&
            prev.message.toolDisplayData === next.message.toolDisplayData &&
            prev.message.toolContent === next.message.toolContent
        );
    }
);

MessageItem.displayName = 'MessageItem';
