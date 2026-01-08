import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

interface MultiLineInputProps {
    value: string;
    placeholder?: string;
    prompt?: string;
}

/**
 * Custom multi-line input display component
 * Calculates height based on content and displays text with proper line breaks
 */
export default function MultiLineInput({ value, placeholder, prompt = '> ' }: MultiLineInputProps) {
    // Calculate number of lines (split by newlines and count)
    const lines = useMemo(() => {
        if (!value) return [];
        return value.split('\n');
    }, [value]);

    const lineCount = lines.length;

    // If empty, show placeholder
    if (!value && placeholder) {
        return (
            <Box flexDirection="row">
                <Text color="green" bold>
                    {prompt}
                </Text>
                <Text color="gray">{placeholder}</Text>
            </Box>
        );
    }

    // Display multi-line text - show last N lines if too many
    const visibleLines = lineCount > 10 ? lines.slice(-10) : lines;
    const startOffset = lineCount > 10 ? lineCount - 10 : 0;

    return (
        <Box flexDirection="column">
            {startOffset > 0 && (
                <Box>
                    <Text color="gray">... ({startOffset} more lines above)</Text>
                </Box>
            )}
            {visibleLines.map((line, index) => {
                const actualIndex = startOffset + index;
                return (
                    <Box key={actualIndex} flexDirection="row">
                        {index === 0 && (
                            <Text color="green" bold>
                                {prompt}
                            </Text>
                        )}
                        {index > 0 && <Text color="green">{' '.repeat(prompt.length)}</Text>}
                        <Text wrap="wrap">{line || ' '}</Text>
                    </Box>
                );
            })}
        </Box>
    );
}
