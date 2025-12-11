/**
 * Footer Component
 * Status line at the bottom showing CWD, branch, and model info.
 */

import React from 'react';
import { Box, Text } from 'ink';

interface FooterProps {
    modelName: string;
    cwd?: string;
    branchName?: string;
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
export function Footer({ modelName, cwd, branchName }: FooterProps) {
    const displayPath = cwd ? shortenPath(cwd) : '';

    return (
        <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
            {/* Left: CWD and branch */}
            <Box>
                <Text color="blue">{displayPath}</Text>
                {branchName && (
                    <Text color="gray" dimColor>
                        {' '}
                        ({branchName})
                    </Text>
                )}
            </Box>

            {/* Right: Model name */}
            <Box>
                <Text color="cyan">{modelName}</Text>
            </Box>
        </Box>
    );
}
