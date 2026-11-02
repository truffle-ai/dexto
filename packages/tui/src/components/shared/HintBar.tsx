import React from 'react';
import { Text } from 'ink';
import { tone } from '../../signal/index.js';

export interface HintBarProps {
    hints: readonly string[];
    separator?: string;
}

export function HintBar({ hints, separator = ' • ' }: HintBarProps) {
    const line = hints.filter(Boolean).join(separator);
    return (
        <Text color={tone('dim')} wrap="truncate-end">
            {line}
        </Text>
    );
}
