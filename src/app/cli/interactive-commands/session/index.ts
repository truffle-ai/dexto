/**
 * Session Commands Module
 *
 * This module provides centralized access to all session-related commands and utilities.
 * It serves as the main entry point for session management functionality in the CLI.
 *
 * Exports:
 * - sessionCommand: Complete session command definition with all subcommands
 * - historyCommand: Standalone history command
 * - searchCommand: Standalone search command
 * - sessionCommands: Array of all session-related commands
 * - Formatter utilities from helpers (re-exported for convenience)
 */

export { sessionCommand, historyCommand, searchCommand } from './session-commands.js';
export { formatSessionInfo, formatHistoryMessage } from './helpers/formatters.js';

// Export all session commands as a convenient array
import { sessionCommand, historyCommand, searchCommand } from './session-commands.js';
export const sessionCommands = [sessionCommand, historyCommand, searchCommand];
