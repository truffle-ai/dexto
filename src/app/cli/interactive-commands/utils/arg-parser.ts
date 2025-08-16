/**
 * Argument Parsing Utilities
 *
 * This module provides utilities for parsing command-line arguments in the
 * interactive CLI commands. These utilities are designed to be reusable
 * across different command modules.
 */

/**
 * Result of parsing command-line arguments
 */
export interface ParsedArguments {
    /** Regular arguments (non-option arguments) */
    parsedArgs: string[];
    /** Options in --key=value format */
    options: Record<string, string>;
    /** Flags in --flag format (boolean options) */
    flags: Set<string>;
}

/**
 * Parse command-line arguments supporting --key=value options and --flag style flags.
 *
 * This function separates regular arguments from options and flags:
 * - Regular args: any argument that doesn't start with --
 * - Options: --key=value format, parsed into options object
 * - Flags: --flag format (no value), parsed into flags set
 *
 * @param args Array of command-line arguments to parse
 * @returns Object containing parsed arguments, options, and flags
 *
 * @example
 * ```typescript
 * const result = parseOptions(['server', 'cmd', '--timeout=5000', '--verbose']);
 * // result.parsedArgs: ['server', 'cmd']
 * // result.options: { timeout: '5000' }
 * // result.flags: Set(['verbose'])
 * ```
 */
export function parseOptions(args: string[]): ParsedArguments {
    const parsedArgs: string[] = [];
    const options: Record<string, string> = {};
    const flags: Set<string> = new Set();

    for (const arg of args) {
        if (arg.startsWith('--')) {
            if (arg.includes('=')) {
                // Handle --key=value format
                const [key, ...valueParts] = arg.slice(2).split('=');
                if (key) {
                    // Rejoin value parts in case the value contained '=' characters
                    options[key] = valueParts.join('=');
                }
            } else {
                // Handle --flag format (boolean flags)
                flags.add(arg.slice(2));
            }
        } else {
            // Regular argument (not an option)
            parsedArgs.push(arg);
        }
    }

    return { parsedArgs, options, flags };
}

/**
 * Convert parsed options back to command-line argument format.
 * Useful for debugging or reconstructing command lines.
 *
 * @param parsed The parsed arguments object
 * @returns Array of command-line arguments
 *
 * @example
 * ```typescript
 * const args = reconstructArgs({
 *   parsedArgs: ['server', 'cmd'],
 *   options: { timeout: '5000' },
 *   flags: new Set(['verbose'])
 * });
 * // Result: ['server', 'cmd', '--timeout=5000', '--verbose']
 * ```
 */
export function reconstructArgs(parsed: ParsedArguments): string[] {
    const result: string[] = [...parsed.parsedArgs];

    // Add options in --key=value format
    for (const [key, value] of Object.entries(parsed.options)) {
        result.push(`--${key}=${value}`);
    }

    // Add flags in --flag format
    for (const flag of parsed.flags) {
        result.push(`--${flag}`);
    }

    return result;
}
