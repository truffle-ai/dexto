import React from 'react';
import { Box, Text } from 'ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';

interface FocusOverlayFrameProps {
    children: React.ReactNode;
}

export function FocusOverlayFrame({ children }: FocusOverlayFrameProps) {
    const { columns } = useTerminalSize();
    const divider = '─'.repeat(Math.max(0, columns));

    return (
        <Box flexDirection="column" width={columns}>
            <Text color="gray">{divider}</Text>
            <Box paddingX={1} flexDirection="column">
                {children}
            </Box>
            <Text color="gray">{divider}</Text>
        </Box>
    );
}
