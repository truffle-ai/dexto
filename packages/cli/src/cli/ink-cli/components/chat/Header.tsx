/**
 * Header Component
 * Displays CLI branding and session information
 */

import React from 'react';
import { Box, Text } from 'ink';
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
                <Text color="gray">Model: </Text>
                <Text color="white">{modelName}</Text>
                {hasActiveSession && sessionId && (
                    <>
                        <Text color="gray"> • Session: </Text>
                        <Text color="white">{sessionId.slice(0, 8)}</Text>
                    </>
                )}
            </Box>

            {/* MCP Servers and Tools */}
            <Box flexDirection="row">
                <Text color="gray">Servers: </Text>
                <Text color="white">{startupInfo.connectedServers.count}</Text>
                <Text color="gray"> • Tools: </Text>
                <Text color="white">{startupInfo.toolCount}</Text>
            </Box>

            {/* Failed connections warning */}
            {startupInfo.failedConnections.length > 0 && (
                <Box flexDirection="row">
                    <Text color="yellowBright">
                        ⚠️ Failed: {startupInfo.failedConnections.join(', ')}
                    </Text>
                </Box>
            )}

            {/* Log file (hidden in privacy mode) */}
            {startupInfo.logFile && process.env.DEXTO_PRIVACY_MODE !== 'true' && (
                <Box flexDirection="row">
                    <Text color="gray">Logs: {startupInfo.logFile}</Text>
                </Box>
            )}

            {/* Update available notification */}
            {startupInfo.updateInfo && (
                <Box marginTop={1} flexDirection="row">
                    <Text color="yellow">
                        ⬆️ Update available: {startupInfo.updateInfo.current} →{' '}
                        {startupInfo.updateInfo.latest}
                    </Text>
                    <Text color="gray"> • Run: </Text>
                    <Text color="cyan">{startupInfo.updateInfo.updateCommand}</Text>
                </Box>
            )}

            {/* Agent sync notification */}
            {startupInfo.needsAgentSync && (
                <Box marginTop={startupInfo.updateInfo ? 0 : 1} flexDirection="row">
                    <Text color="yellow">🔄 Agent configs have updates available. Run: </Text>
                    <Text color="cyan">dexto sync-agents</Text>
                </Box>
            )}

            <Box marginBottom={1}>
                <Text> </Text>
            </Box>
        </Box>
    );
}
