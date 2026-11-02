import React from 'react';
import { Box, Text } from 'ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { tone } from '../../signal/index.js';

interface FocusOverlayFrameProps {
    children: React.ReactNode;
}

export function FocusOverlayFrame({ children }: FocusOverlayFrameProps) {
    const { columns } = useTerminalSize();
    const divider = '─'.repeat(Math.max(0, columns));

    return (
        <Box flexDirection="column" width={columns}>
            <Text color={tone('dim')}>{divider}</Text>
            <Box paddingX={1} flexDirection="column">
                {children}
            </Box>
            <Text color={tone('dim')}>{divider}</Text>
        </Box>
    );
}
