/**
 * Stream Splitter Utilities
 *
 * Provides markdown-aware splitting for streaming content to reduce flickering.
 * Inspired by Gemini CLI and Codex approaches:
 * - Gemini: Split at paragraph boundaries (\n\n) avoiding code blocks
 * - Codex: Newline-gated commits (only render complete lines)
 *
 * Our hybrid approach:
 * - Find safe split points at paragraph boundaries
 * - Protect code blocks from being split mid-block
 * - Allow progressive finalization during streaming
 */

/**
 * Checks if a given index is inside a fenced code block (``` ... ```)
 */
function isIndexInsideCodeBlock(content: string, indexToTest: number): boolean {
    let fenceCount = 0;
    let searchPos = 0;

    while (searchPos < content.length) {
        const nextFence = content.indexOf('```', searchPos);
        if (nextFence === -1 || nextFence >= indexToTest) {
            break;
        }
        fenceCount++;
        searchPos = nextFence + 3;
    }

    return fenceCount % 2 === 1;
}

/**
 * Finds the starting index of the code block that encloses the given index.
 * Returns -1 if the index is not inside a code block.
 */
function findEnclosingCodeBlockStart(content: string, index: number): number {
    if (!isIndexInsideCodeBlock(content, index)) {
        return -1;
    }

    let currentSearchPos = 0;
    while (currentSearchPos < index) {
        const blockStartIndex = content.indexOf('```', currentSearchPos);
        if (blockStartIndex === -1 || blockStartIndex >= index) {
            break;
        }

        const blockEndIndex = content.indexOf('```', blockStartIndex + 3);
        if (blockStartIndex < index) {
            if (blockEndIndex === -1 || index < blockEndIndex + 3) {
                return blockStartIndex;
            }
        }

        if (blockEndIndex === -1) break;
        currentSearchPos = blockEndIndex + 3;
    }

    return -1;
}

/**
 * Find the last safe split point in the content.
 *
 * Safe split points are:
 * 1. After paragraph breaks (\n\n) that are not inside code blocks
 * 2. Before code blocks if we're inside one
 *
 * Returns the index to split at, or content.length if no split is needed.
 */
export function findLastSafeSplitPoint(content: string): number {
    // If we're inside a code block at the end, split before it
    const enclosingBlockStart = findEnclosingCodeBlockStart(content, content.length);
    if (enclosingBlockStart !== -1) {
        return enclosingBlockStart;
    }

    // Search for the last double newline (\n\n) not in a code block
    let searchStartIndex = content.length;
    while (searchStartIndex >= 0) {
        const dnlIndex = content.lastIndexOf('\n\n', searchStartIndex);
        if (dnlIndex === -1) {
            break;
        }

        const potentialSplitPoint = dnlIndex + 2;
        if (!isIndexInsideCodeBlock(content, potentialSplitPoint)) {
            return potentialSplitPoint;
        }

        // If potentialSplitPoint was inside a code block,
        // search before the \n\n we just found
        searchStartIndex = dnlIndex - 1;
    }

    // No safe split point found, return full length
    return content.length;
}

/**
 * Find the last newline that's not inside a code block.
 * Used for line-based batching (Codex approach).
 */
export function findLastSafeNewline(content: string): number {
    let searchPos = content.length;

    while (searchPos > 0) {
        const nlIndex = content.lastIndexOf('\n', searchPos - 1);
        if (nlIndex === -1) {
            break;
        }

        if (!isIndexInsideCodeBlock(content, nlIndex)) {
            return nlIndex + 1; // Return position after the newline
        }

        searchPos = nlIndex;
    }

    return -1; // No safe newline found
}

/**
 * Minimum content length before considering a split.
 * Prevents excessive splitting on small content.
 */
const MIN_SPLIT_LENGTH = 500;

/**
 * Determines if content should be split for progressive finalization.
 *
 * Returns:
 * - { shouldSplit: false } if no split needed
 * - { shouldSplit: true, splitIndex, before, after } if split found
 */
export function checkForSplit(content: string): {
    shouldSplit: boolean;
    splitIndex?: number;
    before?: string;
    after?: string;
} {
    // Don't split small content
    if (content.length < MIN_SPLIT_LENGTH) {
        return { shouldSplit: false };
    }

    const splitPoint = findLastSafeSplitPoint(content);

    // Only split if we have meaningful content before and after
    if (splitPoint > 100 && splitPoint < content.length - 50) {
        return {
            shouldSplit: true,
            splitIndex: splitPoint,
            before: content.substring(0, splitPoint),
            after: content.substring(splitPoint),
        };
    }

    return { shouldSplit: false };
}
