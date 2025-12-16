/**
 * DiffRenderer Component
 *
 * Renders unified diff output with colored lines and line numbers.
 * Used for edit_file and write_file (overwrite) tool results in message list.
 * Matches the approval preview UX style.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { diffWords } from 'diff';
import type { DiffDisplayData } from '@dexto/core';
import { makeRelativePath } from '../../utils/messageFormatting.js';

interface DiffRendererProps {
    /** Diff display data from tool result */
    data: DiffDisplayData;
    /** Maximum lines to display before truncating */
    maxLines?: number;
}

// =============================================================================
// Types
// =============================================================================

interface ParsedHunk {
    oldStart: number;
    newStart: number;
    lines: ParsedLine[];
}

interface ParsedLine {
    type: 'context' | 'addition' | 'deletion';
    content: string;
    lineNum: number;
}

interface WordDiffPart {
    value: string;
    added?: boolean;
    removed?: boolean;
}

// =============================================================================
// Diff Parsing
// =============================================================================

function parseUnifiedDiff(unified: string): ParsedHunk[] {
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

function findLinePairs(lines: ParsedLine[]): Map<number, { del: ParsedLine; add: ParsedLine }> {
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

function computeWordDiff(
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

function getLineNumWidth(maxLineNum: number): number {
    return Math.max(3, String(maxLineNum).length);
}

function formatLineNum(num: number, width: number): string {
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

function DiffLine({ type, lineNum, lineNumWidth, content, wordDiffParts }: DiffLineProps) {
    const lineNumStr = formatLineNum(lineNum, lineNumWidth);

    const renderContent = () => {
        if (!wordDiffParts || wordDiffParts.length === 0) {
            return <Text>{content}</Text>;
        }

        return (
            <>
                {wordDiffParts.map((part, i) => {
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
                })}
            </>
        );
    };

    switch (type) {
        case 'deletion':
            return (
                <Box>
                    <Text backgroundColor="#662222" color="white">
                        {lineNumStr} {'- '}
                    </Text>
                    <Text backgroundColor="#662222" color="white">
                        {wordDiffParts ? renderContent() : content}
                    </Text>
                </Box>
            );
        case 'addition':
            return (
                <Box>
                    <Text backgroundColor="#224466" color="white">
                        {lineNumStr} {'+ '}
                    </Text>
                    <Text backgroundColor="#224466" color="white">
                        {wordDiffParts ? renderContent() : content}
                    </Text>
                </Box>
            );
        case 'context':
        default:
            return (
                <Box>
                    <Text color="gray">{lineNumStr}</Text>
                    <Text>
                        {'   '}
                        {content}
                    </Text>
                </Box>
            );
    }
}

function HunkSeparator() {
    return (
        <Box>
            <Text color="gray">...</Text>
        </Box>
    );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Renders unified diff with colored lines, line numbers, and word-level highlighting.
 * Matches the approval preview UX style. No truncation - shows all lines.
 */
export function DiffRenderer({ data, maxLines = Infinity }: DiffRendererProps) {
    const { unified, filename, additions, deletions } = data;
    const hunks = parseUnifiedDiff(unified);

    // Calculate max line number for width
    let maxLineNum = 1;
    for (const hunk of hunks) {
        for (const line of hunk.lines) {
            maxLineNum = Math.max(maxLineNum, line.lineNum);
        }
    }
    const lineNumWidth = getLineNumWidth(maxLineNum);

    // Find line pairs for word-level diff
    const allLinePairs = hunks.map((hunk) => findLinePairs(hunk.lines));

    // Count total display lines and apply truncation
    let totalLines = 0;
    for (const hunk of hunks) {
        totalLines += hunk.lines.length;
    }

    const shouldTruncate = totalLines > maxLines;
    let linesRendered = 0;

    return (
        <Box flexDirection="column">
            {/* Header */}
            <Box>
                <Text dimColor>{'  ⎿ '}</Text>
                <Text>{makeRelativePath(filename)}</Text>
                <Text color="green"> +{additions}</Text>
                <Text color="red"> -{deletions}</Text>
            </Box>

            {/* Diff content */}
            <Box flexDirection="column" marginLeft={2}>
                {hunks.map((hunk, hunkIndex) => {
                    if (shouldTruncate && linesRendered >= maxLines) {
                        return null;
                    }

                    const linePairs = allLinePairs[hunkIndex]!;
                    const processedIndices = new Set<number>();

                    return (
                        <React.Fragment key={hunkIndex}>
                            {hunkIndex > 0 && <HunkSeparator />}

                            {hunk.lines.map((line, lineIndex) => {
                                if (shouldTruncate && linesRendered >= maxLines) {
                                    return null;
                                }

                                if (processedIndices.has(lineIndex)) {
                                    return null;
                                }

                                const pair = linePairs.get(lineIndex);
                                if (pair) {
                                    processedIndices.add(lineIndex + 1);

                                    if (shouldTruncate && linesRendered + 2 > maxLines) {
                                        linesRendered = maxLines;
                                        return null;
                                    }

                                    linesRendered += 2;

                                    const { oldParts, newParts } = computeWordDiff(
                                        pair.del.content,
                                        pair.add.content
                                    );

                                    return (
                                        <React.Fragment key={lineIndex}>
                                            <DiffLine
                                                type="deletion"
                                                lineNum={pair.del.lineNum}
                                                lineNumWidth={lineNumWidth}
                                                content={pair.del.content}
                                                wordDiffParts={oldParts}
                                            />
                                            <DiffLine
                                                type="addition"
                                                lineNum={pair.add.lineNum}
                                                lineNumWidth={lineNumWidth}
                                                content={pair.add.content}
                                                wordDiffParts={newParts}
                                            />
                                        </React.Fragment>
                                    );
                                }

                                linesRendered++;

                                return (
                                    <DiffLine
                                        key={lineIndex}
                                        type={line.type}
                                        lineNum={line.lineNum}
                                        lineNumWidth={lineNumWidth}
                                        content={line.content}
                                    />
                                );
                            })}
                        </React.Fragment>
                    );
                })}

                {shouldTruncate && <Text dimColor>... +{totalLines - maxLines} lines</Text>}
            </Box>
        </Box>
    );
}
