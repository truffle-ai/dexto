/**
 * InputArea Component
 * Simple input area - Shift+Enter for newlines, Enter to submit
 */

import React from 'react';
import { Box, Text } from 'ink';
import { MultiLineTextInput } from '../MultiLineTextInput.js';

interface InputAreaProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    isProcessing: boolean;
    isDisabled: boolean;
    placeholder?: string | undefined;
    // History props
    history?: string[] | undefined;
    historyIndex?: number | undefined;
    onHistoryNavigate?: ((direction: 'up' | 'down') => void) | undefined;
}

export function InputArea({
    value,
    onChange,
    onSubmit,
    isProcessing,
    isDisabled,
    placeholder,
    history,
    historyIndex,
    onHistoryNavigate,
}: InputAreaProps) {
    return (
        <Box flexDirection="column">
            <MultiLineTextInput
                value={value}
                onChange={onChange}
                onSubmit={onSubmit}
                placeholder={placeholder}
                isDisabled={isDisabled || isProcessing}
                history={history}
                historyIndex={historyIndex}
                onHistoryNavigate={onHistoryNavigate}
            />
        </Box>
    );
}
