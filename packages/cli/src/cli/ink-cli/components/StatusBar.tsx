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
}

/**
 * Status bar that shows processing state above input area
 * Provides clear feedback on whether the agent is running or idle
 */
export function StatusBar({
    agent,
    isProcessing,
    isThinking,
    approvalQueueCount,
    copyModeEnabled = false,
}: StatusBarProps) {
    // Cycle through witty phrases while processing
    const { phrase } = usePhraseCycler({ isActive: isProcessing });
    // Track elapsed time during processing
    const { formatted: elapsedTime } = useElapsedTime({ isActive: isProcessing });
    // Track token usage during processing
    const { formatted: tokenCount } = useTokenCounter({ agent, isActive: isProcessing });

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

    // Show initial processing state (before streaming starts) - magenta color
    // TODO: Rename this event/state to "reasoning" and associate it with actual reasoning tokens
    // Currently "thinking" event fires before any response, not during reasoning token generation
    if (isThinking) {
        return (
            <Box paddingX={1} marginBottom={0} flexDirection="row">
                <Text color="magenta">
                    <Spinner type="dots" />
                </Text>
                <Text color="magenta"> {phrase}</Text>
                <Text color="gray" dimColor>
                    {' '}
                    ({elapsedTime}) • Press Esc to cancel
                </Text>
            </Box>
        );
    }

    // Show active streaming state - cyan color
    return (
        <Box paddingX={1} marginBottom={0} flexDirection="row">
            <Text color="cyan">
                <Spinner type="dots" />
            </Text>
            <Text color="cyan"> {phrase}</Text>
            {approvalQueueCount > 0 && (
                <Text color="yellow"> • {approvalQueueCount} approval(s) queued</Text>
            )}
            <Text color="gray" dimColor>
                {' '}
                ({elapsedTime}){tokenCount && ` • ${tokenCount}`} • Press Esc to cancel
            </Text>
        </Box>
    );
}
