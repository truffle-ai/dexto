/**
 * Utility functions for bash command pattern generation and matching.
 *
 * Pattern-based approval allows users to approve command patterns like "git *"
 * that automatically cover future matching commands (e.g., "git status", "git push").
 */

/**
 * Check if a stored pattern covers a target pattern key.
 * Pattern A covers pattern B if:
 * 1. A == B (exact match), OR
 * 2. B's base starts with A's base + " " (broader pattern covers narrower)
 *
 * Examples:
 * - `git *` covers `git push *`: base `git` is prefix of base `git push`
 * - `ls *` covers `ls *`: exact match
 * - `npm *` does NOT cover `npx *`: `npx` doesn't start with `npm `
 *
 * @param storedPattern The approved pattern (e.g., "git *")
 * @param targetPatternKey The pattern key to check (e.g., "git push *")
 * @returns true if storedPattern covers targetPatternKey
 */
export function patternCovers(storedPattern: string, targetPatternKey: string): boolean {
    // Exact match
    if (storedPattern === targetPatternKey) return true;

    // Extract bases by stripping trailing " *"
    const storedBase = storedPattern.endsWith(' *') ? storedPattern.slice(0, -2) : storedPattern;
    const targetBase = targetPatternKey.endsWith(' *')
        ? targetPatternKey.slice(0, -2)
        : targetPatternKey;

    // Broader pattern covers narrower: "git" covers "git push"
    // targetBase must start with storedBase + " " (space after command)
    return targetBase.startsWith(storedBase + ' ');
}

/**
 * Commands that should never get auto-approve pattern suggestions.
 * These require explicit approval each time for safety.
 */
export const DANGEROUS_COMMAND_PREFIXES = [
    'rm',
    'chmod',
    'chown',
    'chgrp',
    'sudo',
    'su',
    'dd',
    'mkfs',
    'fdisk',
    'parted',
    'kill',
    'killall',
    'pkill',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
] as const;

/**
 * Check if a command prefix is dangerous (should not get pattern suggestions).
 */
export function isDangerousCommand(command: string): boolean {
    const tokens = command.trim().split(/\s+/);
    if (tokens.length === 0 || !tokens[0]) return false;
    const head = tokens[0].toLowerCase();
    return DANGEROUS_COMMAND_PREFIXES.includes(head as (typeof DANGEROUS_COMMAND_PREFIXES)[number]);
}

/**
 * Generate the pattern key for a bash command.
 * This is what gets stored when user approves, and what gets checked against approved patterns.
 *
 * Examples:
 * - "ls -la" → "ls *" (flags don't count as subcommand)
 * - "git push origin" → "git push *" (first non-flag arg is subcommand)
 * - "git status" → "git status *"
 * - "rm -rf /" → null (dangerous command)
 *
 * @param command The bash command to generate a pattern key for
 * @returns The pattern key, or null if the command is dangerous
 */
export function generateBashPatternKey(command: string): string | null {
    const tokens = command.trim().split(/\s+/);
    if (tokens.length === 0 || !tokens[0]) return null;

    const head = tokens[0];

    if (isDangerousCommand(command)) {
        return null;
    }

    // Find first non-flag argument as subcommand
    const subcommand = tokens.slice(1).find((arg) => !arg.startsWith('-'));

    // Generate pattern: "git push *" or "ls *"
    return subcommand ? `${head} ${subcommand} *` : `${head} *`;
}

/**
 * Generate suggested patterns for UI selection.
 * Returns progressively broader patterns from specific to general.
 *
 * Example: "git push origin main" generates:
 *   - "git push *" (the pattern key)
 *   - "git *" (broader)
 *
 * @param command The bash command to generate suggestions for
 * @returns Array of pattern suggestions (empty for dangerous commands)
 */
export function generateBashPatternSuggestions(command: string): string[] {
    const tokens = command.trim().split(/\s+/);
    if (tokens.length === 0 || !tokens[0]) return [];

    const head = tokens[0];

    if (isDangerousCommand(command)) {
        return [];
    }

    const patterns: string[] = [];

    // Find non-flag arguments
    const nonFlagArgs = tokens.slice(1).filter((arg) => !arg.startsWith('-'));

    // Add progressively broader patterns
    // "git push origin" → ["git push *", "git *"]
    if (nonFlagArgs.length > 0) {
        patterns.push(`${head} ${nonFlagArgs[0]} *`);
    }
    patterns.push(`${head} *`);

    return patterns;
}
