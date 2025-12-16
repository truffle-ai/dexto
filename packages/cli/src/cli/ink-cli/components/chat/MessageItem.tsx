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
import { MarkdownText } from '../shared/MarkdownText.js';
import { ToolIcon } from './ToolIcon.js';

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
                        <Text color="white" wrap="wrap">
                            {message.content}
                        </Text>
                    </Box>
                </Box>
            );
        }

        // Assistant message: Gray circle indicator (unless continuation)
        // IMPORTANT: width="100%" is required to prevent Ink layout failures on large content.
        // Without width constraints, streaming content causes terminal blackout at ~50+ lines.
        // marginTop={1} for consistent spacing with tool messages
        if (message.role === 'assistant') {
            // Continuation messages: no indicator, just content
            if (message.isContinuation) {
                return (
                    <Box flexDirection="column" width="100%">
                        <MarkdownText>{message.content || ''}</MarkdownText>
                    </Box>
                );
            }

            // Regular assistant message: bullet prefix inline with first line
            // Text wraps at terminal width - wrapped lines may start at column 0
            // This is simpler and avoids mid-word splitting issues with Ink's wrap
            return (
                <Box flexDirection="column" marginTop={1} width="100%">
                    <MarkdownText bulletPrefix="⏺ ">{message.content || ''}</MarkdownText>
                </Box>
            );
        }

        // Tool message: Animated icon based on status
        // - Running: magenta spinner + "Running..."
        // - Finished (success): green dot
        // - Finished (error): red dot
        if (message.role === 'tool') {
            // Use structured renderers if display data is available
            const hasStructuredDisplay = message.toolDisplayData && message.toolContent;
            const isRunning = message.toolStatus === 'running';
            const isPending =
                message.toolStatus === 'pending' || message.toolStatus === 'pending_approval';

            // Parse tool name and args for bold formatting: "ToolName(args)" → bold name + normal args
            const parenIndex = message.content.indexOf('(');
            const toolName =
                parenIndex > 0 ? message.content.slice(0, parenIndex) : message.content;
            const toolArgs = parenIndex > 0 ? message.content.slice(parenIndex) : '';

            return (
                <Box flexDirection="column" marginTop={1} width="100%">
                    {/* Tool header: icon + name + args + status text */}
                    <Box flexDirection="row" overflow="hidden">
                        <ToolIcon
                            status={message.toolStatus || 'finished'}
                            isError={message.isError ?? false}
                        />
                        <Box flexGrow={1} flexShrink={1} overflow="hidden">
                            <Text wrap="truncate-end">
                                <Text bold>{toolName}</Text>
                                <Text>{toolArgs}</Text>
                                {isRunning && <Text color="magenta"> Running...</Text>}
                                {isPending && (
                                    <Text color="yellow" dimColor>
                                        {' '}
                                        Waiting...
                                    </Text>
                                )}
                            </Text>
                        </Box>
                    </Box>
                    {/* Tool result - only show when finished */}
                    {hasStructuredDisplay ? (
                        <ToolResultRenderer
                            display={message.toolDisplayData!}
                            content={message.toolContent!}
                            maxLines={15}
                        />
                    ) : (
                        message.toolResult && (
                            <Box flexDirection="column">
                                <Text dimColor> ⎿ {message.toolResult}</Text>
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
