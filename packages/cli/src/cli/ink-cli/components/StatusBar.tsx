/**
 * StatusBar Component
 * Displays processing status and controls above the input area
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
    approvalQueueCount,
    copyModeEnabled = false,
    isAwaitingApproval = false,
}: StatusBarProps) {
    // Cycle through witty phrases while processing
    const { phrase } = usePhraseCycler({ isActive: isProcessing });
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
                <Text color="yellow" bold>
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

    // Show initial processing state (before streaming starts) - magenta color
    // TODO: Rename this event/state to "reasoning" and associate it with actual reasoning tokens
    // Currently "thinking" event fires before any response, not during reasoning token generation
    if (isThinking) {
        return (
            <Box paddingX={1} marginTop={1} marginBottom={1} flexDirection="row">
                <Text color="magenta">
                    <Spinner type="dots" />
                </Text>
                <Text color="magenta"> {phrase}</Text>
                <Text color="gray" dimColor>
                    {showTime ? ` (${elapsedTime})` : ''} • Press Esc to cancel
                </Text>
            </Box>
        );
    }

    // Show active streaming state - cyan color
    return (
        <Box paddingX={1} marginTop={1} marginBottom={1} flexDirection="row">
            <Text color="cyan">
                <Spinner type="dots" />
            </Text>
            <Text color="cyan"> {phrase}</Text>
            {approvalQueueCount > 0 && (
                <Text color="yellow"> • {approvalQueueCount} approval(s) queued</Text>
            )}
            <Text color="gray" dimColor>
                {showTime ? ` (${elapsedTime})` : ''}
                {tokenCount && ` • ${tokenCount}`} • Press Esc to cancel
            </Text>
        </Box>
    );
}
