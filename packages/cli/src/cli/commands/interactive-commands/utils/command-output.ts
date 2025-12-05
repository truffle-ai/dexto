/**
 * Command Output Helper
 * Utilities for consistent command output handling across all slash commands
 */

import chalk from 'chalk';
import { logger } from '@dexto/core';
import { formatForInkCli } from './format-output.js';
import type { StyledOutput } from '../../../ink-cli/services/CommandService.js';
import type { StyledMessageType, StyledData } from '../../../ink-cli/state/types.js';

/**
 * Command output helper for consistent display and error handling
 */
export class CommandOutputHelper {
    /**
     * Display success message consistently
     * Logs to console with color and returns formatted string for ink-cli
     */
    static success(message: string): string {
        console.log(chalk.green(message));
        return formatForInkCli(message);
    }

    /**
     * Display info message consistently
     * Logs to console with color and returns formatted string for ink-cli
     */
    static info(message: string): string {
        console.log(chalk.blue(message));
        return formatForInkCli(message);
    }

    /**
     * Display warning message consistently
     * Logs to console with color and returns formatted string for ink-cli
     */
    static warning(message: string): string {
        console.log(chalk.yellow(message));
        return formatForInkCli(message);
    }

    /**
     * Handle errors consistently across all commands
     * Logs error and returns formatted error string
     */
    static error(error: unknown, context?: string): string {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const fullMessage = context ? `❌ ${context}: ${errorMessage}` : `❌ ${errorMessage}`;

        logger.error(fullMessage);
        console.error(chalk.red(fullMessage));
        return formatForInkCli(fullMessage);
    }

    /**
     * Build multi-line output with consistent formatting
     * Logs to console and returns formatted string for ink-cli
     */
    static output(lines: string[]): string {
        const output = lines.join('\n');
        console.log(output);
        return formatForInkCli(output);
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
            const errorMsg = `❌ ${argName} is required\nUsage: ${usage}`;
            console.error(chalk.red(`❌ ${argName} is required`));
            console.error(chalk.dim(`Usage: ${usage}`));
            return formatForInkCli(errorMsg);
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
        // Log fallback text to console for non-ink environments
        console.log(fallbackText);
        return {
            styledType,
            styledData,
            fallbackText: formatForInkCli(fallbackText),
        };
    }
}
