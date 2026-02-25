/**
 * Text Buffer - Core text editing buffer with visual line wrapping
 */

import { useState, useCallback, useEffect, useMemo, useReducer } from 'react';
import {
    toCodePoints,
    cpLen,
    cpSlice,
    stripUnsafeCharacters,
    getCachedStringWidth,
    isWordCharStrict,
    isWhitespace,
    isWordCharWithCombining,
    isDifferentScript,
} from '../../utils/textUtils.js';
import type { Key } from '../../hooks/useKeypress.js';

export type Direction =
    | 'left'
    | 'right'
    | 'up'
    | 'down'
    | 'wordLeft'
    | 'wordRight'
    | 'home'
    | 'end';

// Find next word start within a line, starting from col
export const findNextWordStartInLine = (line: string, col: number): number | null => {
    const chars = toCodePoints(line);
    let i = col;

    if (i >= chars.length) return null;

    const currentChar = chars[i];

    // Skip current word/sequence based on character type
    if (isWordCharStrict(currentChar)) {
        while (i < chars.length && isWordCharWithCombining(chars[i])) {
            // Check for script boundary - if next character is from different script, stop here
            if (
                i + 1 < chars.length &&
                isWordCharStrict(chars[i + 1]) &&
                isDifferentScript(chars[i], chars[i + 1])
            ) {
                i++; // Include current character
                break; // Stop at script boundary
            }
            i++;
        }
    } else if (!isWhitespace(currentChar)) {
        while (i < chars.length && !isWordCharStrict(chars[i]) && !isWhitespace(chars[i])) {
            i++;
        }
    }

    // Skip whitespace
    while (i < chars.length && isWhitespace(chars[i])) {
        i++;
    }

    return i < chars.length ? i : null;
};

// Find previous word start within a line
export const findPrevWordStartInLine = (line: string, col: number): number | null => {
    const chars = toCodePoints(line);
    let i = col;

    if (i <= 0) return null;

    i--;

    // Skip whitespace moving backwards
    while (i >= 0 && isWhitespace(chars[i])) {
        i--;
    }

    if (i < 0) return null;

    if (isWordCharStrict(chars[i])) {
        // We're in a word, move to its beginning
        while (i >= 0 && isWordCharStrict(chars[i])) {
            // Check for script boundary - if previous character is from different script, stop here
            if (
                i - 1 >= 0 &&
                isWordCharStrict(chars[i - 1]) &&
                isDifferentScript(chars[i], chars[i - 1])
            ) {
                return i; // Return current position at script boundary
            }
            i--;
        }
        return i + 1;
    } else {
        // We're in punctuation, move to its beginning
        while (i >= 0 && !isWordCharStrict(chars[i]) && !isWhitespace(chars[i])) {
            i--;
        }
        return i + 1;
    }
};

// Find word end within a line
export const findWordEndInLine = (line: string, col: number): number | null => {
    const chars = toCodePoints(line);
    let i = col;

    // If we're already at the end of a word (including punctuation sequences), advance to next word
    // This includes both regular word endings and script boundaries
    const atEndOfWordChar =
        i < chars.length &&
        isWordCharWithCombining(chars[i]) &&
        (i + 1 >= chars.length ||
            !isWordCharWithCombining(chars[i + 1]) ||
            (isWordCharStrict(chars[i]) &&
                i + 1 < chars.length &&
                isWordCharStrict(chars[i + 1]) &&
                isDifferentScript(chars[i], chars[i + 1])));

    const atEndOfPunctuation =
        i < chars.length &&
        !isWordCharWithCombining(chars[i]) &&
        !isWhitespace(chars[i]) &&
        (i + 1 >= chars.length ||
            isWhitespace(chars[i + 1]) ||
            isWordCharWithCombining(chars[i + 1]));

    if (atEndOfWordChar || atEndOfPunctuation) {
        // We're at the end of a word or punctuation sequence, move forward to find next word
        i++;
        // Skip whitespace to find next word or punctuation
        while (i < chars.length && isWhitespace(chars[i])) {
            i++;
        }
    }

    // If we're not on a word character, find the next word or punctuation sequence
    if (i < chars.length && !isWordCharWithCombining(chars[i])) {
        // Skip whitespace to find next word or punctuation
        while (i < chars.length && isWhitespace(chars[i])) {
            i++;
        }
    }

    // Move to end of current word (including combining marks, but stop at script boundaries)
    let foundWord = false;
    let lastBaseCharPos = -1;

    if (i < chars.length && isWordCharWithCombining(chars[i])) {
        // Handle word characters
        while (i < chars.length && isWordCharWithCombining(chars[i])) {
            foundWord = true;

            // Track the position of the last base character (not combining mark)
            if (isWordCharStrict(chars[i])) {
                lastBaseCharPos = i;
            }

            // Check if next character is from a different script (word boundary)
            if (
                i + 1 < chars.length &&
                isWordCharStrict(chars[i + 1]) &&
                isDifferentScript(chars[i], chars[i + 1])
            ) {
                i++; // Include current character
                if (isWordCharStrict(chars[i - 1])) {
                    lastBaseCharPos = i - 1;
                }
                break; // Stop at script boundary
            }

            i++;
        }
    } else if (i < chars.length && !isWhitespace(chars[i])) {
        // Handle punctuation sequences (like ████)
        while (i < chars.length && !isWordCharStrict(chars[i]) && !isWhitespace(chars[i])) {
            foundWord = true;
            lastBaseCharPos = i;
            i++;
        }
    }

    // Only return a position if we actually found a word
    // Return the position of the last base character, not combining marks
    if (foundWord && lastBaseCharPos >= col) {
        return lastBaseCharPos;
    }

    return null;
};

// Initialize segmenter for word boundary detection
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

function findPrevWordBoundary(line: string, cursorCol: number): number {
    const codePoints = toCodePoints(line);
    // Convert cursorCol (CP index) to string index
    const prefix = codePoints.slice(0, cursorCol).join('');
    const cursorIdx = prefix.length;

    let targetIdx = 0;

    for (const seg of segmenter.segment(line)) {
        // We want the last word start strictly before the cursor.
        // If we've reached or passed the cursor, we stop.
        if (seg.index >= cursorIdx) break;

        if (seg.isWordLike) {
            targetIdx = seg.index;
        }
    }

    return toCodePoints(line.slice(0, targetIdx)).length;
}

function findNextWordBoundary(line: string, cursorCol: number): number {
    const codePoints = toCodePoints(line);
    const prefix = codePoints.slice(0, cursorCol).join('');
    const cursorIdx = prefix.length;

    let targetIdx = line.length;

    for (const seg of segmenter.segment(line)) {
        const segEnd = seg.index + seg.segment.length;

        if (segEnd > cursorIdx) {
            if (seg.isWordLike) {
                targetIdx = segEnd;
                break;
            }
        }
    }

    return toCodePoints(line.slice(0, targetIdx)).length;
}

