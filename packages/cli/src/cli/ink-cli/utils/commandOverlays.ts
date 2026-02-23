/**
 * Command Overlay Registry
 *
 * Central source of truth for command-to-overlay mappings.
 * When adding a new interactive command, add it here - no other files need changes.
 */

import type { OverlayType } from '../state/types.js';

/**
 * Commands that ALWAYS show an overlay when invoked.
 * These commands have no handler logic - the overlay IS the functionality.
 */
const ALWAYS_OVERLAY: Record<string, OverlayType> = {
    search: 'search',
    find: 'search', // alias
    model: 'model-selector',
    resume: 'session-selector',
    switch: 'session-selector',
    stream: 'stream-selector',
    sounds: 'sounds-selector',
    tools: 'tool-browser',
    mcp: 'mcp-server-list',
    rename: 'session-rename',
    context: 'context-stats',
    ctx: 'context-stats', // alias
    tokens: 'context-stats', // alias
    export: 'export-wizard',
    plugin: 'plugin-manager',
};

/**
 * Commands that show an overlay ONLY when invoked without arguments.
 * With arguments, they execute their handler instead.
 */
const NO_ARGS_OVERLAY: Record<string, OverlayType> = {
    session: 'session-subcommand-selector',
    log: 'log-level-selector',
    prompts: 'prompt-list',
};

/**
 * Get the overlay for a command submission (with parsed args).
 * Used by InputContainer.handleSubmit
 *
 * @param command - The base command name (e.g., 'mcp', 'search')
 * @param args - Arguments passed to the command
 * @returns Overlay type to show, or null to execute command handler
 */
export function getCommandOverlay(command: string, args: string[]): OverlayType | null {
    // Commands that always show overlay
    const alwaysOverlay = ALWAYS_OVERLAY[command];
    if (alwaysOverlay) return alwaysOverlay;

    // Commands that show overlay only when no args
    if (args.length === 0) {
        const noArgsOverlay = NO_ARGS_OVERLAY[command];
        if (noArgsOverlay) return noArgsOverlay;
    }

    return null;
}

/**
 * Get the overlay for a command selected from autocomplete.
 * Used by OverlayContainer.handleSystemCommandSelect
 *
 * When selecting from autocomplete, there are never args -
 * we just need to know if this command has an overlay.
 *
 * @param command - The command name selected from autocomplete
 * @returns Overlay type to show, or null to execute command
 */
export function getCommandOverlayForSelect(command: string): OverlayType | null {
    // Check "always overlay" commands first
    const alwaysOverlay = ALWAYS_OVERLAY[command];
    if (alwaysOverlay) return alwaysOverlay;

    // Check "no args overlay" commands (selecting = no args)
    const noArgsOverlay = NO_ARGS_OVERLAY[command];
    if (noArgsOverlay) return noArgsOverlay;

    return null;
}

/**
 * Check if a command has any overlay behavior.
 * Useful for determining if a command should be handled specially.
 */
export function isInteractiveCommand(command: string): boolean {
    return command in ALWAYS_OVERLAY || command in NO_ARGS_OVERLAY;
}
