/**
 * ShortcutsBox - Styled output for /shortcuts command
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ShortcutsStyledData } from '../../../state/types.js';
import { StyledBox } from './StyledBox.js';

interface ShortcutsBoxProps {
    data: ShortcutsStyledData;
}

export function ShortcutsBox({ data }: ShortcutsBoxProps) {
    return (
        <StyledBox title="Keyboard Shortcuts">
            {data.categories.map((category, catIndex) => (
                <Box key={category.name} flexDirection="column" marginTop={catIndex === 0 ? 0 : 1}>
                    <Text bold color="cyan">
                        {category.name}
                    </Text>
                    {category.shortcuts.map((shortcut) => (
                        <Box key={shortcut.keys} marginLeft={2}>
                            <Box width={16}>
                                <Text color="cyan">{shortcut.keys}</Text>
                            </Box>
                            <Text color="gray">{shortcut.description}</Text>
                        </Box>
                    ))}
                </Box>
            ))}
        </StyledBox>
    );
}
