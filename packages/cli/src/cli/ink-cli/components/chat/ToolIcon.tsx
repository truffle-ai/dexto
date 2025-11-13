/**
 * ToolIcon Component
 * Animated icon for tool calls with status-based visual feedback
 */

import { useState, useEffect } from 'react';
import { Text } from 'ink';
import type { ToolStatus } from '../../state/types.js';

interface ToolIconProps {
    status: ToolStatus;
}

// Spinner frames for running animation
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Animated tool icon that changes based on execution status
 * - Running: Animated spinner (magenta)
 * - Finished: Checkmark (green)
 */
export function ToolIcon({ status }: ToolIconProps) {
    const [frame, setFrame] = useState(0);

    // Animate spinner when running
    useEffect(() => {
        if (status !== 'running') {
            return;
        }

        const interval = setInterval(() => {
            setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
        }, 80); // 80ms per frame for smooth animation

        return () => clearInterval(interval);
    }, [status]);

    if (status === 'finished') {
        return (
            <Text color="green" bold>
                ✓{' '}
            </Text>
        );
    }

    // Running state with spinner
    return (
        <Text color="magenta" bold>
            {SPINNER_FRAMES[frame]}{' '}
        </Text>
    );
}
