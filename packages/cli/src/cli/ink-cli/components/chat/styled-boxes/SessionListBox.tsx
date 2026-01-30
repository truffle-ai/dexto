/**
 * SessionListBox - Styled output for /session list command
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { SessionListStyledData } from '../../../state/types.js';
import { StyledBox } from './StyledBox.js';

interface SessionListBoxProps {
    data: SessionListStyledData;
}

export function SessionListBox({ data }: SessionListBoxProps) {
    if (data.sessions.length === 0) {
        return (
            <StyledBox title="Sessions">
                <Box marginTop={1}>
                    <Text color="gray">No sessions found.</Text>
                </Box>
                <Box marginTop={1}>
                    <Text color="gray">Run `dexto` to start a new session.</Text>
                </Box>
            </StyledBox>
        );
    }

    return (
        <StyledBox title="Sessions">
            {data.sessions.map((session) => (
                <Box key={session.id} marginTop={1}>
                    <Box width={12}>
                        <Text color={session.isCurrent ? 'green' : 'cyan'} bold={session.isCurrent}>
                            {session.isCurrent ? '>' : ' '} {session.id.slice(0, 8)}
                        </Text>
                    </Box>
                    <Box width={14}>
                        <Text color="gray">{session.messageCount} messages</Text>
                    </Box>
                    <Text color="gray">{session.lastActive}</Text>
                </Box>
            ))}
            <Box marginTop={1}>
                <Text color="gray">Total: {data.total} sessions</Text>
            </Box>
            <Box>
                <Text color="gray">Use /resume to switch sessions</Text>
            </Box>
        </StyledBox>
    );
}
