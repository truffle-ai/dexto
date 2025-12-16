/**
 * Approval Preview Renderers
 *
 * Enhanced renderers for edit_file and write_file approval prompts.
 * Matches Claude Code's UX:
 * - Full line backgrounds (red for deletions, blue for additions)
 * - Hunk collapsing with ... separators
 * - Word-level diff highlighting
 * - "Edit file" / "Overwrite file" / "Create file" headers
 */

import React from 'react';
import { Box, Text } from 'ink';
import { diffWords } from 'diff';
import type { DiffDisplayData, FileDisplayData } from '@dexto/core';
import { makeRelativePath } from '../../utils/messageFormatting.js';

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
    lineNum: number; // The relevant line number (old for deletion, new for addition/context)
}

interface WordDiffPart {
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
function parseUnifiedDiff(unified: string): ParsedHunk[] {
    const lines = unified.split('\n');
    const hunks: ParsedHunk[] = [];
    let currentHunk: ParsedHunk | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
        // Skip file headers
        if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:')) {
            continue;
        }

        // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
        const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (hunkMatch) {
            if (currentHunk) {
                hunks.push(currentHunk);
            }
            // Groups 1 and 3 are guaranteed by the regex pattern
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

        // Parse diff lines
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
                lineNum: newLine, // Use new line number for context
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
 * Returns pairs of [deletion, addition] that are adjacent
 */
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

/**
 * Compute word-level diff between two strings
 */
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
            // Unchanged - appears in both
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
// Diff Line Components
// =============================================================================

interface DiffLineProps {
    type: 'context' | 'addition' | 'deletion';
    lineNum: number;
    lineNumWidth: number;
    content: string;
    wordDiffParts?: WordDiffPart[];
}

/**
 * Render a single diff line with full line background
 */
function DiffLine({ type, lineNum, lineNumWidth, content, wordDiffParts }: DiffLineProps) {
    const lineNumStr = formatLineNum(lineNum, lineNumWidth);

    // Render content with optional word-level highlighting
    const renderContent = () => {
        if (!wordDiffParts || wordDiffParts.length === 0) {
            return <Text>{content}</Text>;
        }

        return (
            <>
                {wordDiffParts.map((part, i) => {
                    if (type === 'deletion' && part.removed) {
                        // Highlighted removed word - brighter/inverse
                        return (
                            <Text key={i} backgroundColor="#882222">
                                {part.value}
                            </Text>
                        );
                    } else if (type === 'addition' && part.added) {
                        // Highlighted added word - brighter/inverse
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

/**
 * Hunk separator component
 */
function HunkSeparator() {
    return (
        <Box>
            <Text color="gray">...</Text>
        </Box>
    );
}

// =============================================================================
// DiffPreview Component
// =============================================================================

interface DiffPreviewProps {
    data: DiffDisplayData;
    /** Header text: "Edit file" or "Overwrite file" */
    headerType: 'edit' | 'overwrite';
}

/**
 * Enhanced diff preview for edit_file and write_file (overwrite) approval
 * Shows full diff with line backgrounds, hunk collapsing, and word-level highlighting
 */
export function DiffPreview({ data, headerType }: DiffPreviewProps) {
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
    const allLinePairs: Map<number, { del: ParsedLine; add: ParsedLine }>[] = hunks.map((hunk) =>
        findLinePairs(hunk.lines)
    );

    const headerText = headerType === 'edit' ? 'Edit file' : 'Overwrite file';

    return (
        <Box flexDirection="column" marginBottom={1}>
            {/* Header - standalone line */}
            <Box marginBottom={0}>
                <Text color="cyan" bold>
                    {headerText}
                </Text>
            </Box>

            {/* Box containing filename and diff content */}
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
                {/* Filename */}
                <Box marginBottom={0}>
                    <Text>{makeRelativePath(filename)}</Text>
                </Box>
                {hunks.map((hunk, hunkIndex) => {
                    const linePairs = allLinePairs[hunkIndex]!;
                    const processedIndices = new Set<number>();

                    return (
                        <React.Fragment key={hunkIndex}>
                            {/* Hunk separator (except for first hunk) */}
                            {hunkIndex > 0 && <HunkSeparator />}

                            {hunk.lines.map((line, lineIndex) => {
                                // Skip if already processed as part of a pair
                                if (processedIndices.has(lineIndex)) {
                                    return null;
                                }

                                // Check if this is part of a deletion/addition pair
                                const pair = linePairs.get(lineIndex);
                                if (pair) {
                                    // Mark the addition line as processed
                                    processedIndices.add(lineIndex + 1);

                                    // Compute word-level diff
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

                                // Regular line (no word-level diff)
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
            </Box>
        </Box>
    );
}

// =============================================================================
// CreateFilePreview Component
// =============================================================================

interface CreateFilePreviewProps {
    data: FileDisplayData;
}

/**
 * Preview for write_file (new file creation)
 * Shows full file content with line numbers, white text
 */
export function CreateFilePreview({ data }: CreateFilePreviewProps) {
    const { path, content, lineCount } = data;

    if (!content) {
        // Fallback if content not provided
        return (
            <Box flexDirection="column" marginBottom={1}>
                <Box marginBottom={0}>
                    <Text color="cyan" bold>
                        Create file
                    </Text>
                </Box>
                <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
                    <Text>{makeRelativePath(path)}</Text>
                    {lineCount && <Text dimColor>{lineCount} lines</Text>}
                </Box>
            </Box>
        );
    }

    const lines = content.split('\n');
    const lineNumWidth = getLineNumWidth(lines.length);

    return (
        <Box flexDirection="column" marginBottom={1}>
            {/* Header - standalone line */}
            <Box marginBottom={0}>
                <Text color="cyan" bold>
                    Create file
                </Text>
            </Box>

            {/* Box containing filename and file content */}
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
                {/* Filename */}
                <Box marginBottom={0}>
                    <Text>{makeRelativePath(path)}</Text>
                </Box>

                {/* File content */}
                {lines.map((line, index) => (
                    <Box key={index}>
                        <Text color="gray">{formatLineNum(index + 1, lineNumWidth)}</Text>
                        <Text>
                            {'   '}
                            {line}
                        </Text>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}
