/**
 * Input parsing utilities
 * Helpers for detecting autocomplete triggers and parsing input
 */

import { parseInput } from '../../commands/interactive-commands/command-parser.js';
import type { CommandResult } from '../../commands/interactive-commands/command-parser.js';

/**
 * Autocomplete type
 */
export type AutocompleteType = 'none' | 'slash' | 'resource';

/**
 * Interactive selector type
 */
export type InteractiveSelectorType = 'none' | 'model' | 'session';

/**
 * Detects what type of autocomplete should be shown based on input
 */
export function detectAutocompleteType(input: string): AutocompleteType {
    if (input.startsWith('/')) {
        return 'slash';
    }

    // Check for @ mention (at start or after space)
    const atIndex = findActiveAtIndex(input, input.length);
    if (atIndex >= 0) {
        return 'resource';
    }

    return 'none';
}

/**
 * Detects if an interactive selector should be shown based on parsed command
 */
export function detectInteractiveSelector(parsed: CommandResult): InteractiveSelectorType {
    if (parsed.type !== 'command' || !parsed.command) {
        return 'none';
    }

    const command = parsed.command;
    const hasArgs = parsed.args && parsed.args.length > 0;
    const hasSpaceAfterCommand =
        parsed.rawInput.includes(' ') && parsed.rawInput.trim().length > command.length + 1;

    // Model selector
    if (command === 'model' && !hasArgs && !hasSpaceAfterCommand) {
        return 'model';
    }

    // Session selector
    if ((command === 'resume' || command === 'switch') && !hasArgs && !hasSpaceAfterCommand) {
        return 'session';
    }

    if (
        command === 'session' &&
        parsed.args &&
        parsed.args[0] === 'switch' &&
        parsed.args.length === 1 &&
        !hasSpaceAfterCommand
    ) {
        return 'session';
    }

    return 'none';
}

/**
 * Extracts the query string for slash command autocomplete
 */
export function extractSlashQuery(input: string): string {
    if (!input.startsWith('/')) return '';
    return input.slice(1).trim();
}

/**
 * Extracts the query string for resource autocomplete
 */
export function extractResourceQuery(input: string): string {
    const atIndex = findActiveAtIndex(input, input.length);
    if (atIndex < 0) return '';
    return input.slice(atIndex + 1).trim();
}

/**
 * Finds the active @ mention position (at start or after space)
 * Returns -1 if no valid @ found
 */
export function findActiveAtIndex(value: string, caret: number): number {
    // Walk backwards from caret to find an '@'
    for (let i = caret - 1; i >= 0; i--) {
        const ch = value[i];
        if (ch === '@') {
            // Check if @ is at start or preceded by whitespace
            if (i === 0) {
                return i; // @ at start is valid
            }
            const prev = value[i - 1];
            if (prev && /\s/.test(prev)) {
                return i; // @ after whitespace is valid
            }
            return -1; // @ in middle of text (like email) - ignore
        }
        if (ch && /\s/.test(ch)) break; // stop at whitespace
    }
    return -1;
}

/**
 * Re-export parseInput for convenience
 */
export { parseInput };
