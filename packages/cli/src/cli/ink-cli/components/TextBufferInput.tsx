/**
 * TextBufferInput Component
 *
 * Buffer is passed as prop from parent.
 * Uses direct useKeypress for input handling (no ref chain).
 * Parent owns the buffer and can read values directly.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import type { TextBuffer } from './shared/text-buffer.js';
import type { PendingImage, PastedBlock } from '../state/types.js';
import { readClipboardImage } from '../utils/clipboardUtils.js';

/** Overlay trigger types for event-driven overlay detection */
export type OverlayTrigger = 'slash-autocomplete' | 'resource-autocomplete' | 'close';

/** Threshold for collapsing pasted content */
const PASTE_COLLAPSE_LINE_THRESHOLD = 3;
const PASTE_COLLAPSE_CHAR_THRESHOLD = 150;

/** Platform-aware keyboard shortcut labels */
const isMac = process.platform === 'darwin';
const KEY_LABELS = {
    ctrlT: isMac ? '⌃T' : 'Ctrl+T',
    altUp: isMac ? '⌥↑' : 'Alt+Up',
    altDown: isMac ? '⌥↓' : 'Alt+Down',
};

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
    /** Current pasted blocks for collapse/expand feature */
    pastedBlocks?: PastedBlock[] | undefined;
    /** Called when a large paste is detected and should be collapsed */
    onPasteBlock?: ((block: PastedBlock) => void) | undefined;
    /** Called to update a pasted block (e.g., toggle collapse) */
    onPasteBlockUpdate?: ((blockId: string, updates: Partial<PastedBlock>) => void) | undefined;
    /** Called when a paste block placeholder is removed from text */
    onPasteBlockRemove?: ((blockId: string) => void) | undefined;
    /** Query to highlight in input text (for history search) */
    highlightQuery?: string | undefined;
    /** Cycle the current reasoning preset. */
    onCycleReasoningPreset?: (() => void) | undefined;
}

function isBackspaceKey(key: Key): boolean {
    return key.name === 'backspace' || key.sequence === '\x7f' || key.sequence === '\x08';
}

function isForwardDeleteKey(key: Key): boolean {
    return key.name === 'delete';
}

