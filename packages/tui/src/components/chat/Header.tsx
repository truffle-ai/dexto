/**
 * Header Component
 * Displays CLI branding and session information
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { StartupInfo } from '../../state/types.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { tone, useCaps } from '../../signal/index.js';
import { SignalHeader } from './SignalHeader.js';

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
    const signal = useCaps().palette === 'signal';
    // Signal draws the wordmark from the real logo in place of the block letters.
    if (signal)
        return (
            <SignalHeader
                modelName={modelName}
                sessionId={sessionId}
                hasActiveSession={hasActiveSession}
                startupInfo={startupInfo}
            />
        );

    return (
        <Box
            borderStyle="single"
            borderColor={tone('dim')}
            paddingX={1}
            flexDirection="column"
            flexShrink={0}
            width={columns}
        >
            <Box marginTop={1}>
                <Text color={tone('tealDim')}>
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
                <Text color={tone('dim')}>Model: </Text>
                <Text color={tone('hi')}>{modelName}</Text>
                {hasActiveSession && sessionId && (
                    <>
                        <Text color={tone('dim')}> • Session: </Text>
                        <Text color={tone('hi')}>{sessionId.slice(0, 8)}</Text>
                    </>
                )}
            </Box>

            {/* MCP Servers and Tools */}
            <Box flexDirection="row">
                <Text color={tone('dim')}>Servers: </Text>
                <Text color={tone('hi')}>{startupInfo.connectedServers.count}</Text>
                <Text color={tone('dim')}> • Tools: </Text>
                <Text color={tone('hi')}>{startupInfo.toolCount}</Text>
            </Box>

            {/* Failed connections warning */}
            {startupInfo.failedConnections.length > 0 && (
                <Box flexDirection="row">
                    <Text color={tone('amber')}>
                        ⚠️ Failed: {startupInfo.failedConnections.join(', ')}
                    </Text>
                </Box>
            )}

            {/* Update available notification */}
            {startupInfo.updateInfo && (
                <Box marginTop={1} flexDirection="row">
                    <Text color={tone('amberDim')}>
                        ⬆️ Update available: {startupInfo.updateInfo.current} →{' '}
                        {startupInfo.updateInfo.latest}
                    </Text>
                    <Text color={tone('dim')}> • Run: </Text>
                    <Text color={tone('teal')}>{startupInfo.updateInfo.updateCommand}</Text>
                </Box>
            )}

            {/* Agent sync notification */}
            {startupInfo.needsAgentSync && (
                <Box marginTop={startupInfo.updateInfo ? 0 : 1} flexDirection="row">
                    <Text color={tone('amberDim')}>
                        🔄 Agent configs have updates available. Run:{' '}
                    </Text>
                    <Text color={tone('teal')}>dexto sync-agents</Text>
                </Box>
            )}

            <Box marginBottom={1}>
                <Text> </Text>
            </Box>
        </Box>
    );
}