// Find next word across lines
export const findNextWordAcrossLines = (
    lines: string[],
    cursorRow: number,
    cursorCol: number,
    searchForWordStart: boolean
): { row: number; col: number } | null => {
    // First try current line
    const currentLine = lines[cursorRow] || '';
    const colInCurrentLine = searchForWordStart
        ? findNextWordStartInLine(currentLine, cursorCol)
        : findWordEndInLine(currentLine, cursorCol);

    if (colInCurrentLine !== null) {
        return { row: cursorRow, col: colInCurrentLine };
    }

    // Search subsequent lines
    for (let row = cursorRow + 1; row < lines.length; row++) {
        const line = lines[row] || '';
        const chars = toCodePoints(line);

        // For empty lines, if we haven't found any words yet, return the empty line
        if (chars.length === 0) {
            // Check if there are any words in remaining lines
            let hasWordsInLaterLines = false;
            for (let laterRow = row + 1; laterRow < lines.length; laterRow++) {
                const laterLine = lines[laterRow] || '';
                const laterChars = toCodePoints(laterLine);
                let firstNonWhitespace = 0;
                while (
                    firstNonWhitespace < laterChars.length &&
                    isWhitespace(laterChars[firstNonWhitespace])
                ) {
                    firstNonWhitespace++;
                }
                if (firstNonWhitespace < laterChars.length) {
                    hasWordsInLaterLines = true;
                    break;
                }
            }

            // If no words in later lines, return the empty line
            if (!hasWordsInLaterLines) {
                return { row, col: 0 };
            }
            continue;
        }

        // Find first non-whitespace
        let firstNonWhitespace = 0;
        while (firstNonWhitespace < chars.length && isWhitespace(chars[firstNonWhitespace])) {
            firstNonWhitespace++;
        }

        if (firstNonWhitespace < chars.length) {
            if (searchForWordStart) {
                return { row, col: firstNonWhitespace };
            } else {
                // For word end, find the end of the first word
                const endCol = findWordEndInLine(line, firstNonWhitespace);
                if (endCol !== null) {
                    return { row, col: endCol };
                }
            }
        }
    }

    return null;
};

// Find previous word across lines
export const findPrevWordAcrossLines = (
    lines: string[],
    cursorRow: number,
    cursorCol: number
): { row: number; col: number } | null => {
    // First try current line
    const currentLine = lines[cursorRow] || '';
    const colInCurrentLine = findPrevWordStartInLine(currentLine, cursorCol);

    if (colInCurrentLine !== null) {
        return { row: cursorRow, col: colInCurrentLine };
    }

    // Search previous lines
    for (let row = cursorRow - 1; row >= 0; row--) {
        const line = lines[row] || '';
        const chars = toCodePoints(line);

        if (chars.length === 0) continue;

        // Find last word start
        let lastWordStart = chars.length;
        while (lastWordStart > 0 && isWhitespace(chars[lastWordStart - 1])) {
            lastWordStart--;
        }

        if (lastWordStart > 0) {
            // Find start of this word
            const wordStart = findPrevWordStartInLine(line, lastWordStart);
            if (wordStart !== null) {
                return { row, col: wordStart };
            }
        }
    }

    return null;
};

// Helper functions for vim line operations
export const getPositionFromOffsets = (startOffset: number, endOffset: number, lines: string[]) => {
    let offset = 0;
    let startRow = 0;
    let startCol = 0;
    let endRow = 0;
    let endCol = 0;

    // Find start position
    for (let i = 0; i < lines.length; i++) {
        const lineLength = lines[i]!.length + 1; // +1 for newline
        if (offset + lineLength > startOffset) {
            startRow = i;
            startCol = startOffset - offset;
            break;
        }
        offset += lineLength;
    }

    // Find end position
    offset = 0;
    for (let i = 0; i < lines.length; i++) {
        const lineLength = lines[i]!.length + (i < lines.length - 1 ? 1 : 0); // +1 for newline except last line
        if (offset + lineLength >= endOffset) {
            endRow = i;
            endCol = endOffset - offset;
            break;
        }
        offset += lineLength;
    }

    return { startRow, startCol, endRow, endCol };
};

export const getLineRangeOffsets = (startRow: number, lineCount: number, lines: string[]) => {
    let startOffset = 0;

    // Calculate start offset
    for (let i = 0; i < startRow; i++) {
        startOffset += lines[i]!.length + 1; // +1 for newline
    }

    // Calculate end offset
    let endOffset = startOffset;
    for (let i = 0; i < lineCount; i++) {
        const lineIndex = startRow + i;
        if (lineIndex < lines.length) {
            endOffset += lines[lineIndex]!.length;
            if (lineIndex < lines.length - 1) {
                endOffset += 1; // +1 for newline
            }
        }
    }

    return { startOffset, endOffset };
};

export const replaceRangeInternal = (
    state: TextBufferState,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    text: string
): TextBufferState => {
    const currentLine = (row: number) => state.lines[row] || '';
    const currentLineLen = (row: number) => cpLen(currentLine(row));
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

    if (
        startRow > endRow ||
        (startRow === endRow && startCol > endCol) ||
        startRow < 0 ||
        startCol < 0 ||
        endRow >= state.lines.length ||
        (endRow < state.lines.length && endCol > currentLineLen(endRow))
    ) {
        return state; // Invalid range
    }

    const newLines = [...state.lines];

    const sCol = clamp(startCol, 0, currentLineLen(startRow));
    const eCol = clamp(endCol, 0, currentLineLen(endRow));

    const prefix = cpSlice(currentLine(startRow), 0, sCol);
    const suffix = cpSlice(currentLine(endRow), eCol);

    const normalisedReplacement = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const replacementParts = normalisedReplacement.split('\n');

    // The combined first line of the new text
    const firstLine = prefix + replacementParts[0];

    if (replacementParts.length === 1) {
        // No newlines in replacement: combine prefix, replacement, and suffix on one line.
        newLines.splice(startRow, endRow - startRow + 1, firstLine + suffix);
    } else {
        // Newlines in replacement: create new lines.
        const lastLine = replacementParts[replacementParts.length - 1] + suffix;
        const middleLines = replacementParts.slice(1, -1);
        newLines.splice(startRow, endRow - startRow + 1, firstLine, ...middleLines, lastLine);
    }

    const finalCursorRow = startRow + replacementParts.length - 1;
    const finalCursorCol =
        (replacementParts.length > 1 ? 0 : sCol) +
        cpLen(replacementParts[replacementParts.length - 1]!);

    return {
        ...state,
        lines: newLines,
        cursorRow: Math.min(Math.max(finalCursorRow, 0), newLines.length - 1),
        cursorCol: Math.max(0, Math.min(finalCursorCol, cpLen(newLines[finalCursorRow] || ''))),
        preferredCol: null,
    };
};

export interface Viewport {
    height: number;
    width: number;
}

