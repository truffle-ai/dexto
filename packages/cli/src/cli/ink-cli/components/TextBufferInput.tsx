/**
 * TextBufferInput Component
 *
 * Following Gemini CLI's pattern - buffer is passed as prop from parent.
 * Uses direct useKeypress for input handling (no ref chain).
 * Parent owns the buffer and can read values directly.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import type { TextBuffer } from './shared/text-buffer.js';
import type { PendingImage } from '../state/types.js';
import { readClipboardImage } from '../utils/clipboardUtils.js';

/** Overlay trigger types for event-driven overlay detection */
export type OverlayTrigger = 'slash-autocomplete' | 'resource-autocomplete' | 'close';

interface TextBufferInputProps {
    /** Text buffer (owned by parent) */
    buffer: TextBuffer;
    /** Called when user presses Enter to submit */
    onSubmit: (value: string) => void;
    /** Placeholder text when empty */
    placeholder?: string | undefined;
    /** Whether input handling is disabled (e.g., during processing) */
    isDisabled?: boolean | undefined;
    /** Called for history navigation (up/down at boundaries) */
    onHistoryNavigate?: ((direction: 'up' | 'down') => void) | undefined;
    /** Called to trigger overlay (slash command, @mention) */
    onTriggerOverlay?: ((trigger: OverlayTrigger) => void) | undefined;
    /** Maximum lines to show in viewport */
    maxViewportLines?: number | undefined;
    /** Whether this input should handle keypresses */
    isActive: boolean;
    /** Optional handler for keyboard scroll (PageUp/PageDown, Shift+arrows) */
    onKeyboardScroll?: ((direction: 'up' | 'down') => void) | undefined;
    /** Current number of attached images (for placeholder numbering) */
    imageCount?: number | undefined;
    /** Called when image is pasted from clipboard */
    onImagePaste?: ((image: PendingImage) => void) | undefined;
    /** Current pending images (for placeholder removal detection) */
    images?: PendingImage[] | undefined;
    /** Called when an image placeholder is removed from text */
    onImageRemove?: ((imageId: string) => void) | undefined;
}

function isBackspaceKey(key: Key): boolean {
    return key.name === 'backspace' || key.sequence === '\x7f' || key.sequence === '\x08';
}

function isForwardDeleteKey(key: Key): boolean {
    return key.name === 'delete';
}

