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
    tools: 'tool-browser',
};

/**
 * Commands that show an overlay ONLY when invoked without arguments.
 * With arguments, they execute their handler instead.
 */
const NO_ARGS_OVERLAY: Record<string, OverlayType> = {
    session: 'session-subcommand-selector',
    mcp: 'mcp-server-list',
    log: 'log-level-selector',
    prompts: 'prompt-list',
};

/**
 * System overlays that are not triggered by commands.
 * These are always protected from auto-close.
 */
const SYSTEM_OVERLAYS: OverlayType[] = [
    'slash-autocomplete',
    'resource-autocomplete',
    'api-key-input',
    'approval',
    'mcp-server-actions',
    'mcp-add-choice',
    'mcp-add-selector',
    'mcp-custom-type-selector',
    'mcp-custom-wizard',
    'prompt-add-choice',
    'prompt-add-wizard',
    'prompt-delete-selector',
];

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
 * Get overlay for real-time auto-detection while typing.
 * Used by useCLIState for showing overlays as user types.
 *
 * Only returns overlays for commands where showing during typing is useful.
 * Most commands wait until Enter to show their overlay.
 *
 * @param command - The command being typed
 * @param hasArgs - Whether any args have been typed
 * @param hasSpaceAfterCommand - Whether there's a space after the command
 * @returns Overlay type to auto-show, or null
 */
export function getAutoDetectOverlay(
    command: string,
    hasArgs: boolean,
    hasSpaceAfterCommand: boolean
): OverlayType | null {
    // Only auto-detect for commands where it makes sense to show while typing
    // Most overlays should wait for Enter to avoid UI jumping around

    if (hasArgs || hasSpaceAfterCommand) {
        return null;
    }

    // Auto-show model selector when typing /model
    if (command === 'model') {
        return 'model-selector';
    }

    // Auto-show session selector for /resume and /switch
    if (command === 'resume' || command === 'switch') {
        return 'session-selector';
    }

    return null;
}

/**
 * Get all overlays that should be "protected" from auto-close.
 * These overlays won't be closed when input changes.
 *
 * Derived from command mappings + system overlays.
 */
export function getProtectedOverlays(): OverlayType[] {
    const overlays = new Set<OverlayType>(SYSTEM_OVERLAYS);

    // Add all command-triggered overlays
    for (const overlay of Object.values(ALWAYS_OVERLAY)) {
        overlays.add(overlay);
    }
    for (const overlay of Object.values(NO_ARGS_OVERLAY)) {
        overlays.add(overlay);
    }

    return [...overlays];
}

/**
 * Check if a command has any overlay behavior.
 * Useful for determining if a command should be handled specially.
 */
export function isInteractiveCommand(command: string): boolean {
    return command in ALWAYS_OVERLAY || command in NO_ARGS_OVERLAY;
}
