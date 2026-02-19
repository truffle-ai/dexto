/**
 * MessageItem Component
 * Displays a single message with visual hierarchy
 * Uses colors and spacing instead of explicit labels
 */

import { memo } from 'react';
import { Box, Text } from 'ink';
import wrapAnsi from 'wrap-ansi';
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
import { formatToolResultPreview } from '../../utils/messageFormatting.js';

/**
 * Strip <plan-mode>...</plan-mode> tags from content.
 * Plan mode instructions are injected for the LLM but should not be shown in the UI.
 * Only trims when a tag was actually removed to preserve user-intended formatting.
 */
function stripPlanModeTags(content: string): string {
    // Remove <plan-mode>...</plan-mode> including any trailing whitespace
    const stripped = content.replace(/<plan-mode>[\s\S]*?<\/plan-mode>\s*/g, '');
    // Only trim if a tag was actually removed
    return stripped === content ? content : stripped.trim();
}

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
    /** Terminal width for proper text wrapping calculations */
    terminalWidth?: number;
    /** Whether assistant reasoning should be shown. */
    showReasoning?: boolean;
}

/**
 * Pure presentational component for a single message
 * Visual hierarchy through colors and spacing only (no borders for easy text copying)
 *
 * Memoization with custom comparator prevents re-renders when message array changes
 * but individual message content hasn't changed.
 */
