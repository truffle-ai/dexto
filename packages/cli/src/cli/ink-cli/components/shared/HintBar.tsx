import React from 'react';
import { Text } from 'ink';

export interface HintBarProps {
    hints: readonly string[];
    separator?: string;
}

export function HintBar({ hints, separator = ' • ' }: HintBarProps) {
    const line = hints.filter(Boolean).join(separator);
    return (
        <Text color="gray" wrap="truncate-end">
            {line}
        </Text>
    );
}
