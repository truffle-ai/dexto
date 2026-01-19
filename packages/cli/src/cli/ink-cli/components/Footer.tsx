/**
 * Footer Component
 * Status line at the bottom showing CWD, branch, and model info.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { getModelDisplayName } from '@dexto/core';

interface FooterProps {
    modelName: string;
    cwd?: string;
    branchName?: string;
    autoApproveEdits?: boolean;
    /** Whether user is in shell command mode (input starts with !) */
    isShellMode?: boolean;
}

/**
 * Shorten path for display
 */
function shortenPath(path: string, maxLength: number = 40): string {
    if (path.length <= maxLength) return path;

    // Replace home dir with ~
    const home = process.env['HOME'] || '';
    if (home && path.startsWith(home)) {
        path = '~' + path.slice(home.length);
    }

    if (path.length <= maxLength) return path;

    // Truncate from the beginning
    return '...' + path.slice(-(maxLength - 3));
}

/**
 * Pure presentational component for footer status line
 */
export function Footer({ modelName, cwd, branchName, autoApproveEdits, isShellMode }: FooterProps) {
    const displayPath = cwd ? shortenPath(cwd) : '';
    const displayModelName = getModelDisplayName(modelName);

    // Shell mode changes the path color to yellow as indicator
    const pathColor = isShellMode ? 'yellow' : 'blue';

    return (
        <Box flexDirection="column" paddingX={1}>
            {/* Line 1: CWD (left) | Model name (right) */}
            <Box flexDirection="row" justifyContent="space-between">
                <Box>
                    <Text color={pathColor}>{displayPath}</Text>
                    {branchName && <Text color="gray"> ({branchName})</Text>}
                </Box>
                <Text color="cyan">{displayModelName}</Text>
            </Box>

            {/* Line 2: Mode indicators (left) */}
            {isShellMode && (
                <Box>
                    <Text color="yellow" bold>
                        !
                    </Text>
                    <Text color="gray"> for shell mode</Text>
                </Box>
            )}
            {autoApproveEdits && !isShellMode && (
                <Box>
                    <Text color="yellowBright">accept edits</Text>
                    <Text color="gray"> (shift + tab to toggle)</Text>
                </Box>
            )}
        </Box>
    );
}
