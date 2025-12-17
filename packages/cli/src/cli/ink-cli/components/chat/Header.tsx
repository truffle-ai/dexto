/**
 * Header Component
 * Displays CLI branding and session information
 */

import React from 'react';
import { Box, Text } from 'ink';
import { getModelDisplayName } from '@dexto/core';
import type { StartupInfo } from '../../state/types.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';

interface HeaderProps {
    modelName: string;
    sessionId?: string | undefined;
    hasActiveSession: boolean;
    startupInfo: StartupInfo;
}

/**
 * Pure presentational component for CLI header
 * Automatically adjusts width to terminal size
 */
export function Header({ modelName, sessionId, hasActiveSession, startupInfo }: HeaderProps) {
    const { columns } = useTerminalSize();
    const displayModelName = getModelDisplayName(modelName);

    return (
        <Box
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
            flexDirection="column"
            flexShrink={0}
            width={columns}
        >
            <Box marginTop={1}>
                <Text color="greenBright">
                    {`██████╗ ███████╗██╗  ██╗████████╗ ██████╗
██╔══██╗██╔════╝╚██╗██╔╝╚══██╔══╝██╔═══██╗
██║  ██║█████╗   ╚███╔╝    ██║   ██║   ██║
██║  ██║██╔══╝   ██╔██╗    ██║   ██║   ██║
██████╔╝███████╗██╔╝ ██╗   ██║   ╚██████╔╝
╚═════╝ ╚══════╝╚═╝  ╚═╝   ╚═╝    ╚═════╝`}
                </Text>
            </Box>

            {/* Model and Session */}
            <Box marginTop={1} flexDirection="row">
                <Text color="gray" dimColor>
                    Model:{' '}
                </Text>
                <Text color="white">{displayModelName}</Text>
                {hasActiveSession && sessionId && (
                    <>
                        <Text color="gray" dimColor>
                            {' '}
                            • Session:{' '}
                        </Text>
                        <Text color="white">{sessionId.slice(0, 8)}</Text>
                    </>
                )}
            </Box>

            {/* MCP Servers and Tools */}
            <Box flexDirection="row">
                <Text color="gray" dimColor>
                    Servers:{' '}
                </Text>
                <Text color="white">{startupInfo.connectedServers.count}</Text>
                <Text color="gray" dimColor>
                    {' '}
                    • Tools:{' '}
                </Text>
                <Text color="white">{startupInfo.toolCount}</Text>
            </Box>

            {/* Failed connections warning */}
            {startupInfo.failedConnections.length > 0 && (
                <Box flexDirection="row">
                    <Text color="yellow">
                        ⚠️ Failed: {startupInfo.failedConnections.join(', ')}
                    </Text>
                </Box>
            )}

            {/* Log file */}
            {startupInfo.logFile && (
                <Box flexDirection="row">
                    <Text color="gray" dimColor>
                        Logs: {startupInfo.logFile}
                    </Text>
                </Box>
            )}

            <Box marginBottom={1}>
                <Text> </Text>
            </Box>
        </Box>
    );
}
