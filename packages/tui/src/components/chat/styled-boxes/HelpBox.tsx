/**
 * HelpBox - Styled output for /help command
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { HelpStyledData } from '../../../state/types.js';
import { StyledBox } from './StyledBox.js';

interface HelpBoxProps {
    data: HelpStyledData;
}

export function HelpBox({ data }: HelpBoxProps) {
    // Group commands by category
    const categories = data.commands.reduce(
        (acc, cmd) => {
            const cat = cmd.category || 'Other';
            if (!acc[cat]) {
                acc[cat] = [];
            }
            acc[cat].push(cmd);
            return acc;
        },
        {} as Record<string, typeof data.commands>
    );

    return (
        <StyledBox title="Available Commands">
            {Object.entries(categories).map(([category, commands]) => (
                <Box key={category} flexDirection="column" marginTop={1}>
                    <Text bold color="gray">
                        {category}
                    </Text>
                    {commands.map((cmd) => (
                        <Box key={cmd.name} marginLeft={2}>
                            <Box width={16}>
                                <Text color="cyan">/{cmd.name}</Text>
                            </Box>
                            <Text color="gray">{cmd.description}</Text>
                        </Box>
                    ))}
                </Box>
            ))}
        </StyledBox>
    );
}
