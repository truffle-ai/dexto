/**
 * Multi-line text input component
 *
 * Keyboard behavior (standard terminal-like):
 * - Typing: Characters appear at cursor position
 * - Backspace: Delete character before cursor
 * - Left/Right: Move cursor horizontally
 * - Up/Down: Navigate history (single line) or move between lines (multi-line)
 * - Enter: Submit
 * - Shift+Enter: Add newline
 * - Ctrl+A: Move to start of line
 * - Ctrl+E: Move to end of line
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

interface MultiLineTextInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    placeholder?: string | undefined;
    isDisabled?: boolean | undefined;
    // History support
    history?: string[] | undefined;
    historyIndex?: number | undefined;
    onHistoryNavigate?: ((direction: 'up' | 'down') => void) | undefined;
}

export function MultiLineTextInput({
    value,
    onChange,
    onSubmit,
    placeholder,
    isDisabled = false,
    history = [],
    historyIndex = -1,
    onHistoryNavigate,
}: MultiLineTextInputProps) {
    const [cursorPos, setCursorPos] = useState(value.length);
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns || 80;

    // Keep cursor valid when value changes externally (e.g., from history navigation)
    useEffect(() => {
        // When value changes externally, move cursor to end
        setCursorPos(value.length);
    }, [value]);

    // Calculate line info for cursor positioning
    const getLineInfo = useCallback(
        (pos: number) => {
            const lines = value.split('\n');
            let charCount = 0;
            let lineIndex = 0;
            let colIndex = 0;

            for (let i = 0; i < lines.length; i++) {
                const lineLength = lines[i]!.length;
                if (charCount + lineLength >= pos || i === lines.length - 1) {
                    lineIndex = i;
                    colIndex = pos - charCount;
                    break;
                }
                charCount += lineLength + 1; // +1 for newline
            }

            return { lines, lineIndex, colIndex, charCount };
        },
        [value]
    );

    // Get position at start of a line
    const getLineStart = useCallback(
        (lineIndex: number) => {
            const lines = value.split('\n');
            let pos = 0;
            for (let i = 0; i < lineIndex && i < lines.length; i++) {
                pos += lines[i]!.length + 1;
            }
            return pos;
        },
        [value]
    );

    useInput(
        (input, key) => {
            if (isDisabled) return;

            const lines = value.split('\n');
            const isMultiLine = lines.length > 1;
            const { lineIndex, colIndex } = getLineInfo(cursorPos);

            // Newline detection based on actual terminal behavior:
            // - Ctrl+J sends \n (0x0a) with NO ctrl flag (Enter sends \r with key.return)
            // - Shift+Enter sends backslash + \r (0x5c 0x0d) on many terminals
            // - Alt+Enter may set key.meta with key.return
            const isCtrlJ = input === '\n'; // Ctrl+J sends 0x0a, regular Enter sends 0x0d
            const isShiftEnter =
                input === '\\\r' ||
                (key.return && key.shift) ||
                input === '\x1b[13;2u' ||
                input === '\x1bOM';
            const wantsNewline = isCtrlJ || isShiftEnter || (key.return && key.meta);
            if (wantsNewline) {
                const newValue = value.slice(0, cursorPos) + '\n' + value.slice(cursorPos);
                onChange(newValue);
                setCursorPos(cursorPos + 1);
                return;
            }

            // Enter = submit
            if (key.return) {
                if (value.trim()) {
                    onSubmit(value);
                }
                return;
            }

            // Backspace - delete character before cursor
            const isBackspace = key.backspace || key.delete || input === '\x7f' || input === '\x08';
            if (isBackspace) {
                if (cursorPos > 0) {
                    const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
                    onChange(newValue);
                    setCursorPos(cursorPos - 1);
                }
                return;
            }

            // Left arrow
            if (key.leftArrow) {
                setCursorPos(Math.max(0, cursorPos - 1));
                return;
            }

            // Right arrow
            if (key.rightArrow) {
                setCursorPos(Math.min(value.length, cursorPos + 1));
                return;
            }

            // Up arrow
            if (key.upArrow) {
                if (isMultiLine && lineIndex > 0) {
                    const prevLineStart = getLineStart(lineIndex - 1);
                    const prevLineLength = lines[lineIndex - 1]!.length;
                    const newCol = Math.min(colIndex, prevLineLength);
                    setCursorPos(prevLineStart + newCol);
                } else if (onHistoryNavigate && history.length > 0) {
                    onHistoryNavigate('up');
                }
                return;
            }

            // Down arrow
            if (key.downArrow) {
                if (isMultiLine && lineIndex < lines.length - 1) {
                    const nextLineStart = getLineStart(lineIndex + 1);
                    const nextLineLength = lines[lineIndex + 1]!.length;
                    const newCol = Math.min(colIndex, nextLineLength);
                    setCursorPos(nextLineStart + newCol);
                } else if (onHistoryNavigate && historyIndex >= 0) {
                    onHistoryNavigate('down');
                }
                return;
            }

            // Ctrl+A - start of line
            if (key.ctrl && input === 'a') {
                setCursorPos(getLineStart(lineIndex));
                return;
            }

            // Ctrl+E - end of line
            if (key.ctrl && input === 'e') {
                const lineStart = getLineStart(lineIndex);
                setCursorPos(lineStart + lines[lineIndex]!.length);
                return;
            }

            // Ctrl+K - delete to end of line
            if (key.ctrl && input === 'k') {
                const lineStart = getLineStart(lineIndex);
                const lineEnd = lineStart + lines[lineIndex]!.length;
                if (cursorPos < lineEnd) {
                    onChange(value.slice(0, cursorPos) + value.slice(lineEnd));
                } else if (cursorPos < value.length) {
                    onChange(value.slice(0, cursorPos) + value.slice(cursorPos + 1));
                }
                return;
            }

            // Ctrl+U - delete to start of line
            if (key.ctrl && input === 'u') {
                const lineStart = getLineStart(lineIndex);
                if (cursorPos > lineStart) {
                    onChange(value.slice(0, lineStart) + value.slice(cursorPos));
                    setCursorPos(lineStart);
                }
                return;
            }

            // Ctrl+W - delete word
            if (key.ctrl && input === 'w') {
                if (cursorPos > 0) {
                    let wordStart = cursorPos - 1;
                    while (wordStart > 0 && value[wordStart] === ' ') wordStart--;
                    while (
                        wordStart > 0 &&
                        value[wordStart - 1] !== ' ' &&
                        value[wordStart - 1] !== '\n'
                    )
                        wordStart--;
                    onChange(value.slice(0, wordStart) + value.slice(cursorPos));
                    setCursorPos(wordStart);
                }
                return;
            }

            // Regular character input
            if (input && !key.ctrl && !key.meta) {
                const newValue = value.slice(0, cursorPos) + input + value.slice(cursorPos);
                onChange(newValue);
                setCursorPos(cursorPos + input.length);
            }
        },
        { isActive: !isDisabled }
    );

    // Helper to pad line to full terminal width
    const padLine = (content: string) => {
        const visibleLength = content.length;
        const padding = Math.max(0, terminalWidth - visibleLength);
        return content + ' '.repeat(padding);
    };

    // Empty state
    if (!value) {
        const emptyContent = '❯  ' + (placeholder || '');
        return (
            <Box width={terminalWidth}>
                <Text backgroundColor="#222">
                    <Text color="green" bold>
                        {'❯ '}
                    </Text>
                    <Text inverse> </Text>
                    {placeholder && <Text dimColor>{placeholder}</Text>}
                    <Text>
                        {' '.repeat(Math.max(0, terminalWidth - 3 - (placeholder?.length || 0)))}
                    </Text>
                </Text>
            </Box>
        );
    }

    // Render lines
    const lines = value.split('\n');
    const { lineIndex: cursorLine, colIndex: cursorCol } = getLineInfo(cursorPos);

    return (
        <Box flexDirection="column" width={terminalWidth}>
            {lines.map((line, idx) => {
                const prefix = idx === 0 ? '❯ ' : '  ';
                const isCursorLine = idx === cursorLine;
                const contentLength = prefix.length + line.length + 1; // +1 for cursor space
                const padding = ' '.repeat(Math.max(0, terminalWidth - contentLength));

                if (!isCursorLine) {
                    return (
                        <Box key={idx} width={terminalWidth}>
                            <Text backgroundColor="#222">
                                <Text color="green" bold={idx === 0}>
                                    {prefix}
                                </Text>
                                <Text>{line}</Text>
                                <Text>
                                    {' '.repeat(
                                        Math.max(0, terminalWidth - prefix.length - line.length)
                                    )}
                                </Text>
                            </Text>
                        </Box>
                    );
                }

                // Cursor line
                const before = line.slice(0, cursorCol);
                const atCursor = line.charAt(cursorCol) || ' ';
                const after = line.slice(cursorCol + 1);
                const cursorContentLength = prefix.length + before.length + 1 + after.length;

                return (
                    <Box key={idx} width={terminalWidth}>
                        <Text backgroundColor="#222">
                            <Text color="green" bold={idx === 0}>
                                {prefix}
                            </Text>
                            <Text>{before}</Text>
                            <Text inverse>{atCursor}</Text>
                            <Text>{after}</Text>
                            <Text>
                                {' '.repeat(Math.max(0, terminalWidth - cursorContentLength))}
                            </Text>
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}
