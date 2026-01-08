/**
 * DiffRenderer Component
 *
 * Renders unified diff output with colored lines and line numbers.
 * Used for edit_file and write_file (overwrite) tool results in message list.
 * Matches the approval preview UX style.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DiffDisplayData } from '@dexto/core';
import { makeRelativePath } from '../../utils/messageFormatting.js';
import {
    parseUnifiedDiff,
    findLinePairs,
    computeWordDiff,
    getLineNumWidth,
    DiffLine,
    HunkSeparator,
} from './diff-shared.js';

interface DiffRendererProps {
    /** Diff display data from tool result */
    data: DiffDisplayData;
    /** Maximum lines to display before truncating */
    maxLines?: number;
}

/**
 * Renders unified diff with colored lines, line numbers, and word-level highlighting.
 * Matches the approval preview UX style. No truncation by default.
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
                <Text color="gray">{'  ⎿ '}</Text>
                <Text>{makeRelativePath(filename)}</Text>
                <Text color="green"> +{additions}</Text>
                <Text color="red"> -{deletions}</Text>
            </Box>

            {/* Diff content - paddingLeft keeps backgrounds bounded within container */}
            <Box flexDirection="column" paddingLeft={2}>
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

                {shouldTruncate && <Text color="gray">... +{totalLines - maxLines} lines</Text>}
            </Box>
        </Box>
    );
}
