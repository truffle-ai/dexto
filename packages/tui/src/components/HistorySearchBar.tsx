/**
 * HistorySearchBar - UI for Ctrl+R reverse history search
 *
 * Displayed at the very bottom when search mode is active.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { tone } from '../signal/index.js';

interface HistorySearchBarProps {
    /** Current search query */
    query: string;
    /** Whether there's a match for the current query */
    hasMatch: boolean;
}

/**
 * Search bar displayed during history search mode
 */
export function HistorySearchBar({ query, hasMatch }: HistorySearchBarProps) {
    return (
        <Box flexDirection="column" paddingX={1}>
            {/* Hints on separate line above */}
            <Text color={tone('dim')}>
                Ctrl+R: older, Ctrl+E: newer, Enter: accept, Esc: cancel
            </Text>
            {/* Search query line */}
            <Box>
                <Text color={tone('add')}>search history: </Text>
                <Text color={tone('teal')}>{query}</Text>
                <Text color={tone('dim')}>_</Text>
                {query && !hasMatch && <Text color={tone('red')}> (no match)</Text>}
            </Box>
        </Box>
    );
}