function clamp(v: number, min: number, max: number): number {
    return v < min ? min : v > max ? max : v;
}

/* ────────────────────────────────────────────────────────────────────────── */

interface UseTextBufferProps {
    initialText?: string;
    initialCursorOffset?: number;
    viewport: Viewport;
    onChange?: (text: string) => void;
    inputFilter?: (text: string) => string;
    singleLine?: boolean;
}

interface UndoHistoryEntry {
    lines: string[];
    cursorRow: number;
    cursorCol: number;
}

function calculateInitialCursorPosition(initialLines: string[], offset: number): [number, number] {
    let remainingChars = offset;
    let row = 0;
    while (row < initialLines.length) {
        const lineLength = cpLen(initialLines[row]!);
        // Add 1 for the newline character (except for the last line)
        const totalCharsInLineAndNewline = lineLength + (row < initialLines.length - 1 ? 1 : 0);

        if (remainingChars <= lineLength) {
            // Cursor is on this line
            return [row, remainingChars];
        }
        remainingChars -= totalCharsInLineAndNewline;
        row++;
    }
    // Offset is beyond the text, place cursor at the end of the last line
    if (initialLines.length > 0) {
        const lastRow = initialLines.length - 1;
        return [lastRow, cpLen(initialLines[lastRow]!)];
    }
    return [0, 0]; // Default for empty text
}

export function offsetToLogicalPos(text: string, offset: number): [number, number] {
    let row = 0;
    let col = 0;
    let currentOffset = 0;

    if (offset === 0) return [0, 0];

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineLength = cpLen(line);
        const lineLengthWithNewline = lineLength + (i < lines.length - 1 ? 1 : 0);

        if (offset <= currentOffset + lineLength) {
            // Check against lineLength first
            row = i;
            col = offset - currentOffset;
            return [row, col];
        } else if (offset <= currentOffset + lineLengthWithNewline) {
            // Check if offset is the newline itself
            row = i;
            col = lineLength; // Position cursor at the end of the current line content
            // If the offset IS the newline, and it's not the last line, advance to next line, col 0
            if (offset === currentOffset + lineLengthWithNewline && i < lines.length - 1) {
                return [i + 1, 0];
            }
            return [row, col]; // Otherwise, it's at the end of the current line content
        }
        currentOffset += lineLengthWithNewline;
    }

    // If offset is beyond the text length, place cursor at the end of the last line
    // or [0,0] if text is empty
    if (lines.length > 0) {
        row = lines.length - 1;
        col = cpLen(lines[row]!);
    } else {
        row = 0;
        col = 0;
    }
    return [row, col];
}

/**
 * Converts logical row/col position to absolute text offset
 * Inverse operation of offsetToLogicalPos
 */
export function logicalPosToOffset(lines: string[], row: number, col: number): number {
    let offset = 0;

    // Clamp row to valid range
    const actualRow = Math.min(row, lines.length - 1);

    // Add lengths of all lines before the target row
    for (let i = 0; i < actualRow; i++) {
        offset += cpLen(lines[i]!) + 1; // +1 for newline
    }

    // Add column offset within the target row
    if (actualRow >= 0 && actualRow < lines.length) {
        offset += Math.min(col, cpLen(lines[actualRow]!));
    }

    return offset;
}

export interface VisualLayout {
    visualLines: string[];
    // For each logical line, an array of [visualLineIndex, startColInLogical]
    logicalToVisualMap: Array<Array<[number, number]>>;
    // For each visual line, its [logicalLineIndex, startColInLogical]
    visualToLogicalMap: Array<[number, number]>;
}

// Calculates the visual wrapping of lines and the mapping between logical and visual coordinates.
// This is an expensive operation and should be memoized.
function calculateLayout(logicalLines: string[], viewportWidth: number): VisualLayout {
    const visualLines: string[] = [];
    const logicalToVisualMap: Array<Array<[number, number]>> = [];
    const visualToLogicalMap: Array<[number, number]> = [];

    logicalLines.forEach((logLine, logIndex) => {
        logicalToVisualMap[logIndex] = [];
        if (logLine.length === 0) {
            // Handle empty logical line
            logicalToVisualMap[logIndex].push([visualLines.length, 0]);
            visualToLogicalMap.push([logIndex, 0]);
            visualLines.push('');
        } else {
            // Non-empty logical line
            let currentPosInLogLine = 0; // Tracks position within the current logical line (code point index)
            const codePointsInLogLine = toCodePoints(logLine);

            while (currentPosInLogLine < codePointsInLogLine.length) {
                let currentChunk = '';
                let currentChunkVisualWidth = 0;
                let numCodePointsInChunk = 0;
                let lastWordBreakPoint = -1; // Index in codePointsInLogLine for word break
                let numCodePointsAtLastWordBreak = 0;

                // Iterate through code points to build the current visual line (chunk)
                for (let i = currentPosInLogLine; i < codePointsInLogLine.length; i++) {
                    const char = codePointsInLogLine[i]!;
                    const charVisualWidth = getCachedStringWidth(char);

                    if (currentChunkVisualWidth + charVisualWidth > viewportWidth) {
                        // Character would exceed viewport width
                        if (
                            lastWordBreakPoint !== -1 &&
                            numCodePointsAtLastWordBreak > 0 &&
                            currentPosInLogLine + numCodePointsAtLastWordBreak < i
                        ) {
                            // We have a valid word break point to use, and it's not the start of the current segment
                            currentChunk = codePointsInLogLine
                                .slice(
                                    currentPosInLogLine,
                                    currentPosInLogLine + numCodePointsAtLastWordBreak
                                )
                                .join('');
                            numCodePointsInChunk = numCodePointsAtLastWordBreak;
                        } else {
                            // No word break, or word break is at the start of this potential chunk, or word break leads to empty chunk.
                            // Hard break: take characters up to viewportWidth, or just the current char if it alone is too wide.
                            if (numCodePointsInChunk === 0 && charVisualWidth > viewportWidth) {
                                // Single character is wider than viewport, take it anyway
                                currentChunk = char;
                                numCodePointsInChunk = 1;
                            } else if (
                                numCodePointsInChunk === 0 &&
                                charVisualWidth <= viewportWidth
                            ) {
                                // This case should ideally be caught by the next iteration if the char fits.
                                // If it doesn't fit (because currentChunkVisualWidth was already > 0 from a previous char that filled the line),
                                // then numCodePointsInChunk would not be 0.
                                // This branch means the current char *itself* doesn't fit an empty line, which is handled by the above.
                                // If we are here, it means the loop should break and the current chunk (which is empty) is finalized.
                            }
                        }
                        break; // Break from inner loop to finalize this chunk
                    }

                    currentChunk += char;
                    currentChunkVisualWidth += charVisualWidth;
                    numCodePointsInChunk++;

                    // Check for word break opportunity (space)
                    if (char === ' ') {
                        lastWordBreakPoint = i; // Store code point index of the space
                        // Store the state *before* adding the space, if we decide to break here.
                        numCodePointsAtLastWordBreak = numCodePointsInChunk - 1; // Chars *before* the space
                    }
                }

                // If the inner loop completed without breaking (i.e., remaining text fits)
                // or if the loop broke but numCodePointsInChunk is still 0 (e.g. first char too wide for empty line)
                if (
                    numCodePointsInChunk === 0 &&
                    currentPosInLogLine < codePointsInLogLine.length
                ) {
                    // This can happen if the very first character considered for a new visual line is wider than the viewport.
                    // In this case, we take that single character.
                    const firstChar = codePointsInLogLine[currentPosInLogLine]!;
                    currentChunk = firstChar;
                    numCodePointsInChunk = 1; // Ensure we advance
                }

                // If after everything, numCodePointsInChunk is still 0 but we haven't processed the whole logical line,
                // it implies an issue, like viewportWidth being 0 or less. Avoid infinite loop.
                if (
                    numCodePointsInChunk === 0 &&
                    currentPosInLogLine < codePointsInLogLine.length
                ) {
                    // Force advance by one character to prevent infinite loop if something went wrong
                    currentChunk = codePointsInLogLine[currentPosInLogLine]!;
                    numCodePointsInChunk = 1;
                }

                logicalToVisualMap[logIndex].push([visualLines.length, currentPosInLogLine]);
                visualToLogicalMap.push([logIndex, currentPosInLogLine]);
                visualLines.push(currentChunk);

                const logicalStartOfThisChunk = currentPosInLogLine;
                currentPosInLogLine += numCodePointsInChunk;

                // If the chunk processed did not consume the entire logical line,
                // and the character immediately following the chunk is a space,
                // advance past this space as it acted as a delimiter for word wrapping.
                if (
                    logicalStartOfThisChunk + numCodePointsInChunk < codePointsInLogLine.length &&
                    currentPosInLogLine < codePointsInLogLine.length && // Redundant if previous is true, but safe
                    codePointsInLogLine[currentPosInLogLine] === ' '
                ) {
                    currentPosInLogLine++;
                }
            }
        }
    });

    // If the entire logical text was empty, ensure there's one empty visual line.
    if (logicalLines.length === 0 || (logicalLines.length === 1 && logicalLines[0] === '')) {
        if (visualLines.length === 0) {
            visualLines.push('');
            if (!logicalToVisualMap[0]) logicalToVisualMap[0] = [];
            logicalToVisualMap[0].push([0, 0]);
            visualToLogicalMap.push([0, 0]);
        }
    }

    return {
        visualLines,
        logicalToVisualMap,
        visualToLogicalMap,
    };
}

