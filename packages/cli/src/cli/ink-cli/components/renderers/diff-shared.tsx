/**
 * Shared Diff Components and Utilities
 *
 * Common code for DiffRenderer and FilePreviewRenderer.
 * Handles unified diff parsing, word-level diff highlighting, and line rendering.
 */

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { diffWords } from 'diff';

// =============================================================================
// Types
// =============================================================================

export interface ParsedHunk {
    oldStart: number;
    newStart: number;
    lines: ParsedLine[];
}

export interface ParsedLine {
    type: 'context' | 'addition' | 'deletion';
    content: string;
    lineNum: number;
}

export interface WordDiffPart {
    value: string;
    added?: boolean;
    removed?: boolean;
}

// =============================================================================
// Diff Parsing
// =============================================================================

/**
 * Parse unified diff into structured hunks
 */
export function parseUnifiedDiff(unified: string): ParsedHunk[] {
    const lines = unified.split('\n');
    const hunks: ParsedHunk[] = [];
    let currentHunk: ParsedHunk | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
        if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:')) {
            continue;
        }

        const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (hunkMatch) {
            if (currentHunk) {
                hunks.push(currentHunk);
            }
            oldLine = parseInt(hunkMatch[1]!, 10);
            newLine = parseInt(hunkMatch[3]!, 10);
            currentHunk = {
                oldStart: oldLine,
                newStart: newLine,
                lines: [],
            };
            continue;
        }

        if (!currentHunk) continue;

        if (line.startsWith('+')) {
            currentHunk.lines.push({
                type: 'addition',
                content: line.slice(1),
                lineNum: newLine++,
            });
        } else if (line.startsWith('-')) {
            currentHunk.lines.push({
                type: 'deletion',
                content: line.slice(1),
                lineNum: oldLine++,
            });
        } else if (line.startsWith(' ') || line === '') {
            currentHunk.lines.push({
                type: 'context',
                content: line.startsWith(' ') ? line.slice(1) : line,
                lineNum: newLine,
            });
            oldLine++;
            newLine++;
        }
    }

    if (currentHunk) {
        hunks.push(currentHunk);
    }

    return hunks;
}

/**
 * Find paired deletion/addition lines for word-level diff
 */
export function findLinePairs(
    lines: ParsedLine[]
): Map<number, { del: ParsedLine; add: ParsedLine }> {
    const pairs = new Map<number, { del: ParsedLine; add: ParsedLine }>();

    for (let i = 0; i < lines.length - 1; i++) {
        const current = lines[i]!;
        const next = lines[i + 1]!;

        if (current.type === 'deletion' && next.type === 'addition') {
            pairs.set(i, { del: current, add: next });
        }
    }

    return pairs;
}

/**
 * Compute word-level diff between two strings
 */
export function computeWordDiff(
    oldStr: string,
    newStr: string
): { oldParts: WordDiffPart[]; newParts: WordDiffPart[] } {
    const changes = diffWords(oldStr, newStr);

    const oldParts: WordDiffPart[] = [];
    const newParts: WordDiffPart[] = [];

    for (const change of changes) {
        if (change.added) {
            newParts.push({ value: change.value, added: true });
        } else if (change.removed) {
            oldParts.push({ value: change.value, removed: true });
        } else {
            oldParts.push({ value: change.value });
            newParts.push({ value: change.value });
        }
    }

    return { oldParts, newParts };
}

// =============================================================================
// Line Number Formatting
// =============================================================================

export function getLineNumWidth(maxLineNum: number): number {
    return Math.max(3, String(maxLineNum).length);
}

export function formatLineNum(num: number, width: number): string {
    return String(num).padStart(width, ' ');
}

// =============================================================================
// Diff Line Component
// =============================================================================

interface DiffLineProps {
    type: 'context' | 'addition' | 'deletion';
    lineNum: number;
    lineNumWidth: number;
    content: string;
    wordDiffParts?: WordDiffPart[];
}

/**
 * Render a single diff line with true 2-column layout.
 * Column 1: Fixed-width gutter (line number + symbol)
 * Column 2: Fixed-width content area (remaining terminal width)
 * This prevents content/backgrounds from leaking beyond boundaries.
 */
export function DiffLine({ type, lineNum, lineNumWidth, content, wordDiffParts }: DiffLineProps) {
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns ?? 80;

    const lineNumStr = formatLineNum(lineNum, lineNumWidth);
    // Gutter: line number + space + symbol + space (e.g., " 42 - ")
    const gutterWidth = lineNumWidth + 3;

    // Content column width - remaining space after gutter and padding
    // Account for padding (2 chars from DiffRenderer's paddingLeft)
    const contentWidth = Math.max(20, terminalWidth - gutterWidth - 4);

    // Get colors based on type
    const getColors = () => {
        switch (type) {
            case 'deletion':
                return { bg: '#662222', fg: 'white', symbol: '-', symbolColor: 'red' };
            case 'addition':
                return { bg: '#224466', fg: 'white', symbol: '+', symbolColor: 'blue' };
            default:
                return { bg: undefined, fg: undefined, symbol: ' ', symbolColor: undefined };
        }
    };

    const colors = getColors();

    // Render content with word-level diff highlighting if available
    const renderContent = () => {
        if (wordDiffParts && wordDiffParts.length > 0) {
            return wordDiffParts.map((part, i) => {
                if (type === 'deletion' && part.removed) {
                    return (
                        <Text key={i} backgroundColor="#882222">
                            {part.value}
                        </Text>
                    );
                } else if (type === 'addition' && part.added) {
                    return (
                        <Text key={i} backgroundColor="#224488">
                            {part.value}
                        </Text>
                    );
                }
                return <Text key={i}>{part.value}</Text>;
            });
        }
        return content;
    };

    return (
        <Box>
            {/* Column 1: Fixed-width gutter */}
            <Box width={gutterWidth} flexShrink={0}>
                <Text color="gray">{lineNumStr}</Text>
                <Text color={colors.symbolColor as any}> {colors.symbol} </Text>
            </Box>
            {/* Column 2: Fixed-width content - text wraps within this boundary */}
            <Box width={contentWidth} flexShrink={0}>
                <Text backgroundColor={colors.bg as any} color={colors.fg as any} wrap="wrap">
                    {renderContent()}
                </Text>
            </Box>
        </Box>
    );
}

/**
 * Hunk separator component
 */
export function HunkSeparator() {
    return (
        <Box>
            <Text color="gray">...</Text>
        </Box>
    );
}
