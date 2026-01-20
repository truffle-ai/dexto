/**
 * StatusBar Component
 * Displays processing status and controls above the input area
 *
 * Layout:
 * - Line 1: Spinner + phrase (+ queue count if any)
 * - Line 2: Meta info (time, tokens, cancel hint)
 * This 2-line layout prevents truncation on any terminal width.
 */

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { DextoAgent } from '@dexto/core';
import { usePhraseCycler } from '../hooks/usePhraseCycler.js';
import { useElapsedTime } from '../hooks/useElapsedTime.js';
import { useTokenCounter } from '../hooks/useTokenCounter.js';

interface StatusBarProps {
    agent: DextoAgent;
    isProcessing: boolean;
    isThinking: boolean;
    isCompacting: boolean;
    approvalQueueCount: number;
    copyModeEnabled?: boolean;
    /** Whether an approval prompt is currently shown */
    isAwaitingApproval?: boolean;
}

/**
 * Status bar that shows processing state above input area
 * Provides clear feedback on whether the agent is running or idle
 *
 * Design decisions:
 * - Hide spinner during approval wait (user is reviewing, not waiting)
 * - Only show elapsed time after 30s (avoid visual noise for fast operations)
 */
export function StatusBar({
    agent,
    isProcessing,
    isThinking,
    isCompacting,
    approvalQueueCount,
    copyModeEnabled = false,
    isAwaitingApproval = false,
}: StatusBarProps) {
    // Cycle through witty phrases while processing (not during compacting)
    const { phrase } = usePhraseCycler({ isActive: isProcessing && !isCompacting });
    // Track elapsed time during processing
    const { formatted: elapsedTime, elapsedMs } = useElapsedTime({ isActive: isProcessing });
    // Track token usage during processing
    const { formatted: tokenCount } = useTokenCounter({ agent, isActive: isProcessing });
    // Only show time after 30 seconds
    const showTime = elapsedMs >= 30000;

    // Show copy mode warning (highest priority)
    if (copyModeEnabled) {
        return (
            <Box paddingX={1} marginBottom={0}>
                <Text color="yellowBright" bold>
                    📋 Copy Mode - Select text with mouse. Press any key to exit.
                </Text>
            </Box>
        );
    }

    if (!isProcessing) {
        // No status bar when idle
        return null;
    }

    // Hide status bar during approval wait - user is reviewing, not waiting
    if (isAwaitingApproval) {
        return null;
    }

    // Show compacting state - yellow/orange color to indicate context management
    if (isCompacting) {
        const metaParts: string[] = [];
        if (showTime) metaParts.push(`(${elapsedTime})`);
        metaParts.push('Esc to cancel');
        const metaContent = metaParts.join(' • ');

        return (
            <Box paddingX={1} marginTop={1} marginBottom={1} flexDirection="column">
                {/* Line 1: spinner + compacting message */}
                <Box flexDirection="row" alignItems="center">
                    <Text color="yellow">
                        <Spinner type="dots" />
                    </Text>
                    <Text color="yellow"> 📦 Compacting context...</Text>
                </Box>
                {/* Line 2: meta info */}
                <Box marginLeft={2}>
                    <Text color="gray">{metaContent}</Text>
                </Box>
            </Box>
        );
    }

    // Show initial processing state (before streaming starts) - green/teal color
    // TODO: Rename this event/state to "reasoning" and associate it with actual reasoning tokens
    // Currently "thinking" event fires before any response, not during reasoning token generation
    if (isThinking) {
        const metaParts: string[] = [];
        if (showTime) metaParts.push(`(${elapsedTime})`);
        if (tokenCount) metaParts.push(tokenCount);
        metaParts.push('Esc to cancel');
        const metaContent = metaParts.join(' • ');

        return (
            <Box paddingX={1} marginTop={1} marginBottom={1} flexDirection="column">
                {/* Line 1: spinner + phrase */}
                <Box flexDirection="row" alignItems="center">
                    <Text color="green">
                        <Spinner type="dots" />
                    </Text>
                    <Text color="green"> {phrase}</Text>
                </Box>
                {/* Line 2: meta info */}
                <Box marginLeft={2}>
                    <Text color="gray">{metaContent}</Text>
                </Box>
            </Box>
        );
    }

    // Show active streaming state - green/teal color
    // Always use 2-line layout: phrase on first line, meta on second
    // This prevents truncation and messy wrapping on any terminal width
    const metaParts: string[] = [];
    if (showTime) metaParts.push(`(${elapsedTime})`);
    if (tokenCount) metaParts.push(tokenCount);
    metaParts.push('Esc to cancel');
    const metaContent = metaParts.join(' • ');

    return (
        <Box paddingX={1} marginTop={1} marginBottom={1} flexDirection="column">
            {/* Line 1: spinner + phrase + queue count */}
            <Box flexDirection="row" alignItems="center">
                <Text color="green">
                    <Spinner type="dots" />
                </Text>
                <Text color="green"> {phrase}</Text>
                {approvalQueueCount > 0 && (
                    <Text color="yellowBright"> • {approvalQueueCount} queued</Text>
                )}
            </Box>
            {/* Line 2: meta info (time, tokens, cancel hint) */}
            <Box marginLeft={2}>
                <Text color="gray">{metaContent}</Text>
            </Box>
        </Box>
    );
}
