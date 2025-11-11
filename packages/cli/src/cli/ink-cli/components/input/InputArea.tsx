/**
 * InputArea Component
 * Displays the input prompt and handles user input
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import CustomInput from '../CustomInput.js';
import EditableMultiLineInput from '../EditableMultiLineInput.js';

interface InputAreaProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    isProcessing: boolean;
    isDisabled: boolean;
    placeholder?: string | undefined;
    onWordDelete?: () => void;
    onLineDelete?: () => void;
    remountKey?: number; // Key to force TextInput remount for cursor positioning
    isMultiLine?: boolean; // Whether multi-line input mode is active
    onToggleMultiLine?: () => void; // Toggle multi-line mode
}

/**
 * Pure presentational component for input area
 */
export function InputArea({
    value,
    onChange,
    onSubmit,
    isProcessing,
    isDisabled,
    placeholder,
    onWordDelete,
    onLineDelete,
    remountKey = 0,
    isMultiLine = false,
    onToggleMultiLine,
}: InputAreaProps) {
    return (
        <Box borderStyle="single" borderColor="green" paddingX={1} flexDirection="column">
            {isMultiLine ? (
                <EditableMultiLineInput
                    value={value}
                    onChange={onChange}
                    onSubmit={onSubmit}
                    {...(placeholder && { placeholder })}
                    {...(isDisabled && { isProcessing: isDisabled })}
                    {...(onToggleMultiLine && { onToggleSingleLine: onToggleMultiLine })}
                />
            ) : (
                <Box flexDirection="row">
                    <Text color="green" bold>
                        {'> '}
                    </Text>
                    <Box flexGrow={1}>
                        <CustomInput
                            key={remountKey}
                            value={value}
                            onChange={onChange}
                            onSubmit={onSubmit}
                            {...(placeholder && { placeholder })}
                            {...(isDisabled && { isProcessing: isDisabled })}
                            {...(onWordDelete && { onWordDelete })}
                            {...(onLineDelete && { onLineDelete })}
                            {...(onToggleMultiLine && { onToggleMultiLine })}
                        />
                    </Box>
                    {isProcessing && (
                        <Box marginLeft={1}>
                            <Text color="yellow">
                                <Spinner type="dots" />
                            </Text>
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}