/** Renders text with optional query highlighting in green */
function HighlightedText({ text, query }: { text: string; query: string | undefined }) {
    if (!query || !text) {
        return <Text>{text}</Text>;
    }

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matchIndex = lowerText.indexOf(lowerQuery);

    if (matchIndex === -1) {
        return <Text>{text}</Text>;
    }

    const before = text.slice(0, matchIndex);
    const match = text.slice(matchIndex, matchIndex + query.length);
    const after = text.slice(matchIndex + query.length);

    return (
        <Text>
            {before}
            <Text color="green" bold>
                {match}
            </Text>
            {after}
        </Text>
    );
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
    pastedBlocks = [],
    onPasteBlock,
    onPasteBlockUpdate,
    onPasteBlockRemove,
    highlightQuery,
    onCycleReasoningPreset,
}: TextBufferInputProps) {
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns || 80;

    // Use ref to track imageCount to avoid stale closure in async paste handler
    const imageCountRef = useRef(imageCount);
    useEffect(() => {
        imageCountRef.current = imageCount;
    }, [imageCount]);

    // Use ref to track paste number for generating sequential IDs
    const pasteCounterRef = useRef(pastedBlocks.length);
    useEffect(() => {
        // Update counter to be at least the current number of blocks
        pasteCounterRef.current = Math.max(pasteCounterRef.current, pastedBlocks.length);
    }, [pastedBlocks.length]);

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

    // Check for removed paste block placeholders after text changes
    const checkRemovedPasteBlocks = useCallback(() => {
        if (!onPasteBlockRemove || pastedBlocks.length === 0) return;
        const currentText = buffer.text;
        for (const block of pastedBlocks) {
            // Check if either the placeholder or the full text (when expanded) is present
            const textToFind = block.isCollapsed ? block.placeholder : block.fullText;
            if (!currentText.includes(textToFind)) {
                onPasteBlockRemove(block.id);
            }
        }
    }, [buffer, pastedBlocks, onPasteBlockRemove]);

    // Find the currently expanded paste block (only one can be expanded at a time)
    const findExpandedBlock = useCallback((): PastedBlock | null => {
        return pastedBlocks.find((block) => !block.isCollapsed) || null;
    }, [pastedBlocks]);

    // Find which collapsed paste block the cursor is on (by placeholder)
    const findCollapsedBlockAtCursor = useCallback((): PastedBlock | null => {
        if (pastedBlocks.length === 0) return null;
        const currentText = buffer.text;
        const [cursorRow, cursorCol] = buffer.cursor;
        const cursorOffset = getCursorPosition(buffer.lines, cursorRow, cursorCol);

        for (const block of pastedBlocks) {
            if (!block.isCollapsed) continue; // Skip expanded blocks
            const startIdx = currentText.indexOf(block.placeholder);
            if (startIdx === -1) continue;
            const endIdx = startIdx + block.placeholder.length;
            if (cursorOffset >= startIdx && cursorOffset <= endIdx) {
                return block;
            }
        }
        return null;
    }, [buffer, pastedBlocks]);

    // Handle Ctrl+T toggle:
    // - If something is expanded: collapse it
    // - If cursor is on a collapsed paste: expand it
    const handlePasteToggle = useCallback(() => {
        if (!onPasteBlockUpdate) return;

        const expandedBlock = findExpandedBlock();
        const currentText = buffer.text;

        // If something is expanded, collapse it
        if (expandedBlock) {
            // Normalize for comparison (buffer might have different line endings)
            const normalizedCurrent = currentText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const normalizedFullText = expandedBlock.fullText
                .replace(/\r\n/g, '\n')
                .replace(/\r/g, '\n');

            const startIdx = normalizedCurrent.indexOf(normalizedFullText);
            if (startIdx === -1) {
                // Fallback: just mark as collapsed without text replacement
                // This handles edge cases where text was modified
                onPasteBlockUpdate(expandedBlock.id, { isCollapsed: true });
                return;
            }

            // Replace full text with placeholder
            const before = currentText.slice(0, startIdx);
            const after = currentText.slice(startIdx + normalizedFullText.length);
            const newText = before + expandedBlock.placeholder + after;

            // Adjust cursor
            const [cursorRow, cursorCol] = buffer.cursor;
            const cursorOffset = getCursorPosition(buffer.lines, cursorRow, cursorCol);
            let newCursorOffset = cursorOffset;
            if (cursorOffset > startIdx) {
                // Cursor is after the start of expanded block - adjust
                const lengthDiff = expandedBlock.placeholder.length - normalizedFullText.length;
                newCursorOffset = Math.max(startIdx, cursorOffset + lengthDiff);
            }

            buffer.setText(newText);
            buffer.moveToOffset(Math.min(newCursorOffset, newText.length));
            onPasteBlockUpdate(expandedBlock.id, { isCollapsed: true });
            return;
        }

        // Otherwise, check if cursor is on a collapsed paste to expand
        const collapsedBlock = findCollapsedBlockAtCursor();
        if (collapsedBlock) {
            const startIdx = currentText.indexOf(collapsedBlock.placeholder);
            if (startIdx === -1) return;

            // Replace placeholder with full text
            const before = currentText.slice(0, startIdx);
            const after = currentText.slice(startIdx + collapsedBlock.placeholder.length);
            const newText = before + collapsedBlock.fullText + after;

            buffer.setText(newText);
            // Move cursor to start of expanded content
            buffer.moveToOffset(startIdx);
            onPasteBlockUpdate(collapsedBlock.id, { isCollapsed: false });
        }
    }, [buffer, findExpandedBlock, findCollapsedBlockAtCursor, onPasteBlockUpdate]);

    // Handle keyboard input directly - reads buffer state fresh each time
    const handleKeypress = useCallback(
        (key: Key) => {
            if (isDisabled) return;

            // Tab: cycle reasoning preset (when main input is active; overlays handle their own Tab usage)
            if (
                key.name === 'tab' &&
                !key.shift &&
                !key.ctrl &&
                !key.meta &&
                onCycleReasoningPreset
            ) {
                onCycleReasoningPreset();
                return;
            }

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

            // === PASTE BLOCK TOGGLE (Ctrl+T) ===
            if (key.ctrl && key.name === 't') {
                handlePasteToggle();
                return;
            }

            // === BACKSPACE ===
            if (isBackspaceKey(key) && !key.meta) {
                const prevText = buffer.text;
                const [cursorRow, cursorCol] = buffer.cursor;
                const cursorPos = getCursorPosition(buffer.lines, cursorRow, cursorCol);

                buffer.backspace();
                checkRemovedImages();
                checkRemovedPasteBlocks();

                // Check if we should close overlay after backspace
                // NOTE: buffer.text is memoized and won't update until next render,
                // so we calculate the expected new text ourselves
                if (onTriggerOverlay && cursorPos > 0) {
                    const deletedChar = prevText[cursorPos - 1];
                    // Calculate what the text will be after backspace
                    const expectedNewText =
                        prevText.slice(0, cursorPos - 1) + prevText.slice(cursorPos);

                    if (deletedChar === '/' && cursorPos === 1) {
                        onTriggerOverlay('close');
                    } else if (deletedChar === '@') {
                        // Close if no valid @ mention remains
                        // A valid @ is at start of text or after whitespace
                        const hasValidAt = /(^|[\s])@/.test(expectedNewText);
                        if (!hasValidAt) {
                            onTriggerOverlay('close');
                        }
                    }
                }
                return;
            }

            // === FORWARD DELETE ===
            if (isForwardDeleteKey(key)) {
                buffer.del();
                checkRemovedImages();
                checkRemovedPasteBlocks();
                return;
            }

            // === WORD DELETE ===
            if (key.ctrl && key.name === 'w') {
                buffer.deleteWordLeft();
                checkRemovedImages();
                checkRemovedPasteBlocks();
                return;
            }
            if (key.meta && isBackspaceKey(key)) {
                buffer.deleteWordLeft();
                checkRemovedImages();
                checkRemovedPasteBlocks();
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
                checkRemovedPasteBlocks();
                return;
            }
            if (key.ctrl && key.name === 'u') {
                buffer.killLineLeft();
                checkRemovedImages();
                checkRemovedPasteBlocks();
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

                // Check if this is a large paste that should be collapsed
                if (key.paste && onPasteBlock) {
                    // Normalize line endings to \n for consistent handling
                    const pastedText = key.sequence.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                    const lineCount = (pastedText.match(/\n/g)?.length ?? 0) + 1;

                    if (
                        lineCount >= PASTE_COLLAPSE_LINE_THRESHOLD ||
                        pastedText.length > PASTE_COLLAPSE_CHAR_THRESHOLD
                    ) {
                        // Create collapsed paste block
                        pasteCounterRef.current += 1;
                        const pasteNumber = pasteCounterRef.current;
                        const placeholder = `[Paste ${pasteNumber}: ~${lineCount} lines]`;

                        const pasteBlock: PastedBlock = {
                            id: `paste-${Date.now()}-${pasteNumber}`,
                            number: pasteNumber,
                            fullText: pastedText,
                            lineCount,
                            isCollapsed: true,
                            placeholder,
                        };

                        // Insert placeholder instead of full text
                        buffer.insert(placeholder);
                        onPasteBlock(pasteBlock);
                        return;
                    }
                }

                buffer.insert(key.sequence, { paste: key.paste });

                if (onTriggerOverlay) {
                    if (key.sequence === '/' && cursorPos === 0) {
                        onTriggerOverlay('slash-autocomplete');
                    } else if (key.sequence === '@') {
                        onTriggerOverlay('resource-autocomplete');
                    } else if (/\s/.test(key.sequence)) {
                        // Close resource autocomplete when user types whitespace
                        // Whitespace means user is done with the mention (either selected or abandoned)
                        onTriggerOverlay('close');
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
            // imageCount intentionally omitted - callback uses imageCountRef which is synced via useEffect
            onImagePaste,
            checkRemovedImages,
            checkRemovedPasteBlocks,
            handlePasteToggle,
            onPasteBlock,
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

    // Detect shell command mode (input starts with "!")
    const isShellMode = bufferText.startsWith('!');
    const promptPrefix = isShellMode ? '$ ' : '> ';
    const promptColor = isShellMode ? 'yellow' : 'green';
    const separatorColor = isShellMode ? 'yellow' : 'gray';

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
                <Text color="gray">{separator}</Text>
                <Box width={terminalWidth}>
                    <Text color="green" bold>
                        {'> '}
                    </Text>
                    <Text inverse> </Text>
                    {placeholder && <Text color="gray">{placeholder}</Text>}
                    <Text>
                        {' '.repeat(Math.max(0, terminalWidth - 3 - (placeholder?.length || 0)))}
                    </Text>
                </Box>
                <Text color="gray">{separator}</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" width={terminalWidth}>
            <Text color={separatorColor}>{separator}</Text>
            {startLine > 0 && (
                <Text color="gray">
                    {'  '}↑ {startLine} more line{startLine > 1 ? 's' : ''} above (
                    {KEY_LABELS.altUp} to jump)
                </Text>
            )}
            {visibleLines.map((line: string, idx: number) => {
                const absoluteRow = startLine + idx;
                const isFirst = absoluteRow === 0;
                const prefix = isFirst ? promptPrefix : '  ';
                const isCursorLine = absoluteRow === cursorVisualRow;

                if (!isCursorLine) {
                    return (
                        <Box key={absoluteRow} width={terminalWidth}>
                            <Text color={promptColor} bold={isFirst}>
                                {prefix}
                            </Text>
                            <HighlightedText text={line} query={highlightQuery} />
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
                        <Text color={promptColor} bold={isFirst}>
                            {prefix}
                        </Text>
                        <HighlightedText text={before} query={highlightQuery} />
                        <Text inverse>{atCursor}</Text>
                        <HighlightedText text={after} query={highlightQuery} />
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
                <Text color="gray">
                    {'  '}↓ {totalLines - endLine} more line{totalLines - endLine > 1 ? 's' : ''}{' '}
                    below ({KEY_LABELS.altDown} to jump)
                </Text>
            )}
            {/* Paste block hints */}
            {pastedBlocks.length > 0 && (
                <PasteBlockHint
                    pastedBlocks={pastedBlocks}
                    expandedBlock={findExpandedBlock()}
                    cursorOnCollapsed={findCollapsedBlockAtCursor()}
                />
            )}
            <Text color={separatorColor}>{separator}</Text>
        </Box>
    );
}

/** Hint component for paste blocks */
function PasteBlockHint({
    pastedBlocks,
    expandedBlock,
    cursorOnCollapsed,
}: {
    pastedBlocks: PastedBlock[];
    expandedBlock: PastedBlock | null;
    cursorOnCollapsed: PastedBlock | null;
}) {
    const collapsedCount = pastedBlocks.filter((b) => b.isCollapsed).length;

    // If something is expanded, always show collapse hint
    if (expandedBlock) {
        return (
            <Text color="cyan">
                {'  '}
                {KEY_LABELS.ctrlT} to collapse expanded paste
            </Text>
        );
    }

    // If cursor is on a collapsed paste, show expand hint
    if (cursorOnCollapsed) {
        return (
            <Text color="cyan">
                {'  '}
                {KEY_LABELS.ctrlT} to expand paste
            </Text>
        );
    }

    // Otherwise show count of collapsed pastes
    if (collapsedCount > 0) {
        return (
            <Text color="gray">
                {'  '}
                {collapsedCount} collapsed paste{collapsedCount > 1 ? 's' : ''} ({KEY_LABELS.ctrlT}{' '}
                on placeholder to expand)
            </Text>
        );
    }

    return null;
}

function getCursorPosition(lines: string[], cursorRow: number, cursorCol: number): number {
    let pos = 0;
    for (let i = 0; i < cursorRow; i++) {
        pos += (lines[i]?.length ?? 0) + 1;
    }
    return pos + cursorCol;
}
