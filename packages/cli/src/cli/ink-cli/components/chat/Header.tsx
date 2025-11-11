/**
 * Header Component
 * Displays CLI branding and session information
 */

import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
    modelName: string;
    sessionId?: string | undefined;
    hasActiveSession: boolean;
}

/**
 * Pure presentational component for CLI header
 */
export function Header({ modelName, sessionId, hasActiveSession }: HeaderProps) {
    return (
        <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
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
            <Box marginTop={1} flexDirection="row">
                <Text color="gray" dimColor>
                    Model:{' '}
                </Text>
                <Text color="white">{modelName}</Text>
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
            <Box marginBottom={1}>
                <Text> </Text>
            </Box>
        </Box>
    );
}
