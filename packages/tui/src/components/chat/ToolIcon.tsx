/**
 * ToolIcon Component
 * Animated icon for tool calls with status-based visual feedback
 */

import { Text } from 'ink';
import type { ToolStatus } from '../../state/types.js';
import { useAnimationTick } from '../../hooks/useAnimationTick.js';
import { BRAILLE_SPINNER_FRAMES } from '../../constants/spinnerFrames.js';
import { tone } from '../../signal/index.js';

interface ToolIconProps {
    status: ToolStatus;
    isError?: boolean;
}

/**
 * Animated tool icon that changes based on execution status
 * - Running: Animated spinner (green/teal)
 * - Finished (success): Green dot
 * - Finished (error): Red dot
 */
export function ToolIcon({ status, isError }: ToolIconProps) {
    const tick = useAnimationTick({ enabled: status === 'running', intervalMs: 80 });
    const frame = tick % BRAILLE_SPINNER_FRAMES.length;

    // Pending: static gray dot (tool call received, checking approval)
    if (status === 'pending') {
        return <Text color={tone('dim')}>● </Text>;
    }

    // Pending approval: static yellowBright dot (waiting for user)
    if (status === 'pending_approval') {
        return (
            <Text color={tone('amber')} bold>
                ●{' '}
            </Text>
        );
    }

    if (status === 'finished') {
        // Error state: red dot
        if (isError) {
            return (
                <Text color={tone('red')} bold>
                    ●{' '}
                </Text>
            );
        }
        // Success state: green dot
        return (
            <Text color={tone('add')} bold>
                ●{' '}
            </Text>
        );
    }

    // Running state with spinner
    return (
        <Text color={tone('add')} bold>
            {BRAILLE_SPINNER_FRAMES[frame]}{' '}
        </Text>
    );
}
