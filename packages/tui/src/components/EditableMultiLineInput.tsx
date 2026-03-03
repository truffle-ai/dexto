/**
 * Editable multi-line input component
 * Simple, reliable multi-line editor without complex box layouts
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

interface EditableMultiLineInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    placeholder?: string;
    isProcessing?: boolean;
    onToggleSingleLine?: () => void;
}

/**
 * Multi-line input with cursor navigation
 * Uses simple text rendering without nested boxes for reliable terminal display
 */
export default function EditableMultiLineInput({
    value,
    onChange,
    onSubmit,
    placeholder,
    isProcessing = false,
    onToggleSingleLine,
}: EditableMultiLineInputProps) {
    const [cursorPos, setCursorPos] = useState(value.length);

    // Keep cursor valid when value changes externally
    useEffect(() => {
        if (cursorPos > value.length) {
            setCursorPos(value.length);
        }
    }, [value, cursorPos]);

    // Calculate line info from cursor position
    const { lines, currentLine, currentCol, lineStartIndices } = useMemo(() => {
        const lines = value.split('\n');
        const lineStartIndices: number[] = [];
        let pos = 0;
        for (const line of lines) {
            lineStartIndices.push(pos);
            pos += line.length + 1;
        }

        let currentLine = 0;
        for (let i = 0; i < lineStartIndices.length; i++) {
            const lineEnd =
                i < lineStartIndices.length - 1 ? lineStartIndices[i + 1]! - 1 : value.length;
            if (cursorPos <= lineEnd || i === lineStartIndices.length - 1) {
                currentLine = i;
                break;
            }
        }

        const currentCol = cursorPos - (lineStartIndices[currentLine] ?? 0);
        return { lines, currentLine, currentCol, lineStartIndices };
    }, [value, cursorPos]);

    useInput(
        (inputChar, key) => {
            if (isProcessing) return;

            // Cmd/Ctrl+Enter = submit
            if (key.return && (key.meta || key.ctrl)) {
                onSubmit(value);
                return;
            }

            // Shift+Enter = toggle back to single-line
            // Note: Ctrl+E is reserved for standard "move to end of line" behavior
            if (key.return && key.shift) {
                onToggleSingleLine?.();
                return;
            }

            // Enter = newline
            if (key.return) {
                const newValue = value.slice(0, cursorPos) + '\n' + value.slice(cursorPos);
                onChange(newValue);
                setCursorPos(cursorPos + 1);
                return;
            }

            // Backspace
            if (key.backspace && cursorPos > 0) {
                onChange(value.slice(0, cursorPos - 1) + value.slice(cursorPos));
                setCursorPos(cursorPos - 1);
                return;
            }

            // Delete
            if (key.delete && cursorPos < value.length) {
                onChange(value.slice(0, cursorPos) + value.slice(cursorPos + 1));
                return;
            }

            // Arrow navigation
            if (key.leftArrow) {
                setCursorPos(Math.max(0, cursorPos - 1));
                return;
            }
            if (key.rightArrow) {
                setCursorPos(Math.min(value.length, cursorPos + 1));
                return;
            }
            if (key.upArrow && currentLine > 0) {
                const prevLineStart = lineStartIndices[currentLine - 1]!;
                const prevLineLen = lines[currentLine - 1]!.length;
                setCursorPos(prevLineStart + Math.min(currentCol, prevLineLen));
                return;
            }
            if (key.downArrow && currentLine < lines.length - 1) {
                const nextLineStart = lineStartIndices[currentLine + 1]!;
                const nextLineLen = lines[currentLine + 1]!.length;
                setCursorPos(nextLineStart + Math.min(currentCol, nextLineLen));
                return;
            }

            // Character input
            if (inputChar && !key.ctrl && !key.meta) {
                onChange(value.slice(0, cursorPos) + inputChar + value.slice(cursorPos));
                setCursorPos(cursorPos + inputChar.length);
            }
        },
        { isActive: true }
    );

    // Render each line with cursor
    const renderLine = (line: string, lineIdx: number) => {
        const lineStart = lineStartIndices[lineIdx]!;
        const isCursorLine = lineIdx === currentLine;
        const cursorCol = isCursorLine ? cursorPos - lineStart : -1;

        const prefix = lineIdx === 0 ? '» ' : '  ';

        if (cursorCol < 0) {
            // No cursor on this line
            return (
                <Text key={lineIdx}>
                    <Text color="cyan">{prefix}</Text>
                    <Text>{line || ' '}</Text>
                </Text>
            );
        }

        // Cursor on this line - highlight character at cursor
        const before = line.slice(0, cursorCol);
        const atCursor = line.charAt(cursorCol) || ' ';
        const after = line.slice(cursorCol + 1);

        return (
            <Text key={lineIdx}>
                <Text color="cyan">{prefix}</Text>
                <Text>{before}</Text>
                <Text backgroundColor="green" color="black">
                    {atCursor}
                </Text>
                <Text>{after}</Text>
            </Text>
        );
    };

    // Show placeholder if empty
    if (!value && placeholder) {
        return (
            <Box flexDirection="column">
                <Text>
                    <Text color="cyan">{'» '}</Text>
                    <Text backgroundColor="green" color="black">
                        {' '}
                    </Text>
                    <Text color="gray"> {placeholder}</Text>
                </Text>
                <Text color="gray">
                    Multi-line mode • Cmd/Ctrl+Enter to submit • Shift+Enter for single-line
                </Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column">
            {lines.map((line, idx) => renderLine(line, idx))}
            <Text color="gray">
                Multi-line mode • Cmd/Ctrl+Enter to submit • Shift+Enter for single-line
            </Text>
        </Box>
    );
}
