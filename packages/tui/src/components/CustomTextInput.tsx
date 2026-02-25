import React from 'react';
import { useInput } from 'ink';
import TextInput from 'ink-text-input';

interface CustomTextInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    placeholder?: string;
    onWordDelete?: () => void;
    onLineDelete?: () => void;
    onNewline?: () => void;
}

/**
 * Custom TextInput wrapper that handles keyboard shortcuts
 * before TextInput consumes them
 */
export default function CustomTextInput({
    value,
    onChange,
    onSubmit,
    placeholder,
    onWordDelete,
    onLineDelete,
    onNewline,
}: CustomTextInputProps) {
    // Use useInput to intercept keyboard shortcuts
    // This needs to run with isActive: true to intercept before TextInput
    useInput(
        (inputChar, key) => {
            // Handle Shift+Enter or Ctrl+E to toggle multi-line mode
            // Note: Shift+Enter may not work in all terminals, Ctrl+E is more reliable
            if ((key.return && key.shift) || (key.ctrl && inputChar === 'e')) {
                onNewline?.();
                return;
            }

            // Handle word deletion (Cmd+Delete or Cmd+Backspace on Mac, Ctrl+Delete or Ctrl+Backspace on Windows/Linux)
            // Note: On Mac, Cmd+Backspace is the standard for word deletion
            if ((key.delete || key.backspace) && (key.meta || key.ctrl)) {
                onWordDelete?.();
                return;
            }

            // Handle line deletion (Cmd+Shift+Delete or Ctrl+U)
            if ((key.delete && key.meta && key.shift) || (key.ctrl && inputChar === 'u')) {
                onLineDelete?.();
                return;
            }

            // Handle Ctrl+Shift+Delete as additional word deletion shortcut (Windows/Linux)
            if (key.delete && key.ctrl && key.shift) {
                onWordDelete?.();
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
