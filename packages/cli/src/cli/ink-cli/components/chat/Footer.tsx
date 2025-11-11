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
            <Text dimColor>Ctrl+C: exit • Esc: cancel • ↑↓: history • /help: commands</Text>
        </Box>
    );
}
