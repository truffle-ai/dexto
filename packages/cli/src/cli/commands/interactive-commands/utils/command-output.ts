/**
 * Command Output Helper
 * Utilities for consistent command output handling across all slash commands
 */

import { formatForInkCli } from './format-output.js';
import type { StyledOutput } from '../../../ink-cli/services/CommandService.js';
import type { StyledMessageType, StyledData } from '../../../ink-cli/state/types.js';

/**
 * Command output helper for consistent display and error handling
 * Returns formatted strings for ink-cli to render (no direct console output)
 */
export class CommandOutputHelper {
    /**
     * Format success message for ink-cli to display
     */
    static success(message: string): string {
        return formatForInkCli(message);
    }

    /**
     * Format info message for ink-cli to display
     */
    static info(message: string): string {
        return formatForInkCli(message);
    }

    /**
     * Format warning message for ink-cli to display
     */
    static warning(message: string): string {
        return formatForInkCli(`⚠️ ${message}`);
    }

    /**
     * Format error message for ink-cli to display
     */
    static error(error: unknown, context?: string): string {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const fullMessage = context ? `❌ ${context}: ${errorMessage}` : `❌ ${errorMessage}`;
        return formatForInkCli(fullMessage);
    }

    /**
     * Format multi-line output for ink-cli to display
     */
    static output(lines: string[]): string {
        return formatForInkCli(lines.join('\n'));
    }

    /**
     * Validate required argument and return error if missing
     * Returns null if valid, error string if invalid
     */
    static validateRequiredArg(
        args: string[],
        index: number,
        argName: string,
        usage: string
    ): string | null {
        if (args.length <= index || !args[index]) {
            return formatForInkCli(`❌ ${argName} is required\nUsage: ${usage}`);
        }
        return null;
    }

    /**
     * No output (command executed successfully with no output to display)
     */
    static noOutput(): string {
        return '';
    }

    /**
     * Create styled output for rich rendering in ink-cli
     * @param styledType - The type of styled rendering
     * @param styledData - The structured data for rendering
     * @param fallbackText - Plain text fallback for logging/non-ink environments
     */
    static styled(
        styledType: StyledMessageType,
        styledData: StyledData,
        fallbackText: string
    ): StyledOutput {
        return {
            styledType,
            styledData,
            fallbackText: formatForInkCli(fallbackText),
        };
    }
}
