/**
 * ToolIcon Component
 * Animated icon for tool calls with status-based visual feedback
 */

import { useState, useEffect } from 'react';
import { Text } from 'ink';
import type { ToolStatus } from '../../state/types.js';

interface ToolIconProps {
    status: ToolStatus;
    isError?: boolean;
}

// Spinner frames for running animation
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Animated tool icon that changes based on execution status
 * - Running: Animated spinner (green/teal)
 * - Finished (success): Green dot
 * - Finished (error): Red dot
 */
export function ToolIcon({ status, isError }: ToolIconProps) {
    const [frame, setFrame] = useState(0);

    // Animate spinner only when actually running (not during approval)
    useEffect(() => {
        if (status !== 'running') {
            return;
        }

        const interval = setInterval(() => {
            setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
        }, 80); // 80ms per frame for smooth animation

        return () => clearInterval(interval);
    }, [status]);

    // Pending: static gray dot (tool call received, checking approval)
    if (status === 'pending') {
        return <Text color="gray">● </Text>;
    }

    // Pending approval: static yellowBright dot (waiting for user)
    if (status === 'pending_approval') {
        return (
            <Text color="yellowBright" bold>
                ●{' '}
            </Text>
        );
    }

    if (status === 'finished') {
        // Error state: red dot
        if (isError) {
            return (
                <Text color="red" bold>
                    ●{' '}
                </Text>
            );
        }
        // Success state: green dot
        return (
            <Text color="green" bold>
                ●{' '}
            </Text>
        );
    }

    // Running state with spinner
    return (
        <Text color="green" bold>
            {SPINNER_FRAMES[frame]}{' '}
        </Text>
    );
}
