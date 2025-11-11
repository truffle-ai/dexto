/**
 * Footer Component
 * Displays keyboard shortcuts and help information
 */

import React from 'react';
import { Box, Text } from 'ink';

/**
 * Pure presentational component for CLI footer
 */
export function Footer() {
    return (
        <Box borderStyle="single" borderColor="gray" paddingX={1}>
            <Text dimColor>
                Shift+Enter: multi-line • Ctrl+W: del word • Ctrl+U: del line • Ctrl+C: exit •
                /help: commands
            </Text>
        </Box>
    );
}