// Calculates the visual cursor position based on a pre-calculated layout.
// This is a lightweight operation.
function calculateVisualCursorFromLayout(
    layout: VisualLayout,
    logicalCursor: [number, number]
): [number, number] {
    const { logicalToVisualMap, visualLines } = layout;
    const [logicalRow, logicalCol] = logicalCursor;

    const segmentsForLogicalLine = logicalToVisualMap[logicalRow];

    if (!segmentsForLogicalLine || segmentsForLogicalLine.length === 0) {
        // This can happen for an empty document.
        return [0, 0];
    }

    // Find the segment where the logical column fits.
    // The segments are sorted by startColInLogical.
    let targetSegmentIndex = segmentsForLogicalLine.findIndex(([, startColInLogical], index) => {
        const nextStartColInLogical =
            index + 1 < segmentsForLogicalLine.length
                ? segmentsForLogicalLine[index + 1]![1]
                : Infinity;
        return logicalCol >= startColInLogical && logicalCol < nextStartColInLogical;
    });

    // If not found, it means the cursor is at the end of the logical line.
    if (targetSegmentIndex === -1) {
        if (logicalCol === 0) {
            targetSegmentIndex = 0;
        } else {
            targetSegmentIndex = segmentsForLogicalLine.length - 1;
        }
    }

    const [visualRow, startColInLogical] = segmentsForLogicalLine[targetSegmentIndex]!;
    const visualCol = logicalCol - startColInLogical;

    // The visual column should not exceed the length of the visual line.
    const clampedVisualCol = Math.min(visualCol, cpLen(visualLines[visualRow] ?? ''));

    return [visualRow, clampedVisualCol];
}

// --- Start of reducer logic ---

export interface TextBufferState {
    lines: string[];
    cursorRow: number;
    cursorCol: number;
    preferredCol: number | null; // This is the logical character offset in the visual line
    undoStack: UndoHistoryEntry[];
    redoStack: UndoHistoryEntry[];
    viewportWidth: number;
    viewportHeight: number;
    visualLayout: VisualLayout;
}

const historyLimit = 100;

export const pushUndo = (currentState: TextBufferState): TextBufferState => {
    const snapshot = {
        lines: [...currentState.lines],
        cursorRow: currentState.cursorRow,
        cursorCol: currentState.cursorCol,
    };
    const newStack = [...currentState.undoStack, snapshot];
    if (newStack.length > historyLimit) {
        newStack.shift();
    }
    return { ...currentState, undoStack: newStack, redoStack: [] };
};

export type TextBufferAction =
    | { type: 'set_text'; payload: string; pushToUndo?: boolean }
    | { type: 'insert'; payload: string }
    | { type: 'backspace' }
    | {
          type: 'move';
          payload: {
              dir: Direction;
          };
      }
    | {
          type: 'set_cursor';
          payload: {
              cursorRow: number;
              cursorCol: number;
              preferredCol: number | null;
          };
      }
    | { type: 'delete' }
    | { type: 'delete_word_left' }
    | { type: 'delete_word_right' }
    | { type: 'kill_line_right' }
    | { type: 'kill_line_left' }
    | { type: 'undo' }
    | { type: 'redo' }
    | {
          type: 'replace_range';
          payload: {
              startRow: number;
              startCol: number;
              endRow: number;
              endCol: number;
              text: string;
          };
      }
    | { type: 'move_to_offset'; payload: { offset: number } }
    | { type: 'create_undo_snapshot' }
    | { type: 'set_viewport'; payload: { width: number; height: number } };

export interface TextBufferOptions {
    inputFilter?: ((text: string) => string) | undefined;
    singleLine?: boolean | undefined;
}

