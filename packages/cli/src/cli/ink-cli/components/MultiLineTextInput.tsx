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

import React, {
    useState,
    useEffect,
    useCallback,
    forwardRef,
    useImperativeHandle,
    useRef,
} from 'react';
import { Box, Text, useStdout } from 'ink';
import type { Key } from '../hooks/useInputOrchestrator.js';

/** Overlay trigger types for event-driven overlay detection */
export type OverlayTrigger = 'slash-autocomplete' | 'resource-autocomplete' | 'close';

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
    // Overlay trigger callback - called when trigger characters are typed/removed
    onTriggerOverlay?: ((trigger: OverlayTrigger) => void) | undefined;
}

export interface MultiLineTextInputHandle {
    handleInput: (input: string, key: Key) => boolean;
}

/**
 * Check if the input is a backspace key (delete character BEFORE cursor)
 * Handles various terminal implementations
 *
 * IMPORTANT: Ink treats \x7f (DEL, what macOS sends for Backspace) as key.delete,
 * not key.backspace. When Ink parses \x7f, it sets:
 * - key.delete = true
 * - input = '' (EMPTY STRING, not '\x7f'!)
 *
 * Forward delete sends escape sequence \x1b[3~ which Ink doesn't specially parse,
 * so input contains the escape sequence.
 */
function isBackspaceKey(input: string, key: Key): boolean {
    // Check key.backspace (Ink's parsed value for \b / 0x08)
    if (key.backspace) return true;

    // macOS backspace: Ink sets key.delete=true and input='' (empty)
    // Forward delete: input contains escape sequence like '\x1b[3~'
    // So if key.delete is true and input is empty or \x7f, it's backspace
    if (key.delete && (input === '' || input === '\x7f' || input === '\x1b\x7f')) return true;

    // Fallback: Check raw character codes directly
    if (input === '\x7f') return true; // DEL (127) - macOS backspace
    if (input === '\x08') return true; // BS (8) - some terminals
    if (input.length === 1) {
        const code = input.charCodeAt(0);
        if (code === 127 || code === 8) return true;
    }

    return false;
}

/**
 * Check if the input is a forward delete key (delete character AT cursor)
 * Forward delete on Mac sends escape sequence \x1b[3~ which Ink passes through
 */
function isForwardDeleteKey(input: string, key: Key): boolean {
    // Forward delete: key.delete may or may not be true, but input is escape sequence
    // Check for escape sequence pattern
    if (input.startsWith('\x1b[') && input.includes('3~')) return true;
    // If key.delete is true but input is NOT empty (that's backspace), it might be forward delete
    if (key.delete && input !== '' && input !== '\x7f' && input !== '\x1b\x7f') return true;
    return false;
}

