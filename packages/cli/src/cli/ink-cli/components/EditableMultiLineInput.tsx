/**
 * Editable multi-line input component
 * Allows editing text with newlines, submission with Cmd+Enter
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';

interface EditableMultiLineInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    placeholder?: string;
    isProcessing?: boolean;
    onToggleSingleLine?: () => void; // Shift+Enter to go back to single-line
}

/**
 * Multi-line input component
 * - Enter adds newline
 * - Cmd+Enter or Ctrl+Enter to submit
 * - Shift+Enter to toggle back to single-line
 */
export default function EditableMultiLineInput({
    value,
    onChange,
    onSubmit,
    placeholder,
    isProcessing = false,
    onToggleSingleLine,
}: EditableMultiLineInputProps) {
    useInput(
        (inputChar, key) => {
            if (isProcessing) return;

            // Cmd+Enter or Ctrl+Enter = submit
            if (key.return && (key.meta || key.ctrl)) {
                onSubmit(value);
                return;
            }

            // Shift+Enter = toggle back to single-line mode
            if (key.return && key.shift) {
                onToggleSingleLine?.();
                return;
            }

            // Enter = add newline
            if (key.return) {
                onChange(value + '\n');
                return;
            }

            // Backspace = delete last character
            if (key.backspace || key.delete) {
                onChange(value.slice(0, -1));
                return;
            }

            // Regular character input (ignore modifier key combinations)
            if (inputChar && !key.ctrl && !key.meta) {
                onChange(value + inputChar);
            }
        },
        { isActive: true }
    );

    // Split into lines for display
    const lines = value ? value.split('\n') : [''];
    const MAX_VISIBLE_LINES = 10;

    // Calculate visible lines (show last N lines if content is too long)
    const visibleLines = lines.length > MAX_VISIBLE_LINES ? lines.slice(-MAX_VISIBLE_LINES) : lines;
    const hiddenCount = lines.length - visibleLines.length;

    return (
        <Box flexDirection="column" paddingY={1}>
            {hiddenCount > 0 && (
                <Box paddingX={1}>
                    <Text color="gray" dimColor>
                        ... ({hiddenCount} more lines above)
                    </Text>
                </Box>
            )}
            {visibleLines.map((line, index) => {
                const isFirstVisibleLine = index === 0;
                const isLastLine = index === visibleLines.length - 1;

                return (
                    <Box key={index} flexDirection="row">
                        {isFirstVisibleLine ? (
                            <Text color="green" bold>
                                {'> '}
                            </Text>
                        ) : (
                            <Text color="green" dimColor>
                                {'  '}
                            </Text>
                        )}
                        <Text>
                            {!value && isFirstVisibleLine && placeholder ? (
                                <Text dimColor>{placeholder}</Text>
                            ) : (
                                line || ' '
                            )}
                            {isLastLine && <Text color="green">▋</Text>}
                        </Text>
                    </Box>
                );
            })}
            <Box marginTop={1}>
                <Text color="gray" dimColor>
                    Multi-line: Cmd+Enter (or Ctrl+Enter) to submit • Shift+Enter for single-line
                </Text>
            </Box>
        </Box>
    );
}
