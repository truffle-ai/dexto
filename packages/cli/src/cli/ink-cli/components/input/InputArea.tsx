/**
 * InputArea Component
 * Displays the input prompt and handles user input
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import CustomInput from '../CustomInput.js';

interface InputAreaProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    isProcessing: boolean;
    isDisabled: boolean;
    placeholder?: string | undefined;
    onWordDelete: () => void;
    onLineDelete: () => void;
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
}: InputAreaProps) {
    return (
        <Box borderStyle="single" borderColor="green" paddingX={1} flexDirection="row">
            <Text color="green" bold>
                {'> '}
            </Text>
            <Box flexGrow={1}>
                <CustomInput
                    value={value}
                    onChange={onChange}
                    onSubmit={onSubmit}
                    {...(placeholder ? { placeholder } : {})}
                    isProcessing={isDisabled}
                    onWordDelete={onWordDelete}
                    onLineDelete={onLineDelete}
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
    );
}
