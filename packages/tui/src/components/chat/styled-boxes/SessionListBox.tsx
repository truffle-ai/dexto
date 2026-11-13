/**
 * SessionListBox - Styled output for /session list command
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { SessionListStyledData } from '../../../state/types.js';
import { StyledBox } from './StyledBox.js';
import { tone } from '../../../signal/index.js';

interface SessionListBoxProps {
    data: SessionListStyledData;
}

export function SessionListBox({ data }: SessionListBoxProps) {
    if (data.sessions.length === 0) {
        return (
            <StyledBox title="Sessions">
                <Box marginTop={1}>
                    <Text color={tone('dim')}>No sessions found.</Text>
                </Box>
                <Box marginTop={1}>
                    <Text color={tone('dim')}>Run `dexto` to start a new session.</Text>
                </Box>
            </StyledBox>
        );
    }

    return (
        <StyledBox title="Sessions">
            {data.sessions.map((session) => (
                <Box key={session.id} marginTop={1}>
                    <Box width={12}>
                        <Text
                            color={session.isCurrent ? tone('add') : tone('teal')}
                            bold={session.isCurrent}
                        >
                            {session.isCurrent ? '>' : ' '} {session.id.slice(0, 8)}
                        </Text>
                    </Box>
                    <Box width={14}>
                        <Text color={tone('dim')}>{session.messageCount} messages</Text>
                    </Box>
                    <Text color={tone('dim')}>{session.lastActive}</Text>
                </Box>
            ))}
            <Box marginTop={1}>
                <Text color={tone('dim')}>Total: {data.total} sessions</Text>
            </Box>
            <Box>
                <Text color={tone('dim')}>Use /resume to switch sessions</Text>
            </Box>
        </StyledBox>
    );
}
