/**
 * Utility functions for generating approval patterns for shell commands.
 *
 * Pattern-based approvals allow users to approve command patterns like "git *"
 * that automatically cover future matching commands (e.g., "git status", "git push").
 */

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

export function isDangerousCommand(command: string): boolean {
    const tokens = command.trim().split(/\s+/);
    if (!tokens[0]) return false;
    const head = tokens[0].toLowerCase();
    return DANGEROUS_COMMAND_PREFIXES.includes(head as (typeof DANGEROUS_COMMAND_PREFIXES)[number]);
}

/**
 * Generate the pattern key for a shell command.
 *
 * Examples:
 * - "ls -la" → "ls *" (flags don't count as subcommand)
 * - "git push origin" → "git push *" (first non-flag arg is subcommand)
 * - "rm -rf /" → null (dangerous command)
 */
export function generateCommandPatternKey(command: string): string | null {
    const tokens = command.trim().split(/\s+/);
    if (!tokens[0]) return null;

    const head = tokens[0].toLowerCase();

    if (isDangerousCommand(command)) {
        return null;
    }

    const subcommand = tokens.slice(1).find((arg) => !arg.startsWith('-'));
    return subcommand ? `${head} ${subcommand.toLowerCase()} *` : `${head} *`;
}

/**
 * Generate suggested patterns for UI selection.
 * Returns progressively broader patterns from specific to general.
 *
 * Example: "git push origin main" → ["git push *", "git *"]
 */
export function generateCommandPatternSuggestions(command: string): string[] {
    const tokens = command.trim().toLowerCase().split(/\s+/);
    if (!tokens[0]) return [];

    const head = tokens[0];

    if (isDangerousCommand(command)) {
        return [];
    }

    const patterns: string[] = [];
    const nonFlagArgs = tokens.slice(1).filter((arg) => !arg.startsWith('-'));

    if (nonFlagArgs.length > 0) {
        patterns.push(`${head} ${nonFlagArgs[0]} *`);
    }
    patterns.push(`${head} *`);

    return patterns;
}