export function TextBufferInput({
    buffer,
    onSubmit,
    placeholder,
    isDisabled = false,
    onHistoryNavigate,
    onTriggerOverlay,
    maxViewportLines = 10,
    isActive,
    onKeyboardScroll,
    imageCount = 0,
    onImagePaste,
    images = [],
    onImageRemove,
}: TextBufferInputProps) {
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns || 80;

    // Use ref to track imageCount to avoid stale closure in async paste handler
    const imageCountRef = useRef(imageCount);
    useEffect(() => {
        imageCountRef.current = imageCount;
    }, [imageCount]);

    // Check for removed image placeholders after text changes
    const checkRemovedImages = useCallback(() => {
        if (!onImageRemove || images.length === 0) return;
        const currentText = buffer.text;
        for (const img of images) {
            if (!currentText.includes(img.placeholder)) {
                onImageRemove(img.id);
            }
        }
    }, [buffer, images, onImageRemove]);

    // Handle keyboard input directly - reads buffer state fresh each time
    const handleKeypress = useCallback(
        (key: Key) => {
            if (isDisabled) return;

            // Read buffer state directly - always fresh, no stale closures
            const currentText = buffer.text;
            const cursorVisualRow = buffer.visualCursor[0];
            const visualLines = buffer.allVisualLines;

            // === KEYBOARD SCROLL (PageUp/PageDown, Shift+arrows) ===
            if (onKeyboardScroll) {
                if (key.name === 'pageup' || (key.shift && key.name === 'up')) {
                    onKeyboardScroll('up');
                    return;
                }
                if (key.name === 'pagedown' || (key.shift && key.name === 'down')) {
                    onKeyboardScroll('down');
                    return;
                }
            }

            // === IMAGE PASTE (Ctrl+V) ===
            // Check clipboard for image before letting normal paste through
            if (key.ctrl && key.name === 'v' && onImagePaste) {
                // Async clipboard check - fire and forget, don't block input
                void (async () => {
                    try {
                        const clipboardImage = await readClipboardImage();
                        if (clipboardImage) {
                            // Use ref to get current count (avoids stale closure issue)
                            const currentCount = imageCountRef.current;
                            const imageNumber = currentCount + 1;
                            // Immediately increment ref to handle rapid pastes
                            imageCountRef.current = imageNumber;

                            const placeholder = `[Image ${imageNumber}]`;
                            const pendingImage: PendingImage = {
                                id: `img-${Date.now()}-${imageNumber}`,
                                data: clipboardImage.data,
                                mimeType: clipboardImage.mimeType,
                                placeholder,
                            };
                            onImagePaste(pendingImage);
                            buffer.insert(placeholder);
                        }
                    } catch {
                        // Clipboard read failed, ignore
                    }
                })();
                return;
            }

            // === NEWLINE DETECTION ===
            const isCtrlJ = key.sequence === '\n';
            const isShiftEnter =
                key.sequence === '\\\r' ||
                (key.name === 'return' && key.shift) ||
                key.sequence === '\x1b[13;2u' ||
                key.sequence === '\x1bOM';
            const isPasteReturn = key.name === 'return' && key.paste;
            const wantsNewline =
                isCtrlJ || isShiftEnter || (key.name === 'return' && key.meta) || isPasteReturn;

            if (wantsNewline) {
                buffer.newline();
                return;
            }

            // === SUBMIT (Enter) ===
            if (key.name === 'return' && !key.paste) {
                if (currentText.trim()) {
                    onSubmit(currentText);
                }
                return;
            }

            // === UNDO/REDO ===
            if (key.ctrl && key.name === 'z' && !key.shift) {
                buffer.undo();
                return;
            }
            if ((key.ctrl && key.name === 'y') || (key.ctrl && key.shift && key.name === 'z')) {
                buffer.redo();
                return;
            }

            // === BACKSPACE ===
            if (isBackspaceKey(key) && !key.meta) {
                const prevText = buffer.text;
                const [cursorRow, cursorCol] = buffer.cursor;
                const cursorPos = getCursorPosition(buffer.lines, cursorRow, cursorCol);

                buffer.backspace();
                checkRemovedImages();

                if (onTriggerOverlay && cursorPos > 0) {
                    const deletedChar = prevText[cursorPos - 1];
                    const newText = buffer.text;
                    if (deletedChar === '/' && cursorPos === 1) {
                        onTriggerOverlay('close');
                    } else if (deletedChar === '@' && !newText.includes('@')) {
                        onTriggerOverlay('close');
                    }
                }
                return;
            }

            // === FORWARD DELETE ===
            if (isForwardDeleteKey(key)) {
                buffer.del();
                checkRemovedImages();
                return;
            }

            // === WORD DELETE ===
            if (key.ctrl && key.name === 'w') {
                buffer.deleteWordLeft();
                checkRemovedImages();
                return;
            }
            if (key.meta && isBackspaceKey(key)) {
                buffer.deleteWordLeft();
                checkRemovedImages();
                return;
            }

            // === ARROW NAVIGATION ===
            if (key.name === 'left') {
                buffer.move(key.meta || key.ctrl ? 'wordLeft' : 'left');
                return;
            }
            if (key.name === 'right') {
                buffer.move(key.meta || key.ctrl ? 'wordRight' : 'right');
                return;
            }
            // Cmd+Up: Move to start of input
            if (key.meta && key.name === 'up') {
                buffer.moveToOffset(0);
                return;
            }
            // Cmd+Down: Move to end of input
            if (key.meta && key.name === 'down') {
                buffer.moveToOffset(currentText.length);
                return;
            }
            if (key.name === 'up') {
                // Only trigger history navigation when at top visual line
                if (cursorVisualRow === 0 && onHistoryNavigate) {
                    onHistoryNavigate('up');
                } else {
                    buffer.move('up');
                }
                return;
            }
            if (key.name === 'down') {
                // Only trigger history navigation when at bottom visual line
                if (cursorVisualRow >= visualLines.length - 1 && onHistoryNavigate) {
                    onHistoryNavigate('down');
                } else {
                    buffer.move('down');
                }
                return;
            }

            // === LINE NAVIGATION ===
            if (key.ctrl && key.name === 'a') {
                buffer.move('home');
                return;
            }
            if (key.ctrl && key.name === 'e') {
                buffer.move('end');
                return;
            }
            if (key.ctrl && key.name === 'k') {
                buffer.killLineRight();
                checkRemovedImages();
                return;
            }
            if (key.ctrl && key.name === 'u') {
                buffer.killLineLeft();
                checkRemovedImages();
                return;
            }

            // === WORD NAVIGATION ===
            if (key.meta && key.name === 'b') {
                buffer.move('wordLeft');
                return;
            }
            if (key.meta && key.name === 'f') {
                buffer.move('wordRight');
                return;
            }

            // === CHARACTER INPUT ===
            if (key.insertable && !key.ctrl && !key.meta) {
                const [cursorRow, cursorCol] = buffer.cursor;
                const cursorPos = getCursorPosition(buffer.lines, cursorRow, cursorCol);

                buffer.insert(key.sequence, { paste: key.paste });

                if (onTriggerOverlay) {
                    if (key.sequence === '/' && cursorPos === 0) {
                        onTriggerOverlay('slash-autocomplete');
                    } else if (key.sequence === '@') {
                        onTriggerOverlay('resource-autocomplete');
                    }
                }
            }
        },
        [
            buffer,
            isDisabled,
            onSubmit,
            onHistoryNavigate,
            onTriggerOverlay,
            onKeyboardScroll,
            imageCount,
            onImagePaste,
            checkRemovedImages,
        ]
    );

    // Subscribe to keypress events when active
    useKeypress(handleKeypress, { isActive: isActive && !isDisabled });

    // === RENDERING ===
    // Read buffer state for rendering
    const bufferText = buffer.text;
    const visualCursor = buffer.visualCursor;
    const visualLines = buffer.allVisualLines;
    const cursorVisualRow = visualCursor[0];
    const cursorVisualCol = visualCursor[1];

    const separator = '─'.repeat(terminalWidth);
    const totalLines = visualLines.length;

    // Calculate visible window
    let startLine = 0;
    let endLine = totalLines;
    if (totalLines > maxViewportLines) {
        const halfViewport = Math.floor(maxViewportLines / 2);
        startLine = Math.max(0, cursorVisualRow - halfViewport);
        endLine = Math.min(totalLines, startLine + maxViewportLines);
        if (endLine === totalLines) {
            startLine = Math.max(0, totalLines - maxViewportLines);
        }
    }

    const visibleLines = visualLines.slice(startLine, endLine);

    // Empty state
    if (bufferText === '') {
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
                        {' '.repeat(Math.max(0, terminalWidth - 3 - (placeholder?.length || 0)))}
                    </Text>
                </Box>
                <Text color="gray" dimColor>
                    {separator}
                </Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" width={terminalWidth}>
            <Text color="gray" dimColor>
                {separator}
            </Text>
            {startLine > 0 && (
                <Text color="gray" dimColor>
                    {'  '}↑ {startLine} more line{startLine > 1 ? 's' : ''} above (⌥↑ to jump)
                </Text>
            )}
            {visibleLines.map((line: string, idx: number) => {
                const absoluteRow = startLine + idx;
                const isFirst = absoluteRow === 0;
                const prefix = isFirst ? '> ' : '  ';
                const isCursorLine = absoluteRow === cursorVisualRow;

                if (!isCursorLine) {
                    return (
                        <Box key={absoluteRow} width={terminalWidth}>
                            <Text color="green" bold={isFirst}>
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

                const before = line.slice(0, cursorVisualCol);
                const atCursor = line.charAt(cursorVisualCol) || ' ';
                const after = line.slice(cursorVisualCol + 1);

                return (
                    <Box key={absoluteRow} width={terminalWidth}>
                        <Text color="green" bold={isFirst}>
                            {prefix}
                        </Text>
                        <Text>{before}</Text>
                        <Text inverse>{atCursor}</Text>
                        <Text>{after}</Text>
                        <Text>
                            {' '.repeat(
                                Math.max(
                                    0,
                                    terminalWidth - prefix.length - before.length - 1 - after.length
                                )
                            )}
                        </Text>
                    </Box>
                );
            })}
            {endLine < totalLines && (
                <Text color="gray" dimColor>
                    {'  '}↓ {totalLines - endLine} more line{totalLines - endLine > 1 ? 's' : ''}{' '}
                    below (⌥↓ to jump)
                </Text>
            )}
            <Text color="gray" dimColor>
                {separator}
            </Text>
        </Box>
    );
}

function getCursorPosition(lines: string[], cursorRow: number, cursorCol: number): number {
    let pos = 0;
    for (let i = 0; i < cursorRow; i++) {
        pos += (lines[i]?.length ?? 0) + 1;
    }
    return pos + cursorCol;
}