export const MessageItem = memo(
    ({ message, terminalWidth = 80, showReasoning = true }: MessageItemProps) => {
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
                    // Only show tokens when >= 1000, using K notation
                    const tokensStr =
                        data.totalTokens >= 1000
                            ? `, Used ${(data.totalTokens / 1000).toFixed(1)}K tokens`
                            : '';
                    return (
                        <Box marginTop={1} marginBottom={1} width={terminalWidth}>
                            <Text color="gray">
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
        // Strip plan-mode tags before display (plan instructions are for LLM, not user)
        // Properly wrap text accounting for prefix "> " (2 chars) and paddingX={1} (2 chars total)
        if (message.role === 'user') {
            const prefix = '> ';
            const paddingChars = 2; // paddingX={1} = 1 char on each side
            const availableWidth = Math.max(20, terminalWidth - prefix.length - paddingChars);
            const displayContent = stripPlanModeTags(message.content);
            const wrappedContent = wrapAnsi(displayContent, availableWidth, {
                hard: true,
                wordWrap: true,
                trim: false,
            });
            const lines = wrappedContent.split('\n');

            return (
                <Box flexDirection="column" marginTop={2} marginBottom={1} width={terminalWidth}>
                    <Box flexDirection="column" paddingX={1} backgroundColor="gray">
                        {lines.map((line, i) => (
                            <Box key={i} flexDirection="row">
                                <Text color="green">{i === 0 ? prefix : '  '}</Text>
                                <Text color="white">{line}</Text>
                            </Box>
                        ))}
                    </Box>
                </Box>
            );
        }

        // Assistant message: Gray circle indicator (unless continuation)
        // IMPORTANT: width="100%" is required to prevent Ink layout failures on large content.
        // Without width constraints, streaming content causes terminal blackout at ~50+ lines.
        // marginTop={1} for consistent spacing with tool messages
        if (message.role === 'assistant') {
            const reasoningBlock =
                showReasoning && message.reasoning ? (
                    <Box flexDirection="column" marginBottom={1}>
                        <Text color="gray">Reasoning</Text>
                        <MarkdownText color="gray">{message.reasoning}</MarkdownText>
                    </Box>
                ) : null;

            // Continuation messages: no indicator, just content
            if (message.isContinuation) {
                return (
                    <Box flexDirection="column" width={terminalWidth}>
                        {reasoningBlock}
                        <MarkdownText>{message.content || ''}</MarkdownText>
                    </Box>
                );
            }

            // Regular assistant message: bullet prefix inline with first line
            // Text wraps at terminal width - wrapped lines may start at column 0
            // This is simpler and avoids mid-word splitting issues with Ink's wrap
            return (
                <Box flexDirection="column" marginTop={1} width={terminalWidth}>
                    {reasoningBlock}
                    <MarkdownText bulletPrefix="⏺ ">{message.content || ''}</MarkdownText>
                </Box>
            );
        }

        // Tool message: Animated icon based on status
        // - Running: green spinner + "Running..."
        // - Finished (success): green dot
        // - Finished (error): red dot
        if (message.role === 'tool') {
            // Use structured renderers if display data is available
            const hasStructuredDisplay = message.toolDisplayData && message.toolContent;
            const isRunning = message.toolStatus === 'running';
            const isPending =
                message.toolStatus === 'pending' || message.toolStatus === 'pending_approval';

            // Check for sub-agent progress data
            const subAgentProgress = message.subAgentProgress;

            const contentLines = message.content.split('\n');
            const headerLine = contentLines[0] ?? '';
            const subHeaderLine = contentLines.length > 1 ? contentLines[1] : '';

            // Parse tool name and args for bold formatting: "ToolName(args)" → bold name + normal args
            const parenIndex = headerLine.indexOf('(');
            const toolName = parenIndex > 0 ? headerLine.slice(0, parenIndex) : headerLine;
            const toolArgs = parenIndex > 0 ? headerLine.slice(parenIndex) : '';

            // Build the full tool header text for wrapping
            // Don't include status suffix if we have sub-agent progress (it shows its own status)
            const statusSuffix = subAgentProgress
                ? ''
                : isRunning
                  ? ' Running...'
                  : isPending
                    ? ' Waiting...'
                    : '';
            const fullToolText = `${toolName}${toolArgs}${statusSuffix}`;

            // ToolIcon takes 2 chars ("● "), so available width is terminalWidth - 2
            const iconWidth = 2;
            const availableWidth = Math.max(20, terminalWidth - iconWidth);
            const wrappedToolText = wrapAnsi(fullToolText, availableWidth, {
                hard: true,
                wordWrap: true,
                trim: false,
            });
            const toolLines = wrappedToolText.split('\n');

            return (
                <Box flexDirection="column" marginTop={1} width={terminalWidth}>
                    {/* Tool header: icon + name + args + status text */}
                    {toolLines.map((line, i) => (
                        <Box key={i} flexDirection="row">
                            {i === 0 ? (
                                <ToolIcon
                                    status={message.toolStatus || 'finished'}
                                    isError={message.isError ?? false}
                                />
                            ) : (
                                <Text>{'  '}</Text>
                            )}
                            <Text>
                                {i === 0 ? (
                                    <>
                                        <Text bold>{line.slice(0, toolName.length)}</Text>
                                        <Text>{line.slice(toolName.length)}</Text>
                                    </>
                                ) : (
                                    line
                                )}
                            </Text>
                        </Box>
                    ))}
                    {subHeaderLine && (
                        <Box marginLeft={2}>
                            <Text color="gray">{subHeaderLine}</Text>
                        </Box>
                    )}
                    {/* Sub-agent progress line - show when we have progress data */}
                    {subAgentProgress && isRunning && (
                        <Box marginLeft={2}>
                            <Text color="gray">
                                └─ {subAgentProgress.toolsCalled} tool
                                {subAgentProgress.toolsCalled !== 1 ? 's' : ''} called | Current:{' '}
                                {subAgentProgress.currentTool}
                                {subAgentProgress.tokenUsage &&
                                subAgentProgress.tokenUsage.total > 0
                                    ? ` | ${subAgentProgress.tokenUsage.total.toLocaleString()} tokens`
                                    : ''}
                            </Text>
                        </Box>
                    )}
                    {/* Tool result - only show when finished */}
                    {hasStructuredDisplay ? (
                        <ToolResultRenderer
                            display={message.toolDisplayData!}
                            content={message.toolContent!}
                        />
                    ) : (
                        message.toolResult && (
                            <Box flexDirection="column">
                                <Text color="gray">
                                    ⎿ {formatToolResultPreview(message.toolResult)}
                                </Text>
                            </Box>
                        )
                    )}
                </Box>
            );
        }

        // System message: Compact gray text
        return (
            <Box flexDirection="column" marginBottom={1} width={terminalWidth}>
                <Text color="gray">{message.content}</Text>
            </Box>
        );
    },
    // Custom comparator: only re-render if message content actually changed
    (prev, next) => {
        return (
            prev.message.id === next.message.id &&
            prev.message.content === next.message.content &&
            prev.message.reasoning === next.message.reasoning &&
            prev.message.role === next.message.role &&
            prev.message.toolStatus === next.message.toolStatus &&
            prev.message.toolResult === next.message.toolResult &&
            prev.message.isStreaming === next.message.isStreaming &&
            prev.message.styledType === next.message.styledType &&
            prev.message.styledData === next.message.styledData &&
            prev.message.isContinuation === next.message.isContinuation &&
            prev.message.isError === next.message.isError &&
            prev.message.toolDisplayData === next.message.toolDisplayData &&
            prev.message.toolContent === next.message.toolContent &&
            prev.terminalWidth === next.terminalWidth &&
            prev.showReasoning === next.showReasoning &&
            prev.message.subAgentProgress?.toolsCalled ===
                next.message.subAgentProgress?.toolsCalled &&
            prev.message.subAgentProgress?.currentTool ===
                next.message.subAgentProgress?.currentTool &&
            prev.message.subAgentProgress?.tokenUsage?.total ===
                next.message.subAgentProgress?.tokenUsage?.total
        );
    }
);

MessageItem.displayName = 'MessageItem';
