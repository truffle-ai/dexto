/**
 * File Preview Renderers
 *
 * Preview renderers for edit_file and write_file approval prompts.
 * - DiffPreview: for edit_file and write_file (overwrite)
 * - CreateFilePreview: for write_file (new file)
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DiffDisplayData, FileDisplayData } from '@dexto/core';
import { makeRelativePath } from '../../utils/messageFormatting.js';
import {
    parseUnifiedDiff,
    findLinePairs,
    computeWordDiff,
    getLineNumWidth,
    formatLineNum,
    DiffLine,
    HunkSeparator,
} from './diff-shared.js';

// =============================================================================
// DiffPreview Component
// =============================================================================

interface DiffPreviewProps {
    data: DiffDisplayData;
    /** Header text: "Edit file" or "Overwrite file" */
    headerType: 'edit' | 'overwrite';
    /** Maximum diff lines to display before truncating */
    maxLines?: number;
}

/**
 * Enhanced diff preview for edit_file and write_file (overwrite) approval
 * Shows full diff with line backgrounds, hunk collapsing, and word-level highlighting
 */
export function DiffPreview({ data, headerType, maxLines = Infinity }: DiffPreviewProps) {
    const { unified, filename } = data;
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

    const headerText = headerType === 'edit' ? 'Edit file' : 'Overwrite file';

    // Count total display lines and apply truncation
    let totalLines = 0;
    for (const hunk of hunks) {
        totalLines += hunk.lines.length;
    }

    const shouldTruncate = totalLines > maxLines;
    let linesRendered = 0;

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
                    if (shouldTruncate && linesRendered >= maxLines) {
                        return null;
                    }

                    const linePairs = allLinePairs[hunkIndex]!;
                    const processedIndices = new Set<number>();

                    return (
                        <React.Fragment key={hunkIndex}>
                            {/* Hunk separator (except for first hunk) */}
                            {hunkIndex > 0 && <HunkSeparator />}

                            {hunk.lines.map((line, lineIndex) => {
                                if (shouldTruncate && linesRendered >= maxLines) {
                                    return null;
                                }

                                // Skip if already processed as part of a pair
                                if (processedIndices.has(lineIndex)) {
                                    return null;
                                }

                                // Check if this is part of a deletion/addition pair
                                const pair = linePairs.get(lineIndex);
                                if (pair) {
                                    // Mark the addition line as processed
                                    processedIndices.add(lineIndex + 1);

                                    if (shouldTruncate && linesRendered + 2 > maxLines) {
                                        linesRendered = maxLines;
                                        return null;
                                    }
                                    linesRendered += 2;

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

                                linesRendered++;

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

                {shouldTruncate && (
                    <Box>
                        <Text color="gray">... +{totalLines - maxLines} lines</Text>
                    </Box>
                )}
            </Box>
        </Box>
    );
}

// =============================================================================
// CreateFilePreview Component
// =============================================================================

interface CreateFilePreviewProps {
    data: FileDisplayData;
    /** Custom header text (defaults to "Create file") */
    header?: string;
    /** Maximum file lines to display before truncating */
    maxLines?: number;
}

/**
 * Preview for write_file (new file creation) or plan review
 * Shows full file content with line numbers, white text
 */
export function CreateFilePreview({
    data,
    header = 'Create file',
    maxLines = Infinity,
}: CreateFilePreviewProps) {
    const { path, content, lineCount } = data;

    if (!content) {
        // Fallback if content not provided
        return (
            <Box flexDirection="column" marginBottom={1}>
                <Box marginBottom={0}>
                    <Text color="cyan" bold>
                        {header}
                    </Text>
                </Box>
                <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
                    <Text>{makeRelativePath(path)}</Text>
                    {lineCount && <Text color="gray">{lineCount} lines</Text>}
                </Box>
            </Box>
        );
    }

    const lines = content.split('\n');
    const lineNumWidth = getLineNumWidth(lines.length);
    const shouldTruncate = lines.length > maxLines;
    const visibleLines = shouldTruncate ? lines.slice(0, maxLines) : lines;

    return (
        <Box flexDirection="column" marginBottom={1}>
            {/* Header - standalone line */}
            <Box marginBottom={0}>
                <Text color="cyan" bold>
                    {header}
                </Text>
            </Box>

            {/* Box containing filename and file content */}
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
                {/* Filename */}
                <Box marginBottom={0}>
                    <Text>{makeRelativePath(path)}</Text>
                </Box>

                {/* File content */}
                {visibleLines.map((line, index) => (
                    <Box key={index}>
                        <Text color="gray">{formatLineNum(index + 1, lineNumWidth)}</Text>
                        <Text>
                            {'   '}
                            {line}
                        </Text>
                    </Box>
                ))}

                {shouldTruncate && (
                    <Box>
                        <Text color="gray">... +{lines.length - maxLines} lines</Text>
                    </Box>
                )}
            </Box>
        </Box>
    );
}
