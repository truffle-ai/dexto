import React from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface CustomInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    placeholder?: string;
    isProcessing?: boolean;
    onWordDelete?: () => void;
    onLineDelete?: () => void;
}

/**
 * Custom input component that handles keyboard shortcuts
 * Uses TextInput for actual input, handles shortcuts via useInput
 */
export default function CustomInput({
    value,
    onChange,
    onSubmit,
    placeholder,
    isProcessing = false,
    onWordDelete,
    onLineDelete,
}: CustomInputProps) {
    // Handle keyboard shortcuts via useInput
    // These shortcuts need to be intercepted before TextInput handles them
    useInput(
        (inputChar, key) => {
            if (isProcessing) return;

            // Handle word deletion (Ctrl+W) - Unix standard
            if (key.ctrl && inputChar === 'w') {
                onWordDelete?.();
                return;
            }

            // Handle Option+Delete alternative (Ctrl+Shift+Backspace)
            if (key.backspace && key.ctrl && key.shift) {
                onWordDelete?.();
                return;
            }

            // Handle line deletion (Cmd+Delete or Cmd+Backspace) - Mac standard
            if ((key.delete && key.meta) || (key.backspace && key.meta)) {
                onLineDelete?.();
                return;
            }

            // Handle Ctrl+U (line delete) - Unix standard
            if (key.ctrl && inputChar === 'u') {
                onLineDelete?.();
                return;
            }
        },
        { isActive: true }
    );

    return (
        <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            {...(placeholder ? { placeholder } : {})}
        />
    );
}
