/**
 * Utility functions for formatting command output for ink-cli
 * Strips chalk formatting and provides plain text versions
 */

import { stripVTControlCharacters } from 'node:util';

/**
 * Strip ANSI color codes from a string
 */
export function stripAnsi(str: string): string {
    return stripVTControlCharacters(str);
}

/**
 * Format output for ink-cli (removes chalk formatting)
 * This allows commands to use chalk for regular CLI while returning plain text for ink-cli
 */
export function formatForInkCli(output: string): string {
    return stripAnsi(output);
}
