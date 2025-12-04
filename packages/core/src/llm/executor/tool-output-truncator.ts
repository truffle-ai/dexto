import { SanitizedToolResult } from '../../context/types.js';

// Constants - configurable per agent
export const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 120_000; // ~30K tokens
export const DEFAULT_MAX_FILE_LINES = 2000;
export const DEFAULT_MAX_LINE_LENGTH = 2000;

export interface TruncationOptions {
    maxChars?: number;
}

export interface TruncationResult {
    output: string;
    truncated: boolean;
    originalLength: number;
}

/**
 * Truncates a string tool output to prevent context overflow.
 * Appends a warning message if truncated.
 */
export function truncateStringOutput(
    output: string,
    options: TruncationOptions = {}
): TruncationResult {
    const maxChars = options.maxChars ?? DEFAULT_MAX_TOOL_OUTPUT_CHARS;

    if (output.length <= maxChars) {
        return {
            output,
            truncated: false,
            originalLength: output.length,
        };
    }

    const truncatedOutput =
        output.slice(0, maxChars) +
        `\n\n[Output truncated - exceeded maximum length of ${maxChars} characters. Total length was ${output.length} characters.]`;

    return {
        output: truncatedOutput,
        truncated: true,
        originalLength: output.length,
    };
}

/**
 * Truncates a SanitizedToolResult.
 * Currently only truncates text parts.
 *
 * @param result The sanitized tool result to truncate
 * @param options Truncation options
 * @returns The truncated result
 */
export function truncateToolResult(
    result: SanitizedToolResult,
    options: TruncationOptions = {}
): SanitizedToolResult {
    const newContent = result.content.map((part) => {
        if (part.type === 'text') {
            const { output, truncated } = truncateStringOutput(part.text, options);
            if (truncated) {
                return { ...part, text: output };
            }
        }
        return part;
    });

    return {
        ...result,
        content: newContent,
        meta: {
            ...result.meta,
            // We could add a flag here if we wanted to track truncation in metadata
        },
    };
}
