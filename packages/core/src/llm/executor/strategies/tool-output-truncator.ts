/**
 * Tool Output Truncation - Truncate oversized tool outputs at source.
 *
 * This prevents a single large tool output (e.g., huge bash output, large file read)
 * from consuming the entire context window. Truncation happens when the tool
 * executes, before the result is stored.
 *
 * Different from tool-output-pruning.ts which marks OLD outputs for removal.
 * This truncates NEW outputs before they're ever stored.
 *
 * @see /complete-context-management-plan.md
 */

import type { ToolOutputConfig } from '../types.js';

/**
 * Default maximum characters for tool output (~30K tokens).
 */
export const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 120_000;

/**
 * Default maximum lines for file reading tools.
 */
export const DEFAULT_MAX_TOOL_OUTPUT_LINES = 2_000;

/**
 * Per-tool default limits (characters).
 */
export const DEFAULT_TOOL_LIMITS: Record<string, number> = {
    bash: 30_000, // ~7.5K tokens - bash can be verbose
    read: 80_000, // ~20K tokens - file contents
    grep: 40_000, // ~10K tokens - search results
    glob: 20_000, // ~5K tokens - file lists
    default: DEFAULT_MAX_TOOL_OUTPUT_CHARS,
};

/**
 * Result of truncation operation.
 */
export interface TruncateResult {
    /** The (possibly truncated) output */
    output: string;
    /** Whether truncation was applied */
    truncated: boolean;
    /** Original length before truncation */
    originalLength: number;
    /** Characters removed */
    charsRemoved: number;
}

/**
 * Truncate a tool output string to fit within limits.
 *
 * @param output The raw tool output
 * @param toolName The name of the tool (for per-tool limits)
 * @param config Optional configuration overrides
 * @returns Truncated output with metadata
 */
export function truncateToolOutput(
    output: string,
    toolName?: string,
    config?: ToolOutputConfig
): TruncateResult {
    const originalLength = output.length;

    // Determine the limit for this tool
    const maxChars = getMaxCharsForTool(toolName, config);

    // No truncation needed
    if (output.length <= maxChars) {
        return {
            output,
            truncated: false,
            originalLength,
            charsRemoved: 0,
        };
    }

    // Truncate with indicator
    const truncationMarker = `\n\n... [Output truncated: ${originalLength.toLocaleString()} chars → ${maxChars.toLocaleString()} chars] ...`;
    const availableSpace = maxChars - truncationMarker.length;

    // Keep beginning and end for context
    const headSize = Math.floor(availableSpace * 0.7); // 70% from start
    const tailSize = availableSpace - headSize; // 30% from end

    const head = output.slice(0, headSize);
    const tail = output.slice(-tailSize);

    const truncatedOutput = head + truncationMarker + tail;

    return {
        output: truncatedOutput,
        truncated: true,
        originalLength,
        charsRemoved: originalLength - maxChars,
    };
}

/**
 * Truncate output by line count (for file reading tools).
 *
 * @param output The raw output (multi-line)
 * @param maxLines Maximum lines to keep
 * @returns Truncated output with metadata
 */
export function truncateByLines(
    output: string,
    maxLines: number = DEFAULT_MAX_TOOL_OUTPUT_LINES
): TruncateResult {
    const lines = output.split('\n');
    const originalLength = output.length;

    if (lines.length <= maxLines) {
        return {
            output,
            truncated: false,
            originalLength,
            charsRemoved: 0,
        };
    }

    // Keep first and last lines
    const headLines = Math.floor(maxLines * 0.7);
    const tailLines = maxLines - headLines;

    const head = lines.slice(0, headLines);
    const tail = lines.slice(-tailLines);
    const removedCount = lines.length - maxLines;

    const truncationMarker = `\n... [${removedCount.toLocaleString()} lines truncated] ...\n`;

    const truncatedOutput = head.join('\n') + truncationMarker + tail.join('\n');

    return {
        output: truncatedOutput,
        truncated: true,
        originalLength,
        charsRemoved: originalLength - truncatedOutput.length,
    };
}

/**
 * Get the maximum characters allowed for a specific tool.
 */
function getMaxCharsForTool(toolName?: string, config?: ToolOutputConfig): number {
    // Check config overrides first
    if (config?.perToolLimits && toolName && config.perToolLimits[toolName]) {
        return config.perToolLimits[toolName];
    }

    // Check config default
    if (config?.maxChars) {
        return config.maxChars;
    }

    // Check built-in per-tool defaults
    if (toolName && DEFAULT_TOOL_LIMITS[toolName]) {
        return DEFAULT_TOOL_LIMITS[toolName];
    }

    // Fall back to global default
    return DEFAULT_MAX_TOOL_OUTPUT_CHARS;
}

/**
 * Truncate any type of tool result (handles objects, arrays, strings).
 *
 * @param result The raw tool result
 * @param toolName The name of the tool
 * @param config Optional configuration
 * @returns Truncated result (same type as input)
 */
export function truncateToolResult(
    result: unknown,
    toolName?: string,
    config?: ToolOutputConfig
): { result: unknown; truncated: boolean } {
    // Handle string results directly
    if (typeof result === 'string') {
        const truncateResult = truncateToolOutput(result, toolName, config);
        return {
            result: truncateResult.output,
            truncated: truncateResult.truncated,
        };
    }

    // Handle object/array results by stringifying, truncating, then noting truncation
    if (typeof result === 'object' && result !== null) {
        const stringified = JSON.stringify(result, null, 2);
        const truncateResult = truncateToolOutput(stringified, toolName, config);

        if (truncateResult.truncated) {
            // Return a simplified object indicating truncation
            return {
                result: {
                    _truncated: true,
                    _originalChars: truncateResult.originalLength,
                    _preview: truncateResult.output,
                },
                truncated: true,
            };
        }

        return { result, truncated: false };
    }

    // Primitives pass through
    return { result, truncated: false };
}
