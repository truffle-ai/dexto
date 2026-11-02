/**
 * SessionHistoryBox - Styled output for /session history command
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { SessionHistoryStyledData } from '../../../state/types.js';
import { StyledBox } from './StyledBox.js';
import { tone } from '../../../signal/index.js';

interface SessionHistoryBoxProps {
    data: SessionHistoryStyledData;
}

/**
 * Truncate content to a reasonable preview length
 */
function truncateContent(content: string, maxLength: number = 100): string {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '...';
}

/**
 * Get role color and icon
 */
function getRoleStyle(role: string): { color: string; icon: string } {
    switch (role) {
        case 'user':
            return { color: tone('fg'), icon: '>' };
        case 'assistant':
            return { color: tone('add'), icon: '|' };
        case 'system':
            return { color: 'orange', icon: '#' };
        case 'tool':
            return { color: tone('add'), icon: '*' };
        default:
            return { color: tone('hi'), icon: '-' };
    }
}

export function SessionHistoryBox({ data }: SessionHistoryBoxProps) {
    if (data.messages.length === 0) {
        return (
            <StyledBox title={`Session History: ${data.sessionId.slice(0, 8)}`}>
                <Box marginTop={1}>
                    <Text color={tone('dim')}>No messages in this session yet.</Text>
                </Box>
            </StyledBox>
        );
    }

    return (
        <StyledBox title={`Session History: ${data.sessionId.slice(0, 8)}`}>
            {data.messages.map((msg, index) => {
                const style = getRoleStyle(msg.role);
                return (
                    <Box key={index} flexDirection="column" marginTop={index === 0 ? 1 : 0}>
                        <Box>
                            <Text color={style.color} bold>
                                {style.icon}{' '}
                            </Text>
                            <Text color={style.color}>[{msg.role}]</Text>
                            <Text color={tone('dim')}> {msg.timestamp}</Text>
                        </Box>
                        <Box marginLeft={2}>
                            <Text>{truncateContent(msg.content)}</Text>
                        </Box>
                    </Box>
                );
            })}
            <Box marginTop={1}>
                <Text color={tone('dim')}>Total: {data.total} messages</Text>
            </Box>
        </StyledBox>
    );
}
