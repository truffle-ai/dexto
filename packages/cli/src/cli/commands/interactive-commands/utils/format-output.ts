/**
 * Utility functions for formatting command output for ink-cli
 * Strips chalk formatting and provides plain text versions
 */

/**
 * Strip ANSI color codes from a string
 */
export function stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Format output for ink-cli (removes chalk formatting)
 * This allows commands to use chalk for regular CLI while returning plain text for ink-cli
 */
export function formatForInkCli(output: string): string {
    return stripAnsi(output);
}
