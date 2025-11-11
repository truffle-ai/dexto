/**
 * StatusBar Component
 * Displays processing status and controls above the input area
 */

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface StatusBarProps {
    isProcessing: boolean;
    isThinking: boolean;
    approvalQueueCount: number;
}

/**
 * Status bar that shows processing state above input area
 * Provides clear feedback on whether the agent is running or idle
 */
export function StatusBar({ isProcessing, isThinking, approvalQueueCount }: StatusBarProps) {
    if (!isProcessing) {
        // Show idle state - minimal, non-intrusive
        return (
            <Box paddingX={1} marginBottom={0}>
                <Text color="green">●</Text>
                <Text color="gray" dimColor>
                    {' '}
                    Ready
                </Text>
            </Box>
        );
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
                <Text color="magenta"> Processing</Text>
                <Text color="gray" dimColor>
                    {' '}
                    • Press Esc or Ctrl+C to cancel
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
            <Text color="cyan"> Processing</Text>
            {approvalQueueCount > 0 && (
                <Text color="yellow"> • {approvalQueueCount} approval(s) queued</Text>
            )}
            <Text color="gray" dimColor>
                {' '}
                • Press Esc or Ctrl+C to cancel
            </Text>
        </Box>
    );
}