function textBufferReducerLogic(
    state: TextBufferState,
    action: TextBufferAction,
    options: TextBufferOptions = {}
): TextBufferState {
    const pushUndoLocal = pushUndo;

    const currentLine = (r: number): string => state.lines[r] ?? '';
    const currentLineLen = (r: number): number => cpLen(currentLine(r));

    switch (action.type) {
        case 'set_text': {
            let nextState = state;
            if (action.pushToUndo !== false) {
                nextState = pushUndoLocal(state);
            }
            const newContentLines = action.payload.replace(/\r\n?/g, '\n').split('\n');
            const lines = newContentLines.length === 0 ? [''] : newContentLines;
            const lastNewLineIndex = lines.length - 1;
            return {
                ...nextState,
                lines,
                cursorRow: lastNewLineIndex,
                cursorCol: cpLen(lines[lastNewLineIndex] ?? ''),
                preferredCol: null,
            };
        }

        case 'insert': {
            // Validate payload before pushing undo to avoid orphaned undo entries
            let payload = action.payload;
            if (options.singleLine) {
                payload = payload.replace(/[\r\n]/g, '');
            }
            if (options.inputFilter) {
                payload = options.inputFilter(payload);
            }

            if (payload.length === 0) {
                return state;
            }

            // Now push undo since we know we'll make a change
            const nextState = pushUndoLocal(state);
            const newLines = [...nextState.lines];
            let newCursorRow = nextState.cursorRow;
            let newCursorCol = nextState.cursorCol;

            const currentLine = (r: number) => newLines[r] ?? '';

            const str = stripUnsafeCharacters(payload.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
            const parts = str.split('\n');
            const lineContent = currentLine(newCursorRow);
            const before = cpSlice(lineContent, 0, newCursorCol);
            const after = cpSlice(lineContent, newCursorCol);

            if (parts.length > 1) {
                newLines[newCursorRow] = before + parts[0];
                const remainingParts = parts.slice(1);
                const lastPartOriginal = remainingParts.pop() ?? '';
                newLines.splice(newCursorRow + 1, 0, ...remainingParts);
                newLines.splice(newCursorRow + parts.length - 1, 0, lastPartOriginal + after);
                newCursorRow = newCursorRow + parts.length - 1;
                newCursorCol = cpLen(lastPartOriginal);
            } else {
                newLines[newCursorRow] = before + parts[0]! + after;
                newCursorCol = cpLen(before) + cpLen(parts[0]!);
            }

            return {
                ...nextState,
                lines: newLines,
                cursorRow: newCursorRow,
                cursorCol: newCursorCol,
                preferredCol: null,
            };
        }

        case 'backspace': {
            // Early return before pushing undo to avoid orphaned undo entries
            if (state.cursorCol === 0 && state.cursorRow === 0) return state;

            const nextState = pushUndoLocal(state);
            const newLines = [...nextState.lines];
            let newCursorRow = nextState.cursorRow;
            let newCursorCol = nextState.cursorCol;

            const currentLine = (r: number) => newLines[r] ?? '';

            if (newCursorCol > 0) {
                const lineContent = currentLine(newCursorRow);
                newLines[newCursorRow] =
                    cpSlice(lineContent, 0, newCursorCol - 1) + cpSlice(lineContent, newCursorCol);
                newCursorCol--;
            } else if (newCursorRow > 0) {
                const prevLineContent = currentLine(newCursorRow - 1);
                const currentLineContentVal = currentLine(newCursorRow);
                const newCol = cpLen(prevLineContent);
                newLines[newCursorRow - 1] = prevLineContent + currentLineContentVal;
                newLines.splice(newCursorRow, 1);
                newCursorRow--;
                newCursorCol = newCol;
            }

            return {
                ...nextState,
                lines: newLines,
                cursorRow: newCursorRow,
                cursorCol: newCursorCol,
                preferredCol: null,
            };
        }

        case 'set_viewport': {
            const { width, height } = action.payload;
            if (width === state.viewportWidth && height === state.viewportHeight) {
                return state;
            }
            return {
                ...state,
                viewportWidth: width,
                viewportHeight: height,
            };
        }

        case 'move': {
            const { dir } = action.payload;
            const { cursorRow, cursorCol, lines, visualLayout, preferredCol } = state;

            // Visual movements
            if (
                dir === 'left' ||
                dir === 'right' ||
                dir === 'up' ||
                dir === 'down' ||
                dir === 'home' ||
                dir === 'end'
            ) {
                const visualCursor = calculateVisualCursorFromLayout(visualLayout, [
                    cursorRow,
                    cursorCol,
                ]);
                const { visualLines, visualToLogicalMap } = visualLayout;

                let newVisualRow = visualCursor[0];
                let newVisualCol = visualCursor[1];
                let newPreferredCol = preferredCol;

                const currentVisLineLen = cpLen(visualLines[newVisualRow] ?? '');

                switch (dir) {
                    case 'left':
                        newPreferredCol = null;
                        if (newVisualCol > 0) {
                            newVisualCol--;
                        } else if (newVisualRow > 0) {
                            newVisualRow--;
                            newVisualCol = cpLen(visualLines[newVisualRow] ?? '');
                        }
                        break;
                    case 'right':
                        newPreferredCol = null;
                        if (newVisualCol < currentVisLineLen) {
                            newVisualCol++;
                        } else if (newVisualRow < visualLines.length - 1) {
                            newVisualRow++;
                            newVisualCol = 0;
                        }
                        break;
                    case 'up':
                        if (newVisualRow > 0) {
                            if (newPreferredCol === null) newPreferredCol = newVisualCol;
                            newVisualRow--;
                            newVisualCol = clamp(
                                newPreferredCol,
                                0,
                                cpLen(visualLines[newVisualRow] ?? '')
                            );
                        }
                        break;
                    case 'down':
                        if (newVisualRow < visualLines.length - 1) {
                            if (newPreferredCol === null) newPreferredCol = newVisualCol;
                            newVisualRow++;
                            newVisualCol = clamp(
                                newPreferredCol,
                                0,
                                cpLen(visualLines[newVisualRow] ?? '')
                            );
                        }
                        break;
                    case 'home':
                        newPreferredCol = null;
                        newVisualCol = 0;
                        break;
                    case 'end':
                        newPreferredCol = null;
                        newVisualCol = currentVisLineLen;
                        break;
                    default:
                        return state;
                }

                if (visualToLogicalMap[newVisualRow]) {
                    const [logRow, logStartCol] = visualToLogicalMap[newVisualRow]!;
                    return {
                        ...state,
                        cursorRow: logRow,
                        cursorCol: clamp(logStartCol + newVisualCol, 0, cpLen(lines[logRow] ?? '')),
                        preferredCol: newPreferredCol,
                    };
                }
                return state;
            }

            // Logical movements
            switch (dir) {
                case 'wordLeft': {
                    if (cursorCol === 0 && cursorRow === 0) return state;

                    let newCursorRow = cursorRow;
                    let newCursorCol = cursorCol;

                    if (cursorCol === 0) {
                        newCursorRow--;
                        newCursorCol = cpLen(lines[newCursorRow] ?? '');
                    } else {
                        const lineContent = lines[cursorRow] ?? '';
                        newCursorCol = findPrevWordBoundary(lineContent, cursorCol);
                    }
                    return {
                        ...state,
                        cursorRow: newCursorRow,
                        cursorCol: newCursorCol,
                        preferredCol: null,
                    };
                }
                case 'wordRight': {
                    const lineContent = lines[cursorRow] ?? '';
                    if (cursorRow === lines.length - 1 && cursorCol === cpLen(lineContent)) {
                        return state;
                    }

                    let newCursorRow = cursorRow;
                    let newCursorCol = cursorCol;
                    const lineLen = cpLen(lineContent);

                    if (cursorCol >= lineLen) {
                        newCursorRow++;
                        newCursorCol = 0;
                    } else {
                        newCursorCol = findNextWordBoundary(lineContent, cursorCol);
                    }
                    return {
                        ...state,
                        cursorRow: newCursorRow,
                        cursorCol: newCursorCol,
                        preferredCol: null,
                    };
                }
                default:
                    return state;
            }
        }

        case 'set_cursor': {
            return {
                ...state,
                ...action.payload,
            };
        }

        case 'delete': {
            const { cursorRow, cursorCol, lines } = state;
            const lineContent = currentLine(cursorRow);
            if (cursorCol < currentLineLen(cursorRow)) {
                const nextState = pushUndoLocal(state);
                const newLines = [...nextState.lines];
                newLines[cursorRow] =
                    cpSlice(lineContent, 0, cursorCol) + cpSlice(lineContent, cursorCol + 1);
                return {
                    ...nextState,
                    lines: newLines,
                    preferredCol: null,
                };
            } else if (cursorRow < lines.length - 1) {
                const nextState = pushUndoLocal(state);
                const nextLineContent = currentLine(cursorRow + 1);
                const newLines = [...nextState.lines];
                newLines[cursorRow] = lineContent + nextLineContent;
                newLines.splice(cursorRow + 1, 1);
                return {
                    ...nextState,
                    lines: newLines,
                    preferredCol: null,
                };
            }
            return state;
        }

        case 'delete_word_left': {
            const { cursorRow, cursorCol } = state;
            if (cursorCol === 0 && cursorRow === 0) return state;

            const nextState = pushUndoLocal(state);
            const newLines = [...nextState.lines];
            let newCursorRow = cursorRow;
            let newCursorCol = cursorCol;

            if (newCursorCol > 0) {
                const lineContent = currentLine(newCursorRow);
                const prevWordStart = findPrevWordStartInLine(lineContent, newCursorCol);
                const start = prevWordStart === null ? 0 : prevWordStart;
                newLines[newCursorRow] =
                    cpSlice(lineContent, 0, start) + cpSlice(lineContent, newCursorCol);
                newCursorCol = start;
            } else {
                // Act as a backspace
                const prevLineContent = currentLine(cursorRow - 1);
                const currentLineContentVal = currentLine(cursorRow);
                const newCol = cpLen(prevLineContent);
                newLines[cursorRow - 1] = prevLineContent + currentLineContentVal;
                newLines.splice(cursorRow, 1);
                newCursorRow--;
                newCursorCol = newCol;
            }

            return {
                ...nextState,
                lines: newLines,
                cursorRow: newCursorRow,
                cursorCol: newCursorCol,
                preferredCol: null,
            };
        }

        case 'delete_word_right': {
            const { cursorRow, cursorCol, lines } = state;
            const lineContent = currentLine(cursorRow);
            const lineLen = cpLen(lineContent);

            if (cursorCol >= lineLen && cursorRow === lines.length - 1) {
                return state;
            }

            const nextState = pushUndoLocal(state);
            const newLines = [...nextState.lines];

            if (cursorCol >= lineLen) {
                // Act as a delete, joining with the next line
                const nextLineContent = currentLine(cursorRow + 1);
                newLines[cursorRow] = lineContent + nextLineContent;
                newLines.splice(cursorRow + 1, 1);
            } else {
                const nextWordStart = findNextWordStartInLine(lineContent, cursorCol);
                const end = nextWordStart === null ? lineLen : nextWordStart;
                newLines[cursorRow] =
                    cpSlice(lineContent, 0, cursorCol) + cpSlice(lineContent, end);
            }

            return {
                ...nextState,
                lines: newLines,
                preferredCol: null,
            };
        }

        case 'kill_line_right': {
            const { cursorRow, cursorCol, lines } = state;
            const lineContent = currentLine(cursorRow);
            if (cursorCol < currentLineLen(cursorRow)) {
                const nextState = pushUndoLocal(state);
                const newLines = [...nextState.lines];
                newLines[cursorRow] = cpSlice(lineContent, 0, cursorCol);
                return {
                    ...nextState,
                    lines: newLines,
                };
            } else if (cursorRow < lines.length - 1) {
                // Act as a delete
                const nextState = pushUndoLocal(state);
                const nextLineContent = currentLine(cursorRow + 1);
                const newLines = [...nextState.lines];
                newLines[cursorRow] = lineContent + nextLineContent;
                newLines.splice(cursorRow + 1, 1);
                return {
                    ...nextState,
                    lines: newLines,
                    preferredCol: null,
                };
            }
            return state;
        }

        case 'kill_line_left': {
            const { cursorRow, cursorCol } = state;
            if (cursorCol > 0) {
                const nextState = pushUndoLocal(state);
                const lineContent = currentLine(cursorRow);
                const newLines = [...nextState.lines];
                newLines[cursorRow] = cpSlice(lineContent, cursorCol);
                return {
                    ...nextState,
                    lines: newLines,
                    cursorCol: 0,
                    preferredCol: null,
                };
            }
            return state;
        }

        case 'undo': {
            const stateToRestore = state.undoStack[state.undoStack.length - 1];
            if (!stateToRestore) return state;

            const currentSnapshot = {
                lines: [...state.lines],
                cursorRow: state.cursorRow,
                cursorCol: state.cursorCol,
            };
            return {
                ...state,
                ...stateToRestore,
                undoStack: state.undoStack.slice(0, -1),
                redoStack: [...state.redoStack, currentSnapshot],
            };
        }

        case 'redo': {
            const stateToRestore = state.redoStack[state.redoStack.length - 1];
            if (!stateToRestore) return state;

            const currentSnapshot = {
                lines: [...state.lines],
                cursorRow: state.cursorRow,
                cursorCol: state.cursorCol,
            };
            return {
                ...state,
                ...stateToRestore,
                redoStack: state.redoStack.slice(0, -1),
                undoStack: [...state.undoStack, currentSnapshot],
            };
        }

        case 'replace_range': {
            const { startRow, startCol, endRow, endCol, text } = action.payload;
            const nextState = pushUndoLocal(state);
            return replaceRangeInternal(nextState, startRow, startCol, endRow, endCol, text);
        }

        case 'move_to_offset': {
            const { offset } = action.payload;
            const [newRow, newCol] = offsetToLogicalPos(state.lines.join('\n'), offset);
            return {
                ...state,
                cursorRow: newRow,
                cursorCol: newCol,
                preferredCol: null,
            };
        }

        case 'create_undo_snapshot': {
            return pushUndoLocal(state);
        }

        default:
            return state;
    }
}

export function textBufferReducer(
    state: TextBufferState,
    action: TextBufferAction,
    options: TextBufferOptions = {}
): TextBufferState {
    const newState = textBufferReducerLogic(state, action, options);

    if (newState.lines !== state.lines || newState.viewportWidth !== state.viewportWidth) {
        return {
            ...newState,
            visualLayout: calculateLayout(newState.lines, newState.viewportWidth),
        };
    }

    return newState;
}

// --- End of reducer logic ---

export function useTextBuffer({
    initialText = '',
    initialCursorOffset = 0,
    viewport,
    onChange,
    inputFilter,
    singleLine = false,
}: UseTextBufferProps): TextBuffer {
    const initialState = useMemo((): TextBufferState => {
        const lines = initialText.split('\n');
        const [initialCursorRow, initialCursorCol] = calculateInitialCursorPosition(
            lines.length === 0 ? [''] : lines,
            initialCursorOffset
        );
        const visualLayout = calculateLayout(lines.length === 0 ? [''] : lines, viewport.width);
        return {
            lines: lines.length === 0 ? [''] : lines,
            cursorRow: initialCursorRow,
            cursorCol: initialCursorCol,
            preferredCol: null,
            undoStack: [],
            redoStack: [],
            viewportWidth: viewport.width,
            viewportHeight: viewport.height,
            visualLayout,
        };
    }, [initialText, initialCursorOffset, viewport.width, viewport.height]);

    const [state, dispatch] = useReducer(
        (s: TextBufferState, a: TextBufferAction) =>
            textBufferReducer(s, a, { inputFilter, singleLine }),
        initialState
    );
    const { lines, cursorRow, cursorCol, preferredCol, visualLayout } = state;

    const text = useMemo(() => lines.join('\n'), [lines]);

    const visualCursor = useMemo(
        () => calculateVisualCursorFromLayout(visualLayout, [cursorRow, cursorCol]),
        [visualLayout, cursorRow, cursorCol]
    );

    const { visualLines, visualToLogicalMap } = visualLayout;

    const [visualScrollRow, setVisualScrollRow] = useState<number>(0);

    useEffect(() => {
        if (onChange) {
            onChange(text);
        }
    }, [text, onChange]);

    useEffect(() => {
        dispatch({
            type: 'set_viewport',
            payload: { width: viewport.width, height: viewport.height },
        });
    }, [viewport.width, viewport.height]);

    // Update visual scroll (vertical)
    useEffect(() => {
        const { height } = viewport;
        const totalVisualLines = visualLines.length;
        const maxScrollStart = Math.max(0, totalVisualLines - height);
        let newVisualScrollRow = visualScrollRow;

        if (visualCursor[0] < visualScrollRow) {
            newVisualScrollRow = visualCursor[0];
        } else if (visualCursor[0] >= visualScrollRow + height) {
            newVisualScrollRow = visualCursor[0] - height + 1;
        }

        // When the number of visual lines shrinks (e.g., after widening the viewport),
        // ensure scroll never starts beyond the last valid start so we can render a full window.
        newVisualScrollRow = clamp(newVisualScrollRow, 0, maxScrollStart);

        if (newVisualScrollRow !== visualScrollRow) {
            setVisualScrollRow(newVisualScrollRow);
        }
    }, [visualCursor, visualScrollRow, viewport, visualLines.length]);

    const insert = useCallback(
        (ch: string, { paste: _paste = false }: { paste?: boolean } = {}): void => {
            if (!singleLine && /[\n\r]/.test(ch)) {
                dispatch({ type: 'insert', payload: ch });
                return;
            }

            let currentText = '';
            for (const char of toCodePoints(ch)) {
                if (char.codePointAt(0) === 127) {
                    if (currentText.length > 0) {
                        dispatch({ type: 'insert', payload: currentText });
                        currentText = '';
                    }
                    dispatch({ type: 'backspace' });
                } else {
                    currentText += char;
                }
            }
            if (currentText.length > 0) {
                dispatch({ type: 'insert', payload: currentText });
            }
        },
        [singleLine]
    );

    const newline = useCallback((): void => {
        if (singleLine) {
            return;
        }
        dispatch({ type: 'insert', payload: '\n' });
    }, [singleLine]);

    const backspace = useCallback((): void => {
        dispatch({ type: 'backspace' });
    }, []);

    const del = useCallback((): void => {
        dispatch({ type: 'delete' });
    }, []);

    const move = useCallback(
        (dir: Direction): void => {
            dispatch({ type: 'move', payload: { dir } });
        },
        [dispatch]
    );

    const undo = useCallback((): void => {
        dispatch({ type: 'undo' });
    }, []);

    const redo = useCallback((): void => {
        dispatch({ type: 'redo' });
    }, []);

    const setText = useCallback((newText: string): void => {
        dispatch({ type: 'set_text', payload: newText });
    }, []);

    const deleteWordLeft = useCallback((): void => {
        dispatch({ type: 'delete_word_left' });
    }, []);

    const deleteWordRight = useCallback((): void => {
        dispatch({ type: 'delete_word_right' });
    }, []);

    const killLineRight = useCallback((): void => {
        dispatch({ type: 'kill_line_right' });
    }, []);

    const killLineLeft = useCallback((): void => {
        dispatch({ type: 'kill_line_left' });
    }, []);

    const setViewport = useCallback((width: number, height: number): void => {
        dispatch({ type: 'set_viewport', payload: { width, height } });
    }, []);

    const handleInput = useCallback(
        (key: Key): void => {
            const { sequence: input } = key;

            if (key.paste) {
                // Do not do any other processing on pastes so ensure we handle them
                // before all other cases.
                insert(input, { paste: key.paste });
                return;
            }

            if (
                !singleLine &&
                (key.name === 'return' || input === '\r' || input === '\n' || input === '\\r') // VSCode terminal represents shift + enter this way
            )
                newline();
            else if (key.name === 'left' && !key.meta && !key.ctrl) move('left');
            else if (key.ctrl && key.name === 'b') move('left');
            else if (key.name === 'right' && !key.meta && !key.ctrl) move('right');
            else if (key.ctrl && key.name === 'f') move('right');
            else if (key.name === 'up') move('up');
            else if (key.name === 'down') move('down');
            else if ((key.ctrl || key.meta) && key.name === 'left') move('wordLeft');
            else if (key.meta && key.name === 'b') move('wordLeft');
            else if ((key.ctrl || key.meta) && key.name === 'right') move('wordRight');
            else if (key.meta && key.name === 'f') move('wordRight');
            else if (key.name === 'home') move('home');
            else if (key.ctrl && key.name === 'a') move('home');
            else if (key.name === 'end') move('end');
            else if (key.ctrl && key.name === 'e') move('end');
            else if (key.ctrl && key.name === 'w') deleteWordLeft();
            else if ((key.meta || key.ctrl) && (key.name === 'backspace' || input === '\x7f'))
                deleteWordLeft();
            else if ((key.meta || key.ctrl) && key.name === 'delete') deleteWordRight();
            else if (key.name === 'backspace' || input === '\x7f' || (key.ctrl && key.name === 'h'))
                backspace();
            else if (key.name === 'delete' || (key.ctrl && key.name === 'd')) del();
            else if (key.ctrl && !key.shift && key.name === 'z') undo();
            else if (key.ctrl && key.shift && key.name === 'z') redo();
            else if (key.insertable) {
                insert(input, { paste: key.paste });
            }
        },
        [
            newline,
            move,
            deleteWordLeft,
            deleteWordRight,
            backspace,
            del,
            insert,
            undo,
            redo,
            singleLine,
        ]
    );

    const renderedVisualLines = useMemo(
        () => visualLines.slice(visualScrollRow, visualScrollRow + viewport.height),
        [visualLines, visualScrollRow, viewport.height]
    );

    const replaceRange = useCallback(
        (
            startRow: number,
            startCol: number,
            endRow: number,
            endCol: number,
            text: string
        ): void => {
            dispatch({
                type: 'replace_range',
                payload: { startRow, startCol, endRow, endCol, text },
            });
        },
        []
    );

    const replaceRangeByOffset = useCallback(
        (startOffset: number, endOffset: number, replacementText: string): void => {
            const [startRow, startCol] = offsetToLogicalPos(text, startOffset);
            const [endRow, endCol] = offsetToLogicalPos(text, endOffset);
            replaceRange(startRow, startCol, endRow, endCol, replacementText);
        },
        [text, replaceRange]
    );

    const moveToOffset = useCallback((offset: number): void => {
        dispatch({ type: 'move_to_offset', payload: { offset } });
    }, []);

    const moveToVisualPosition = useCallback(
        (visRow: number, visCol: number): void => {
            const { visualLines, visualToLogicalMap } = visualLayout;
            // Clamp visRow to valid range
            const clampedVisRow = Math.max(0, Math.min(visRow, visualLines.length - 1));
            const visualLine = visualLines[clampedVisRow] || '';

            if (visualToLogicalMap[clampedVisRow]) {
                const [logRow, logStartCol] = visualToLogicalMap[clampedVisRow];

                const codePoints = toCodePoints(visualLine);
                let currentVisX = 0;
                let charOffset = 0;

                for (const char of codePoints) {
                    const charWidth = getCachedStringWidth(char);
                    // If the click is within this character
                    if (visCol < currentVisX + charWidth) {
                        // Check if we clicked the second half of a wide character
                        if (charWidth > 1 && visCol >= currentVisX + charWidth / 2) {
                            charOffset++;
                        }
                        break;
                    }
                    currentVisX += charWidth;
                    charOffset++;
                }

                // Clamp charOffset to length
                charOffset = Math.min(charOffset, codePoints.length);

                const newCursorRow = logRow;
                const newCursorCol = logStartCol + charOffset;

                dispatch({
                    type: 'set_cursor',
                    payload: {
                        cursorRow: newCursorRow,
                        cursorCol: newCursorCol,
                        preferredCol: charOffset,
                    },
                });
            }
        },
        [visualLayout]
    );

    const getOffset = useCallback(
        (): number => logicalPosToOffset(lines, cursorRow, cursorCol),
        [lines, cursorRow, cursorCol]
    );

    const returnValue: TextBuffer = useMemo(
        () => ({
            lines,
            text,
            cursor: [cursorRow, cursorCol],
            preferredCol,

            allVisualLines: visualLines,
            viewportVisualLines: renderedVisualLines,
            visualCursor,
            visualScrollRow,
            visualToLogicalMap,

            setText,
            insert,
            newline,
            backspace,
            del,
            move,
            undo,
            redo,
            replaceRange,
            replaceRangeByOffset,
            moveToOffset,
            getOffset,
            moveToVisualPosition,
            deleteWordLeft,
            deleteWordRight,
            killLineRight,
            killLineLeft,
            handleInput,
            setViewport,
        }),
        [
            lines,
            text,
            cursorRow,
            cursorCol,
            preferredCol,
            visualLines,
            renderedVisualLines,
            visualCursor,
            visualScrollRow,
            visualToLogicalMap,
            setText,
            insert,
            newline,
            backspace,
            del,
            move,
            undo,
            redo,
            replaceRange,
            replaceRangeByOffset,
            moveToOffset,
            getOffset,
            moveToVisualPosition,
            deleteWordLeft,
            deleteWordRight,
            killLineRight,
            killLineLeft,
            handleInput,
            setViewport,
        ]
    );
    return returnValue;
}

export interface TextBuffer {
    // State
    lines: string[]; // Logical lines
    text: string;
    cursor: [number, number]; // Logical cursor [row, col]
    /**
     * When the user moves the caret vertically we try to keep their original
     * horizontal column even when passing through shorter lines. We remember
     * that *preferred* column in this field while the user is still travelling
     * vertically. Any explicit horizontal movement resets the preference.
     */
    preferredCol: number | null;

    // Visual state (handles wrapping)
    allVisualLines: string[]; // All visual lines for the current text and viewport width.
    viewportVisualLines: string[]; // The subset of visual lines to be rendered based on visualScrollRow and viewport.height
    visualCursor: [number, number]; // Visual cursor [row, col] relative to the start of all visualLines
    visualScrollRow: number; // Scroll position for visual lines (index of the first visible visual line)
    /**
     * For each visual line (by absolute index in allVisualLines) provides a tuple
     * [logicalLineIndex, startColInLogical] that maps where that visual line
     * begins within the logical buffer. Indices are code-point based.
     */
    visualToLogicalMap: Array<[number, number]>;

    // Actions

    /** Replaces the entire buffer content with the provided text. Undoable. */
    setText: (text: string) => void;
    /** Insert a single character or string. */
    insert: (ch: string, opts?: { paste?: boolean }) => void;
    newline: () => void;
    backspace: () => void;
    del: () => void;
    move: (dir: Direction) => void;
    undo: () => void;
    redo: () => void;
    /** Replaces the text within the specified range with new text. */
    replaceRange: (
        startRow: number,
        startCol: number,
        endRow: number,
        endCol: number,
        text: string
    ) => void;
    /** Delete the word to the left of the caret. */
    deleteWordLeft: () => void;
    /** Delete the word to the right of the caret. */
    deleteWordRight: () => void;
    /** Deletes text from the cursor to the end of the current line. */
    killLineRight: () => void;
    /** Deletes text from the start of the current line to the cursor. */
    killLineLeft: () => void;
    /** High level "handleInput" – receives what Ink gives us. */
    handleInput: (key: Key) => void;

    replaceRangeByOffset: (startOffset: number, endOffset: number, replacementText: string) => void;
    getOffset: () => number;
    moveToOffset(offset: number): void;
    moveToVisualPosition(visualRow: number, visualCol: number): void;
    /** Update the viewport dimensions. */
    setViewport: (width: number, height: number) => void;
}