export const MultiLineTextInput = forwardRef<MultiLineTextInputHandle, MultiLineTextInputProps>(
    function MultiLineTextInput(
        {
            value,
            onChange,
            onSubmit,
            placeholder,
            isDisabled = false,
            history = [],
            historyIndex = -1,
            onHistoryNavigate,
            onTriggerOverlay,
        },
        ref
    ) {
        const [cursorPos, setCursorPos] = useState(value.length);
        // Use refs to always have latest values (avoids stale closure issues)
        // This is critical because handleInput is called imperatively, not through React's render cycle
        const cursorPosRef = useRef(cursorPos);
        const valueRef = useRef(value);
        const { stdout } = useStdout();
        const terminalWidth = stdout?.columns || 80;

        // Keep refs in sync with state/props
        useEffect(() => {
            cursorPosRef.current = cursorPos;
        }, [cursorPos]);

        useEffect(() => {
            valueRef.current = value;
        }, [value]);

        // Keep cursor valid when value changes externally (e.g., from history navigation, Tab load)
        // Track previous value length to detect autocomplete loads
        const prevValueLengthRef = useRef(value.length);

        useEffect(() => {
            const prevLength = prevValueLengthRef.current;
            const newLength = value.length;

            // If cursor would be past end, move it to end
            if (cursorPos > newLength) {
                setCursorPos(newLength);
            }
            // If value significantly increased (Tab load), move cursor to end
            // This handles Tab autocomplete while preserving normal typing behavior
            else if (newLength > prevLength + 1 && cursorPos <= prevLength) {
                setCursorPos(newLength);
            }

            prevValueLengthRef.current = newLength;
        }, [value, cursorPos]);

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

        // Helper to update cursor position (both state and ref synchronously)
        const updateCursorPos = useCallback((newPos: number) => {
            cursorPosRef.current = newPos;
            setCursorPos(newPos);
        }, []);

        // Helper to update value ref synchronously AND call onChange
        // This ensures the next keypress sees the updated value immediately
        const updateValue = useCallback(
            (newValue: string) => {
                valueRef.current = newValue;
                onChange(newValue);
            },
            [onChange]
        );

        // Expose handleInput method via ref
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (isDisabled) return false;

                    // Use refs to avoid stale closure issues - critical for rapid keypresses
                    const currentCursorPos = cursorPosRef.current;
                    const currentValue = valueRef.current;
                    const lines = currentValue.split('\n');
                    const isMultiLine = lines.length > 1;
                    const { lineIndex, colIndex } = getLineInfo(currentCursorPos);

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
                        const newValue =
                            currentValue.slice(0, currentCursorPos) +
                            '\n' +
                            currentValue.slice(currentCursorPos);
                        updateValue(newValue);
                        updateCursorPos(currentCursorPos + 1);
                        return true;
                    }

                    // Enter = submit
                    if (key.return) {
                        if (currentValue.trim()) {
                            onSubmit(currentValue);
                        }
                        return true;
                    }

                    // Backspace - delete character before cursor
                    if (isBackspaceKey(input, key)) {
                        if (currentCursorPos > 0) {
                            const deletedChar = currentValue[currentCursorPos - 1];
                            const newValue =
                                currentValue.slice(0, currentCursorPos - 1) +
                                currentValue.slice(currentCursorPos);
                            updateValue(newValue);
                            updateCursorPos(currentCursorPos - 1);

                            // Event-driven overlay close detection
                            if (onTriggerOverlay) {
                                // If we deleted '/' from start of line, close slash-autocomplete
                                if (deletedChar === '/' && currentCursorPos === 1) {
                                    onTriggerOverlay('close');
                                }
                                // If we deleted '@' and no more '@' in value, close resource-autocomplete
                                else if (deletedChar === '@' && !newValue.includes('@')) {
                                    onTriggerOverlay('close');
                                }
                            }
                        }
                        return true;
                    }

                    // Delete - delete character at cursor (forward delete)
                    // Use isForwardDeleteKey to differentiate from macOS backspace
                    if (isForwardDeleteKey(input, key)) {
                        if (currentCursorPos < currentValue.length) {
                            const newValue =
                                currentValue.slice(0, currentCursorPos) +
                                currentValue.slice(currentCursorPos + 1);
                            updateValue(newValue);
                        }
                        return true;
                    }

                    // Left arrow
                    if (key.leftArrow) {
                        updateCursorPos(Math.max(0, currentCursorPos - 1));
                        return true;
                    }

                    // Right arrow
                    if (key.rightArrow) {
                        updateCursorPos(Math.min(currentValue.length, currentCursorPos + 1));
                        return true;
                    }

                    // Up arrow
                    if (key.upArrow) {
                        if (isMultiLine && lineIndex > 0) {
                            const prevLineStart = getLineStart(lineIndex - 1);
                            const prevLineLength = lines[lineIndex - 1]!.length;
                            const newCol = Math.min(colIndex, prevLineLength);
                            updateCursorPos(prevLineStart + newCol);
                        } else if (onHistoryNavigate && history.length > 0) {
                            onHistoryNavigate('up');
                        }
                        return true;
                    }

                    // Down arrow
                    if (key.downArrow) {
                        if (isMultiLine && lineIndex < lines.length - 1) {
                            const nextLineStart = getLineStart(lineIndex + 1);
                            const nextLineLength = lines[lineIndex + 1]!.length;
                            const newCol = Math.min(colIndex, nextLineLength);
                            updateCursorPos(nextLineStart + newCol);
                        } else if (onHistoryNavigate && historyIndex >= 0) {
                            onHistoryNavigate('down');
                        }
                        return true;
                    }

                    // Ctrl+A - start of line
                    if (key.ctrl && input === 'a') {
                        updateCursorPos(getLineStart(lineIndex));
                        return true;
                    }

                    // Ctrl+E - end of line
                    if (key.ctrl && input === 'e') {
                        const lineStart = getLineStart(lineIndex);
                        updateCursorPos(lineStart + lines[lineIndex]!.length);
                        return true;
                    }

                    // Ctrl+K - delete to end of line
                    if (key.ctrl && input === 'k') {
                        const lineStart = getLineStart(lineIndex);
                        const lineEnd = lineStart + lines[lineIndex]!.length;
                        if (currentCursorPos < lineEnd) {
                            updateValue(
                                currentValue.slice(0, currentCursorPos) +
                                    currentValue.slice(lineEnd)
                            );
                        } else if (currentCursorPos < currentValue.length) {
                            updateValue(
                                currentValue.slice(0, currentCursorPos) +
                                    currentValue.slice(currentCursorPos + 1)
                            );
                        }
                        return true;
                    }

                    // Ctrl+U - delete to start of line
                    if (key.ctrl && input === 'u') {
                        const lineStart = getLineStart(lineIndex);
                        if (currentCursorPos > lineStart) {
                            updateValue(
                                currentValue.slice(0, lineStart) +
                                    currentValue.slice(currentCursorPos)
                            );
                            updateCursorPos(lineStart);
                        }
                        return true;
                    }

                    // Ctrl+W - delete word
                    if (key.ctrl && input === 'w') {
                        if (currentCursorPos > 0) {
                            let wordStart = currentCursorPos - 1;
                            while (wordStart > 0 && currentValue[wordStart] === ' ') wordStart--;
                            while (
                                wordStart > 0 &&
                                currentValue[wordStart - 1] !== ' ' &&
                                currentValue[wordStart - 1] !== '\n'
                            )
                                wordStart--;
                            updateValue(
                                currentValue.slice(0, wordStart) +
                                    currentValue.slice(currentCursorPos)
                            );
                            updateCursorPos(wordStart);
                        }
                        return true;
                    }

                    // Regular character input - must NOT match backspace
                    // (backspace check is above, so we only get here for non-backspace)
                    if (input && !key.ctrl && !key.meta && !isBackspaceKey(input, key)) {
                        const newValue =
                            currentValue.slice(0, currentCursorPos) +
                            input +
                            currentValue.slice(currentCursorPos);
                        updateValue(newValue);
                        updateCursorPos(currentCursorPos + input.length);

                        // Event-driven overlay trigger detection
                        // Detect trigger characters immediately when typed (not via useEffect)
                        if (onTriggerOverlay) {
                            // '/' at start of line triggers slash-autocomplete
                            if (input === '/' && currentCursorPos === 0) {
                                onTriggerOverlay('slash-autocomplete');
                            }
                            // '@' anywhere triggers resource-autocomplete
                            else if (input === '@') {
                                onTriggerOverlay('resource-autocomplete');
                            }
                        }

                        return true;
                    }

                    return false;
                },
            }),
            [
                onSubmit,
                isDisabled,
                getLineInfo,
                getLineStart,
                history,
                historyIndex,
                onHistoryNavigate,
                onTriggerOverlay,
                updateCursorPos,
                updateValue,
            ]
        );

        // Helper to pad line to full terminal width
        const padLine = (content: string) => {
            const visibleLength = content.length;
            const padding = Math.max(0, terminalWidth - visibleLength);
            return content + ' '.repeat(padding);
        };

        const separator = '─'.repeat(terminalWidth);

        // Empty state
        if (!value) {
            const emptyContent = '>  ' + (placeholder || '');
            return (
                <Box flexDirection="column" width={terminalWidth}>
                    <Text color="gray" dimColor>
                        {separator}
                    </Text>
                    <Box width={terminalWidth}>
                        <Text color="green" bold>
                            {'> '}
                        </Text>
                        <Text inverse> </Text>
                        {placeholder && <Text dimColor>{placeholder}</Text>}
                        <Text>
                            {' '.repeat(
                                Math.max(0, terminalWidth - 3 - (placeholder?.length || 0))
                            )}
                        </Text>
                    </Box>
                    <Text color="gray" dimColor>
                        {separator}
                    </Text>
                </Box>
            );
        }

        // Render lines
        const lines = value.split('\n');
        const { lineIndex: cursorLine, colIndex: cursorCol } = getLineInfo(cursorPos);

        return (
            <Box flexDirection="column" width={terminalWidth}>
                <Text color="gray" dimColor>
                    {separator}
                </Text>
                {lines.map((line, idx) => {
                    const prefix = idx === 0 ? '> ' : '  ';
                    const isCursorLine = idx === cursorLine;
                    const contentLength = prefix.length + line.length + 1; // +1 for cursor space
                    const padding = ' '.repeat(Math.max(0, terminalWidth - contentLength));

                    if (!isCursorLine) {
                        return (
                            <Box key={idx} width={terminalWidth}>
                                <Text color="green" bold={idx === 0}>
                                    {prefix}
                                </Text>
                                <Text>{line}</Text>
                                <Text>
                                    {' '.repeat(
                                        Math.max(0, terminalWidth - prefix.length - line.length)
                                    )}
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
                            <Text color="green" bold={idx === 0}>
                                {prefix}
                            </Text>
                            <Text>{before}</Text>
                            <Text inverse>{atCursor}</Text>
                            <Text>{after}</Text>
                            <Text>
                                {' '.repeat(Math.max(0, terminalWidth - cursorContentLength))}
                            </Text>
                        </Box>
                    );
                })}
                <Text color="gray" dimColor>
                    {separator}
                </Text>
            </Box>
        );
    }
);
