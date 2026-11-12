/**
 * SyspromptBox - Styled output for /sysprompt command
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { SysPromptStyledData } from '../../../state/types.js';
import { StyledBox } from './StyledBox.js';
import { tone } from '../../../signal/index.js';

interface SyspromptBoxProps {
    data: SysPromptStyledData;
}

export function SyspromptBox({ data }: SyspromptBoxProps) {
    return (
        <StyledBox title="System Prompt" titleColor={tone('add')}>
            <Box marginTop={1} flexDirection="column">
                <Text>{data.content}</Text>
            </Box>
        </StyledBox>
    );
}
