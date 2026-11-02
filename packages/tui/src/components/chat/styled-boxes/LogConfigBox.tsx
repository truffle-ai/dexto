/**
 * LogConfigBox - Styled output for /log command (no args)
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { LogConfigStyledData } from '../../../state/types.js';
import { StyledBox, StyledRow, StyledListItem } from './StyledBox.js';
import { tone } from '../../../signal/index.js';

interface LogConfigBoxProps {
    data: LogConfigStyledData;
}

export function LogConfigBox({ data }: LogConfigBoxProps) {
    return (
        <StyledBox title="Logging Configuration">
            <Box marginTop={1} flexDirection="column">
                <StyledRow
                    label="Current level"
                    value={data.currentLevel}
                    valueColor={tone('add')}
                />
                {data.logFile ? <StyledRow label="Log file" value={data.logFile} /> : null}
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text color={tone('dim')}>Available levels (least to most verbose):</Text>
                {data.availableLevels.map((level) => {
                    const isCurrent = level === data.currentLevel;
                    return (
                        <StyledListItem
                            key={level}
                            icon={isCurrent ? '>' : ' '}
                            text={level}
                            isActive={isCurrent}
                        />
                    );
                })}
            </Box>

            <Box marginTop={1}>
                <Text color={tone('dim')}>Use /log &lt;level&gt; to change level</Text>
            </Box>
        </StyledBox>
    );
}
