/**
 * Session Commands Module (Interactive CLI)
 *
 * This module provides session-related commands for the interactive CLI.
 * These commands use interactive overlays/selectors rather than subcommands.
 *
 * Exports:
 * - searchCommand: Opens interactive search overlay
 * - resumeCommand: Shows interactive session selector
 * - renameCommand: Rename the current session
 *
 * Note: For non-interactive session subcommands (list, history, delete),
 * see src/cli/commands/session-commands.ts
 */

export { searchCommand, resumeCommand, renameCommand } from './session-commands.js';
