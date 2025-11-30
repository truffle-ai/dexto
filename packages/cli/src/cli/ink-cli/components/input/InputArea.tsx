/**
 * InputArea Component
 * Simple input area - Shift+Enter for newlines, Enter to submit
 */

import React, { forwardRef } from 'react';
import { Box } from 'ink';
import { MultiLineTextInput, type MultiLineTextInputHandle } from '../MultiLineTextInput.js';

export type InputAreaHandle = MultiLineTextInputHandle;

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

export const InputArea = forwardRef<InputAreaHandle, InputAreaProps>(
    (
        {
            value,
            onChange,
            onSubmit,
            isProcessing,
            isDisabled,
            placeholder,
            history,
            historyIndex,
            onHistoryNavigate,
        },
        ref
    ) => {
        return (
            <Box flexDirection="column">
                <MultiLineTextInput
                    ref={ref}
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
);
