/**
 * LogConfigBox - Styled output for /log command (no args)
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { LogConfigStyledData } from '../../../state/types.js';
import { StyledBox, StyledRow, StyledListItem } from './StyledBox.js';

interface LogConfigBoxProps {
    data: LogConfigStyledData;
}

export function LogConfigBox({ data }: LogConfigBoxProps) {
    return (
        <StyledBox title="Logging Configuration">
            <Box marginTop={1} flexDirection="column">
                <StyledRow label="Current level" value={data.currentLevel} valueColor="green" />
                {data.logFile && process.env.DEXTO_DEV_MODE === 'true' && (
                    <StyledRow label="Log file" value={data.logFile} />
                )}
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text color="gray">Available levels (least to most verbose):</Text>
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
                <Text color="gray">Use /log &lt;level&gt; to change level</Text>
            </Box>
        </StyledBox>
    );
}
